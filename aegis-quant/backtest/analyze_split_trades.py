"""Post-processing analysis script to evaluate continuous 365-day backtest trade logs.
Splits continuous run into H1 (First 6 Months) and H2 (Second 6 Months) to measure
accumulated memory/adaptation effects without clearing the database.
"""

import argparse
import json
import os
import sys
from datetime import datetime, timezone


def parse_iso_ms(iso_str: str) -> int:
    dt = datetime.fromisoformat(iso_str.replace("Z", "+00:00"))
    return int(dt.timestamp() * 1000)


def analyze_trades_log(json_file: str, split_date_str: str = "2024-09-01T00:00:00Z"):
    if not os.path.exists(json_file):
        print(f"File not found: {json_file}")
        return

    with open(json_file, "r") as f:
        records = json.load(f)

    split_ms = parse_iso_ms(split_date_str)

    h1_trades = []
    h2_trades = []

    for r in records:
        if not r.get("was_trade"):
            continue
        ms = r["as_of_ms"]
        if ms < split_ms:
            h1_trades.append(r)
        else:
            h2_trades.append(r)

    h1_pnl = sum(r["pnl_usd"] for r in h1_trades)
    h2_pnl = sum(r["pnl_usd"] for r in h2_trades)
    total_pnl = h1_pnl + h2_pnl

    print(f"\n==========================================")
    print(f" SPLIT TRADE ANALYSIS FOR: {os.path.basename(json_file)}")
    print(f"==========================================")
    print(f"H1 Trades Count: {len(h1_trades):>5} | H1 Net P&L: ${h1_pnl:>10.2f}")
    print(f"H2 Trades Count: {len(h2_trades):>5} | H2 Net P&L: ${h2_pnl:>10.2f}")
    print(f"Total Trades:    {len(h1_trades)+len(h2_trades):>5} | Total P&L:  ${total_pnl:>10.2f}")
    print(f"==========================================\n")

    return {
        "file": json_file,
        "h1_count": len(h1_trades),
        "h1_pnl": h1_pnl,
        "h2_count": len(h2_trades),
        "h2_pnl": h2_pnl,
        "total_pnl": total_pnl,
    }


def main():
    parser = argparse.ArgumentParser(description="Analyze split trades from continuous backtest logs.")
    parser.add_argument("--files", nargs="+", help="Trade log JSON files to analyze.")
    parser.add_argument("--split-date", type=str, default="2024-09-01T00:00:00Z")
    args = parser.parse_args()

    files = args.files
    if not files:
        files = [
            "aegis-quant/backtest/trades_log_horizon1.json",
            "aegis-quant/backtest/trades_log_horizon2.json",
            "aegis-quant/backtest/trades_log_horizon4.json",
        ]

    for f in files:
        if os.path.exists(f):
            analyze_trades_log(f, args.split_date)


if __name__ == "__main__":
    main()
