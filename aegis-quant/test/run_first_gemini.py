#!/usr/bin/env python3
import json
import sqlite3
import sys
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
import pipeline

candles = json.loads((ROOT / "data" / "BTCUSDT_1h.json").read_text())
feature = pipeline.features(candles)[0]
sentiment = pipeline.sentiment_agent(feature)
if sentiment["reason"].startswith("Gemini fallback") or sentiment["reason"] == "GEMINI_API_KEY unavailable":
    raise RuntimeError(f"Gemini call did not succeed: {sentiment['reason']}")
signal = pipeline.decision(feature, sentiment)
conn = sqlite3.connect(ROOT / "data" / "aegis.sqlite3")
pipeline.init_db(conn)
conn.execute("INSERT INTO decisions(symbol,as_of,close,rsi,macd,macd_signal,bb_mid,bb_upper,bb_lower,volatility,sentiment_label,sentiment_score,sentiment_reason,decision,risk_pct,created_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)", ("BTCUSDT", int(feature["close_time"]), feature["close"], feature["rsi"], feature["macd"], feature["macd_signal"], feature["bb_mid"], feature["bb_upper"], feature["bb_lower"], feature["volatility"], sentiment["label"], sentiment["score"], sentiment["reason"], signal, 0.35, datetime.now(timezone.utc).isoformat()))
conn.commit()
row_id = conn.execute("SELECT last_insert_rowid()").fetchone()[0]
conn.close()
report = {"provider": "Google Gemini API", "model": pipeline.GEMINI_MODEL, "symbol": "BTCUSDT", "as_of": int(feature["close_time"]), "sentiment": sentiment, "decision": signal, "sqlite_row_id": row_id, "profitability_evaluated": False}
(ROOT / "data" / "first-gemini-decision.json").write_text(json.dumps(report, indent=2), encoding="utf-8")
print(json.dumps(report, indent=2))
