#!/usr/bin/env python3
import json
import sqlite3
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
report = json.loads((ROOT / "data" / "pipeline_report.json").read_text())
assert report["symbol"] == "BTCUSDT"
assert report["candles"] >= 28 * 24
assert report["feature_rows"] > 0
assert report["sqlite_rows"] == report["feature_rows"]
assert report["trade_decisions"] >= 1
conn = sqlite3.connect(ROOT / "data" / "aegis.sqlite3")
count = conn.execute("SELECT COUNT(*) FROM decisions").fetchone()[0]
signals = conn.execute("SELECT COUNT(*) FROM decisions WHERE decision IN ('LONG','SHORT')").fetchone()[0]
assert count == report["sqlite_rows"]
assert signals == report["trade_decisions"]
assert conn.execute("SELECT COUNT(*) FROM decisions WHERE rsi IS NULL OR macd IS NULL OR macd_signal IS NULL OR bb_mid IS NULL OR volatility IS NULL").fetchone()[0] == 0
conn.close()
print("✓ Aegis Quant slice: BTC data → features → sentiment → decision → SQLite passed")
