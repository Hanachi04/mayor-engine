"""Runs the full Aegis Quant backtest: walks every hourly candle for the
configured symbols over the real downloaded history, drives all four
layers per candle, and reports net USD P&L, win rate, max drawdown, and
Sharpe — per symbol and combined.

Usage:
    python3 run_backtest.py [--symbols SYMBOL ...] [--limit N] [--output PATH]

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


def run_backtest_for_symbol(
    symbol: str,
    limit: int = None,
    start_date: str = None,
    end_date: str = None,
    trade_records: list = None,
    initial_portfolio: Portfolio = None,
    start_index: int = None,
) -> Portfolio:
    all_candles = load_candles(symbol)

    if start_date or end_date:
        from datetime import datetime, timezone
        start_ms = (
            int(datetime.fromisoformat(start_date).replace(tzinfo=timezone.utc).timestamp() * 1000)
            if start_date
            else 0
        )
        end_ms = (
            int(datetime.fromisoformat(end_date).replace(tzinfo=timezone.utc).timestamp() * 1000)
            if end_date
            else float("inf")
        )
        candles = [c for c in all_candles if start_ms <= c["timestamp"] <= end_ms]
    else:
        candles = all_candles

    portfolio = initial_portfolio or Portfolio(config.STARTING_CAPITAL)

    start = config.WARMUP_CANDLES if len(candles) > config.WARMUP_CANDLES else 0
    end = len(candles) - config.EXIT_HORIZON
    if start_index is not None:
        start = start_index
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

        risk_fraction = fetch_drl_risk_fraction(symbol, as_of_ms, DB_PATH) or 0.0

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

        if trade_records is not None:
            trade_records.append({
                "symbol": symbol,
                "as_of": as_of_iso,
                "as_of_ms": as_of_ms,
                "decision": final_decision,
                "risk_fraction": risk_fraction,
                "entry_price": entry_price,
                "exit_price": exit_price,
                "pnl_usd": pnl,
                "was_trade": final_decision is not None,
                "portfolio_capital_after": portfolio.capital,
            })

    return portfolio


def _symbol_decision_count(symbol: str) -> int:
    """Return the number of persisted DRL decisions for a symbol."""
    if not os.path.exists(DB_PATH):
        return 0
    import sqlite3

    with sqlite3.connect(DB_PATH) as conn:
        try:
            return conn.execute(
                "SELECT COUNT(*) FROM drl_sizing_decisions WHERE symbol = ?",
                (symbol,),
            ).fetchone()[0]
        except sqlite3.OperationalError:
            return 0


def _clear_symbol_persistence(symbol: str) -> None:
    """Remove an incomplete symbol before a safe resume."""
    import sqlite3

    with sqlite3.connect(DB_PATH) as conn:
        for table in (
            "drl_sizing_decisions",
            "risk_memory_events",
            "risk_metric_snapshots",
            "reflection_memory",
        ):
            try:
                conn.execute(f"DELETE FROM {table} WHERE symbol = ?", (symbol,))
            except sqlite3.OperationalError:
                pass
        conn.commit()


def reconstruct_persisted_symbol(
    symbol: str,
    trade_records: list = None,
    require_complete: bool = True,
    return_count: bool = False,
) -> Portfolio:
    """Rebuild a completed symbol's portfolio from its persisted decisions.

    This is used only after an interrupted run. It recomputes each trade from
    the same candle CSV and the decisions already written by the four layers,
    rather than inventing or copying a summary.
    """
    import sqlite3

    candles = load_candles(symbol)
    start = config.WARMUP_CANDLES if len(candles) > config.WARMUP_CANDLES else 0
    end = len(candles) - config.EXIT_HORIZON
    portfolio = Portfolio(config.STARTING_CAPITAL)

    with sqlite3.connect(DB_PATH) as conn:
        drl_rows = conn.execute(
            "SELECT as_of, selected_risk_pct FROM drl_sizing_decisions WHERE symbol = ?",
            (symbol,),
        ).fetchall()
        risk_rows = conn.execute(
            "SELECT as_of, final_decision FROM risk_memory_events WHERE symbol = ?",
            (symbol,),
        ).fetchall()

    risk_by_iso = {row[0]: row[1] for row in risk_rows}
    risk_by_ms = {int(row[0]): row[1] for row in drl_rows}
    expected = end - start
    processed = len(risk_by_ms)
    if require_complete and (processed != expected or len(risk_by_iso) != expected):
        raise RuntimeError(
            f"Cannot reconstruct {symbol}: expected {expected} persisted decisions, "
            f"found DRL={len(risk_by_ms)} risk_memory={len(risk_by_iso)}"
        )
    if len(risk_by_iso) != processed:
        raise RuntimeError(
            f"Cannot resume {symbol}: DRL={processed} and risk_memory={len(risk_by_iso)}"
        )

    # A partial run is resumable only when its persisted timestamps form the
    # prefix of the symbol's candle walk. This prevents silently skipping or
    # double-counting a non-contiguous database.
    expected_ms = {
        candles[i]["timestamp"] + 3599999 for i in range(start, start + processed)
    }
    if set(risk_by_ms) != expected_ms:
        raise RuntimeError(
            f"Cannot resume {symbol}: persisted decisions are not a contiguous prefix"
        )

    for i in range(start, start + processed):
        as_of_ms = candles[i]["timestamp"] + 3599999
        as_of_iso = timestamp_ms_to_iso(as_of_ms)
        final_decision = risk_by_iso.get(as_of_iso)
        risk_fraction = risk_by_ms[as_of_ms] or 0.0
        pnl = simulate_trade(
            final_decision,
            candles[i]["close"],
            candles[i + config.EXIT_HORIZON]["close"],
            portfolio.capital,
            risk_fraction,
            config.TAKER_FEE_PCT,
            config.SLIPPAGE_PCT,
        )
        portfolio.record_step(pnl, was_trade=final_decision is not None)
        if trade_records is not None:
            trade_records.append(
                {
                    "symbol": symbol,
                    "as_of": as_of_iso,
                    "as_of_ms": as_of_ms,
                    "decision": final_decision,
                    "risk_fraction": risk_fraction,
                    "entry_price": candles[i]["close"],
                    "exit_price": candles[i + config.EXIT_HORIZON]["close"],
                    "pnl_usd": pnl,
                    "was_trade": final_decision is not None,
                    "portfolio_capital_after": portfolio.capital,
                }
            )
    if return_count:
        return portfolio, processed
    return portfolio


def main():
    parser = argparse.ArgumentParser(description="Run the full Aegis Quant backtest.")
    parser.add_argument("--symbols", nargs="+", default=config.SYMBOLS)
    parser.add_argument("--limit", type=int, default=None)
    parser.add_argument("--start-date", type=str, default=None)
    parser.add_argument("--end-date", type=str, default=None)
    parser.add_argument("--trades-output", type=str, default=None)
    parser.add_argument(
        "--resume",
        action="store_true",
        help="Reuse complete symbols persisted by an interrupted run and continue the rest.",
    )
    parser.add_argument(
        "--output",
        type=str,
        default=os.path.join(os.path.dirname(__file__), "results_365d_13symbols.json"),
    )
    args = parser.parse_args()

    results = {}
    all_trade_records = []
    pending_symbols = list(args.symbols)
    resumed_portfolios = {}
    resumed_start_indices = {}
    if args.resume:
        for symbol in args.symbols:
            candles = load_candles(symbol)
            start = config.WARMUP_CANDLES if len(candles) > config.WARMUP_CANDLES else 0
            expected = len(candles) - config.EXIT_HORIZON - start
            persisted = _symbol_decision_count(symbol)
            if persisted == expected:
                print(f"Reconstructing persisted {symbol}...", flush=True)
                portfolio = reconstruct_persisted_symbol(symbol, all_trade_records)
                results[symbol] = portfolio.summary()
                pending_symbols.remove(symbol)
            elif persisted:
                print(
                    f"Resuming persisted {symbol} after {persisted}/{expected} decisions...",
                    flush=True,
                )
                portfolio, processed = reconstruct_persisted_symbol(
                    symbol,
                    all_trade_records,
                    require_complete=False,
                    return_count=True,
                )
                resumed_portfolios[symbol] = portfolio
                resumed_start_indices[symbol] = start + processed
            else:
                _clear_symbol_persistence(symbol)
        print(
            f"Resume mode: {len(results)} complete symbols reused, "
            f"{len(pending_symbols)} symbols remaining or resuming.",
            flush=True,
        )
    for symbol in pending_symbols:
        print(f"Running backtest for {symbol}...", flush=True)
        portfolio = run_backtest_for_symbol(
            symbol,
            limit=args.limit,
            start_date=args.start_date,
            end_date=args.end_date,
            trade_records=all_trade_records,
            initial_portfolio=resumed_portfolios.get(symbol),
            start_index=resumed_start_indices.get(symbol),
        )
        results[symbol] = portfolio.summary()
        print(json.dumps(results[symbol], indent=2, ensure_ascii=False), flush=True)

    # Keep the persisted report deterministic and easy to audit: monetary
    # values are rounded to cents, and the combined P&L is computed from the
    # same per-symbol cent-rounded values that appear in the report.
    for summary in results.values():
        summary["ending_capital"] = round(summary["ending_capital"], 2)
        summary["net_pnl_usd"] = round(summary["net_pnl_usd"], 2)
        summary["net_pnl_pct"] = round(summary["net_pnl_pct"], 6)
        summary["win_rate_pct"] = round(summary["win_rate_pct"], 6)
        summary["max_drawdown_pct"] = round(summary["max_drawdown_pct"], 6)
        summary["sharpe_ratio"] = round(summary["sharpe_ratio"], 6)

    combined_portfolio = Portfolio(
        sum(summary["starting_capital"] for summary in results.values())
    )
    for record in sorted(all_trade_records, key=lambda item: (item["as_of_ms"], item["symbol"])):
        combined_portfolio.record_step(record["pnl_usd"], was_trade=record["was_trade"])
    combined = combined_portfolio.summary()
    combined["net_pnl_usd"] = round(
        sum(summary["net_pnl_usd"] for summary in results.values()), 2
    )
    combined["ending_capital"] = round(
        combined["starting_capital"] + combined["net_pnl_usd"], 2
    )
    combined["net_pnl_pct"] = round(
        combined["net_pnl_usd"] / combined["starting_capital"] * 100.0, 6
    )
    combined["win_rate_pct"] = round(combined["win_rate_pct"], 6)
    combined["max_drawdown_pct"] = round(combined["max_drawdown_pct"], 6)
    combined["sharpe_ratio"] = round(combined["sharpe_ratio"], 6)

    if args.trades_output:
        with open(args.trades_output, "w") as f:
            json.dump(all_trade_records, f, indent=2)
        print(f"Saved {len(all_trade_records)} trade records to {args.trades_output}", flush=True)

    report = {**results, "combined": combined}
    with open(args.output, "w") as f:
        json.dump(report, f, indent=2, ensure_ascii=False)
        f.write("\n")
    print(f"Saved report to {args.output}", flush=True)
    print("\n=== COMBINED ===", flush=True)
    print(json.dumps(combined, indent=2), flush=True)


if __name__ == "__main__":
    main()
