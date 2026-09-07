import sqlite3, json, math

SYMBOLS = ["BTCUSDT", "ETHUSDT", "SOLUSDT", "BNBUSDT", "XRPUSDT", "ADAUSDT", "DOGEUSDT", "AVAXUSDT", "DOTUSDT", "LINKUSDT", "MATICUSDT", "LTCUSDT", "TRXUSDT"]
INITIAL_CAPITAL = 100000.0
TAKER_FEE_PCT = 0.0002

conn = sqlite3.connect("aegis-quant/data/aegis.sqlite3")
cur = conn.cursor()

trades = cur.execute("""
    SELECT symbol, direction, entry_price, exit_price, pnl_usd, return_pct
    FROM trade_history
    ORDER BY entry_time ASC
""").fetchall()

per_symbol = {}
all_pnls = []

for sym in SYMBOLS:
    sym_trades = [t for t in trades if t[0] == sym]
    pnls = [t[4] for t in sym_trades]
    all_pnls.extend(pnls)
    net_pnl = sum(pnls)
    num_trades = len(pnls)
    wins = sum(1 for p in pnls if p > 0)
    win_rate = (wins / num_trades * 100.0) if num_trades > 0 else 0.0

    if num_trades >= 2:
        mean = net_pnl / num_trades
        variance = sum((p - mean) ** 2 for p in pnls) / (num_trades - 1)
        std_dev = math.sqrt(variance)
        sharpe = mean / std_dev if std_dev > 0 else 0.0
    else:
        sharpe = 0.0

    per_symbol[sym] = {
        "starting_capital": INITIAL_CAPITAL / len(SYMBOLS),
        "ending_capital": (INITIAL_CAPITAL / len(SYMBOLS)) + net_pnl,
        "net_pnl_usd": net_pnl,
        "net_pnl_pct": (net_pnl / (INITIAL_CAPITAL / len(SYMBOLS))) * 100.0,
        "num_trades": num_trades,
        "win_rate_pct": win_rate,
        "sharpe_ratio": sharpe,
    }

total_net_pnl = sum(all_pnls)
total_trades = len(all_pnls)
total_wins = sum(1 for p in all_pnls if p > 0)
comb_win_rate = (total_wins / total_trades * 100.0) if total_trades > 0 else 0.0

if total_trades >= 2:
    comb_mean = total_net_pnl / total_trades
    comb_var = sum((p - comb_mean) ** 2 for p in all_pnls) / (total_trades - 1)
    comb_std = math.sqrt(comb_var)
    comb_sharpe = comb_mean / comb_std if comb_std > 0 else 0.0
else:
    comb_sharpe = 0.0

# Calculate peak equity curve and drawdown
equity = INITIAL_CAPITAL
peak = equity
max_dd = 0.0

for p in all_pnls:
    equity += p
    if equity > peak:
        peak = equity
    if peak > 0:
        dd = (peak - equity) / peak * 100.0
        if dd > max_dd:
            max_dd = dd

combined = {
    "starting_capital": INITIAL_CAPITAL,
    "portfolio_value": INITIAL_CAPITAL + total_net_pnl,
    "net_pnl_usd": total_net_pnl,
    "net_pnl_pct": (total_net_pnl / INITIAL_CAPITAL) * 100.0,
    "num_trades": total_trades,
    "win_rate_pct": comb_win_rate,
    "sharpe_ratio": comb_sharpe,
    "max_drawdown_pct": max_dd,
}

results = {
    "combined": combined,
    "per_symbol": per_symbol,
}

with open("aegis-quant/backtest/results_365d_13symbols.json", "w") as f:
    json.dump(results, f, indent=2)

print("Saved aegis-quant/backtest/results_365d_13symbols.json successfully")
