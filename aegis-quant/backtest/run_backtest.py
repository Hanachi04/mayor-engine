"""Runs the full Aegis Quant backtest: walks every hourly candle for
BTCUSDT/ETHUSDT/SOLUSDT over the real downloaded history, drives all four
layers per candle, and reports net USD P&L, win rate, max drawdown, and
Sharpe — per symbol and combined.

Usage:
    python3 run_backtest.py [--symbols BTCUSDT ETHUSDT SOLUSDT] [--limit N]

--limit caps how many candles per symbol are simulated (useful for a
quick smoke run before committing to the full 184-day history, since
each candle triggers 4 subprocess calls).
"""

import argparse
import json
import os

os.environ["AEGIS_BACKTEST_MODE"] = "1"

import config
from data_loader import load_candles, timestamp_ms_to_iso
from pipeline_runner import fetch_drl_risk_fraction, fetch_final_decision, run_all_layers
from portfolio import Portfolio
from trade import simulate_trade
from volatility import compute_rolling_volatility, compute_stop_distance_pct

DB_PATH = os.path.join(config.DATA_DIR, "aegis.sqlite3")


def run_backtest_for_symbol(symbol: str, limit: int = None) -> Portfolio:
    candles = load_candles(symbol)
    portfolio = Portfolio(config.STARTING_CAPITAL)

    start = config.WARMUP_CANDLES
    end = len(candles) - config.EXIT_HORIZON
    if limit is not None:
        end = min(end, start + limit)

    for i in range(start, end):
        as_of_ms = candles[i]["timestamp"] + 3599999
        as_of_iso = timestamp_ms_to_iso(as_of_ms)
        entry_price = candles[i]["close"]
        exit_price = candles[i + config.EXIT_HORIZON]["close"]

        closes_so_far = [c["close"] for c in candles[: i + 1]]
        volatility = compute_rolling_volatility(closes_so_far, config.VOLATILITY_LOOKBACK)
        # Not strictly needed for the trade P&L itself (only the layers'
        # own stop-loss logic uses it operationally), but kept here so a
        # future version of this harness can report stop-outs too.
        _stop_distance_pct = (
            compute_stop_distance_pct(
                volatility, config.STOP_VOLATILITY_MULTIPLIER, config.STOP_MIN_PCT, config.STOP_MAX_PCT
            )
            if volatility is not None
            else None
        )

        run_all_layers(symbol, as_of_iso, as_of_ms)
        decision = fetch_final_decision(symbol, as_of_iso, DB_PATH)
        final_decision = decision["final_decision"] if decision else None

        risk_fraction = fetch_drl_risk_fraction(symbol, as_of_iso, DB_PATH) or 0.0

        pnl = simulate_trade(
            final_decision,
            entry_price,
            exit_price,
            portfolio.capital,
            risk_fraction,
            config.TAKER_FEE_PCT,
            config.SLIPPAGE_PCT,
        )
        portfolio.record_step(pnl, was_trade=final_decision is not None)

    return portfolio


def main():
    parser = argparse.ArgumentParser(description="Run the full Aegis Quant backtest.")
    parser.add_argument("--symbols", nargs="+", default=config.SYMBOLS)
    parser.add_argument("--limit", type=int, default=None)
    args = parser.parse_args()

    results = {}
    for symbol in args.symbols:
        print(f"Running backtest for {symbol}...", flush=True)
        portfolio = run_backtest_for_symbol(symbol, limit=args.limit)
        results[symbol] = portfolio.summary()
        print(json.dumps(results[symbol], indent=2, ensure_ascii=False), flush=True)

    combined_net = sum(r["net_pnl_usd"] for r in results.values())
    combined_trades = sum(r["num_trades"] for r in results.values())
    print("\n=== COMBINED ===", flush=True)
    print(json.dumps({"total_net_pnl_usd": combined_net, "total_trades": combined_trades}, indent=2), flush=True)


if __name__ == "__main__":
    main()
