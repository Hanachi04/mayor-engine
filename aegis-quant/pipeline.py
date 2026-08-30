#!/usr/bin/env python3
"""Aegis Quant v1: local data/features + one sentiment agent + SQLite decisions."""
from __future__ import annotations

import json
import os
import sqlite3
import sys
import time
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

import requests

ROOT = Path(__file__).resolve().parent
DATA_DIR = ROOT / "data"
DB_PATH = DATA_DIR / "aegis.sqlite3"
CANDLES_PATH = DATA_DIR / "BTCUSDT_1h.json"
REPORT_PATH = DATA_DIR / "pipeline_report.json"
BINANCE_URL = "https://fapi.binance.com/fapi/v1/klines"
LLM_MODEL = os.getenv("AEGIS_LLM_MODEL", "gpt-5-nano")
INTERVAL = "1h"
MONTH_MS = 31 * 24 * 60 * 60 * 1000


def fetch_month() -> list[dict[str, float]]:
    end = int(time.time() * 1000) - 60_000
    start = end - MONTH_MS
    rows: list[list[Any]] = []
    cursor = start
    while cursor < end:
        params = {"symbol": "BTCUSDT", "interval": INTERVAL, "limit": 1000, "startTime": cursor, "endTime": end}
        r = requests.get(BINANCE_URL, params=params, timeout=30)
        r.raise_for_status()
        page = r.json()
        if not page:
            break
        rows.extend(page)
        last = int(page[-1][0])
        if last <= cursor:
            break
        cursor = last + 3_600_000
        time.sleep(0.1)
    unique = {int(row[0]): row for row in rows}
    candles = [
        {"open_time": int(row[0]), "open": float(row[1]), "high": float(row[2]), "low": float(row[3]), "close": float(row[4]), "volume": float(row[5]), "close_time": int(row[6])}
        for row in sorted(unique.values(), key=lambda x: int(x[0]))
    ]
    DATA_DIR.mkdir(parents=True, exist_ok=True)
    CANDLES_PATH.write_text(json.dumps(candles), encoding="utf-8")
    return candles


def ema(values: list[float], period: int) -> list[float | None]:
    out: list[float | None] = [None] * len(values)
    if len(values) < period:
        return out
    value = sum(values[:period]) / period
    out[period - 1] = value
    alpha = 2 / (period + 1)
    for i in range(period, len(values)):
        value = values[i] * alpha + value * (1 - alpha)
        out[i] = value
    return out


def features(candles: list[dict[str, float]]) -> list[dict[str, float]]:
    closes = [c["close"] for c in candles]
    fast, slow = ema(closes, 12), ema(closes, 26)
    macd = [(fast[i] - slow[i]) if fast[i] is not None and slow[i] is not None else None for i in range(len(closes))]
    signal = ema([x if x is not None else 0.0 for x in macd], 9)
    out = []
    for i, c in enumerate(candles):
        if i < 20 or fast[i] is None or slow[i] is None or signal[i] is None:
            continue
        window = closes[i - 19 : i + 1]
        mean = sum(window) / 20
        std = (sum((x - mean) ** 2 for x in window) / 20) ** 0.5
        prev = closes[i - 1]
        returns = (c["close"] - prev) / prev if prev else 0.0
        volatility = sum(abs((closes[j] - closes[j - 1]) / closes[j - 1]) for j in range(i - 19, i + 1)) / 20
        out.append({**c, "rsi": rsi(closes[: i + 1]), "macd": macd[i], "macd_signal": signal[i], "bb_mid": mean, "bb_upper": mean + 2 * std, "bb_lower": mean - 2 * std, "volatility": volatility, "return_1h": returns})
    return out


def rsi(values: list[float], period: int = 14) -> float:
    if len(values) <= period:
        return 50.0
    gains = losses = 0.0
    for i in range(len(values) - period, len(values)):
        delta = values[i] - values[i - 1]
        gains += max(delta, 0)
        losses += max(-delta, 0)
    if losses == 0:
        return 100.0
    return 100 - 100 / (1 + gains / losses)


def sentiment_agent(feature: dict[str, float]) -> dict[str, Any]:
    base = os.getenv("OPENAI_API_BASE")
    key = os.getenv("OPENAI_API_KEY")
    prompt = {k: round(float(feature[k]), 8) for k in ("close", "rsi", "macd", "macd_signal", "bb_mid", "bb_upper", "bb_lower", "volatility", "return_1h")}
    if not base or not key:
        return {"label": "neutral", "score": 0.0, "reason": "language backend unavailable"}
    payload = {"model": LLM_MODEL, "messages": [{"role": "system", "content": "You are a conservative crypto market sentiment classifier. Output JSON only."}, {"role": "user", "content": "Classify sentiment from this market snapshot. Do not give financial advice. Return label bullish, bearish, or neutral; score from -1 to 1; brief reason. Snapshot: " + json.dumps(prompt)}], "response_format": {"type": "json_schema", "json_schema": {"name": "sentiment", "strict": True, "schema": {"type": "object", "properties": {"label": {"type": "string", "enum": ["bullish", "bearish", "neutral"]}, "score": {"type": "number"}, "reason": {"type": "string"}}, "required": ["label", "score", "reason"], "additionalProperties": False}}}}
    try:
        r = requests.post(base.rstrip("/") + "/chat/completions", headers={"Authorization": f"Bearer {key}", "Content-Type": "application/json"}, json=payload, timeout=60)
        r.raise_for_status()
        content = r.json()["choices"][0]["message"]["content"]
        result = json.loads(content)
        result["score"] = max(-1.0, min(1.0, float(result["score"])) )
        return result
    except Exception as exc:
        return {"label": "neutral", "score": 0.0, "reason": f"agent fallback: {type(exc).__name__}"}


def decision(feature: dict[str, float], sentiment: dict[str, Any]) -> str | None:
    technical = feature["macd"] > feature["macd_signal"] and feature["close"] > feature["bb_mid"]
    technical_short = feature["macd"] < feature["macd_signal"] and feature["close"] < feature["bb_mid"]
    if sentiment["label"] == "bullish" and sentiment["score"] > 0.15 and technical:
        return "LONG"
    if sentiment["label"] == "bearish" and sentiment["score"] < -0.15 and technical_short:
        return "SHORT"
    return None


def init_db(conn: sqlite3.Connection) -> None:
    conn.execute("CREATE TABLE IF NOT EXISTS decisions (id INTEGER PRIMARY KEY, symbol TEXT NOT NULL, as_of INTEGER NOT NULL, close REAL NOT NULL, rsi REAL NOT NULL, macd REAL NOT NULL, macd_signal REAL NOT NULL, bb_mid REAL NOT NULL, bb_upper REAL NOT NULL, bb_lower REAL NOT NULL, volatility REAL NOT NULL, sentiment_label TEXT NOT NULL, sentiment_score REAL NOT NULL, sentiment_reason TEXT NOT NULL, decision TEXT, risk_pct REAL NOT NULL, created_at TEXT NOT NULL)")
    conn.commit()


def run() -> dict[str, Any]:
    candles = fetch_month()
    # One decision snapshot per UTC day keeps the first slice small and auditable.
    feats = features(candles)[::24]
    conn = sqlite3.connect(DB_PATH)
    init_db(conn)
    decisions = []
    for feature in feats:
        sentiment = sentiment_agent(feature)
        signal = decision(feature, sentiment)
        conn.execute("INSERT INTO decisions(symbol,as_of,close,rsi,macd,macd_signal,bb_mid,bb_upper,bb_lower,volatility,sentiment_label,sentiment_score,sentiment_reason,decision,risk_pct,created_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)", ("BTCUSDT", int(feature["close_time"]), feature["close"], feature["rsi"], feature["macd"], feature["macd_signal"], feature["bb_mid"], feature["bb_upper"], feature["bb_lower"], feature["volatility"], sentiment["label"], sentiment["score"], sentiment["reason"], signal, 0.35, datetime.now(timezone.utc).isoformat()))
        decisions.append({"as_of": int(feature["close_time"]), "signal": signal, "sentiment": sentiment})
    conn.commit()
    count = conn.execute("SELECT COUNT(*) FROM decisions").fetchone()[0]
    signals = conn.execute("SELECT COUNT(*) FROM decisions WHERE decision IS NOT NULL").fetchone()[0]
    conn.close()
    report = {"symbol": "BTCUSDT", "interval": INTERVAL, "candles": len(candles), "feature_rows": len(feats), "sqlite_rows": count, "trade_decisions": signals, "model": LLM_MODEL, "local_only": True, "profitability_evaluated": False, "first_decision": next((x for x in decisions if x["signal"]), None)}
    REPORT_PATH.write_text(json.dumps(report, indent=2), encoding="utf-8")
    print(json.dumps(report, indent=2))
    return report


if __name__ == "__main__":
    run()
