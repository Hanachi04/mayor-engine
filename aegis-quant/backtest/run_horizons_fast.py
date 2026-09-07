import os
import json
import sqlite3
import sys
from datetime import datetime, timezone

os.environ["AEGIS_BACKTEST_MODE"] = "1"

sys.path.insert(0, os.path.dirname(__file__))
import config
from run_backtest import run_backtest_for_symbol

DB_PATH = os.path.join(config.DATA_DIR, "aegis.sqlite3")

def parse_iso_ms(iso_str):
    dt = datetime.fromisoformat(iso_str.replace("Z", "+00:00"))
    return int(dt.timestamp() * 1000)

split_ms = parse_iso_ms("2026-03-06T12:00:00Z")

table_summary = []

for h in [1, 2, 4]:
    print(f"\n==========================================", flush=True)
    print(f" RUNNING EXIT_HORIZON = {h}", flush=True)
    print(f"==========================================", flush=True)
    config.EXIT_HORIZON = h
    if os.path.exists(DB_PATH):
        os.remove(DB_PATH)

    records = []
    for symbol in config.SYMBOLS:
        print(f"Backtesting {symbol} (H={h})...", flush=True)
        run_backtest_for_symbol(symbol, trade_records=records)

    out_file = os.path.join(os.path.dirname(__file__), f"trades_log_horizon{h}.json")
    with open(out_file, "w") as f:
        json.dump(records, f, indent=2)

    trades = [r for r in records if r.get("was_trade")]
    h1_trades = [t for t in trades if t["as_of_ms"] < split_ms]
    h2_trades = [t for t in trades if t["as_of_ms"] >= split_ms]

    h1_pnl = sum(t["pnl_usd"] for t in h1_trades)
    h2_pnl = sum(t["pnl_usd"] for t in h2_trades)
    total_pnl = h1_pnl + h2_pnl

    row = {
        "horizon": h,
        "h1_trade_count": len(h1_trades),
        "h1_net_pnl_usd": round(h1_pnl, 2),
        "h2_trade_count": len(h2_trades),
        "h2_net_pnl_usd": round(h2_pnl, 2),
        "total_trades": len(trades),
        "total_net_pnl_usd": round(total_pnl, 2)
    }
    print(f"Result H={h}: H1 PnL = ${row['h1_net_pnl_usd']} ({row['h1_trade_count']} trades) | H2 PnL = ${row['h2_net_pnl_usd']} ({row['h2_trade_count']} trades)", flush=True)
    table_summary.append(row)

with open("final_split_table_complete.json", "w") as out:
    json.dump(table_summary, out, indent=2)

print("\n==========================================", flush=True)
print(" FINAL TABLE COMPLETE", flush=True)
print(json.dumps(table_summary, indent=2), flush=True)
