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
GEMINI_MODEL = os.getenv("GEMINI_MODEL", "gemini-3.6-flash")
GEMINI_ENDPOINT = "https://generativelanguage.googleapis.com/v1beta/models"
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
    key = os.getenv("GEMINI_API_KEY")
    prompt = {k: round(float(feature[k]), 8) for k in ("close", "rsi", "macd", "macd_signal", "bb_mid", "bb_upper", "bb_lower", "volatility", "return_1h")}
    if not key:
        return {"label": "neutral", "score": 0.0, "reason": "GEMINI_API_KEY unavailable"}
    instruction = "You are a conservative crypto market sentiment classifier. Return JSON only with label bullish, bearish, or neutral; score from -1 to 1; and a brief reason. Do not give financial advice. Snapshot: " + json.dumps(prompt)
    payload = {"system_instruction": {"parts": [{"text": "Classify market sentiment conservatively."}]}, "contents": [{"role": "user", "parts": [{"text": instruction}]}], "generationConfig": {"temperature": 0.0, "responseMimeType": "application/json", "responseSchema": {"type": "OBJECT", "properties": {"label": {"type": "STRING", "enum": ["bullish", "bearish", "neutral"]}, "score": {"type": "NUMBER"}, "reason": {"type": "STRING"}}, "required": ["label", "score", "reason"]}}}
    try:
        url = f"{GEMINI_ENDPOINT}/{GEMINI_MODEL}:generateContent"
        r = requests.post(url, params={"key": key}, headers={"Content-Type": "application/json"}, json=payload, timeout=60)
        r.raise_for_status()
        content = r.json()["candidates"][0]["content"]["parts"][0]["text"]
        result = json.loads(content)
        result["score"] = max(-1.0, min(1.0, float(result["score"])))
        if result["label"] not in {"bullish", "bearish", "neutral"}:
            raise ValueError("invalid sentiment label")
        return result
    except requests.HTTPError as exc:
        detail = exc.response.text[:240] if exc.response is not None else ""
        return {"label": "neutral", "score": 0.0, "reason": f"Gemini fallback HTTP {exc.response.status_code if exc.response is not None else 'unknown'}: {detail}"}
    except Exception as exc:
        return {"label": "neutral", "score": 0.0, "reason": f"Gemini fallback: {type(exc).__name__}"}


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



def evaluate_profitability(candles: list[dict[str, float]], decisions: list[dict[str, Any]]) -> dict[str, Any]:
    """Rule-based paper trades from Aegis decisions. No LLM. Costs included.

    Entry: next 1h open after decision bar close.
    SL: 1.5x realized volatility (feature proxy); TP: 2.0x SL distance (R:R 1:2).
    Exit: SL, TP, or max 24 bars (24h). Fees 0.04% * 2 + slippage 0.03% * 2.
    """
    if not candles:
        return {"profitability_evaluated": True, "trades": 0, "reason": "no-candles"}
    by_time = {int(c["close_time"]): i for i, c in enumerate(candles)}
    opens = [c["open"] for c in candles]
    highs = [c["high"] for c in candles]
    lows = [c["low"] for c in candles]
    closes = [c["close"] for c in candles]
    fee = 0.0004
    slip = 0.0003
    trades = []
    for d in decisions:
        if not d.get("signal"):
            continue
        as_of = int(d["as_of"])
        idx = by_time.get(as_of)
        if idx is None or idx + 2 >= len(candles):
            continue
        entry_i = idx + 1
        entry_raw = opens[entry_i]
        direction = d["signal"]
        # vol from last 20 returns ending at decision bar
        if idx < 20:
            continue
        vol = sum(abs((closes[j] - closes[j - 1]) / closes[j - 1]) for j in range(idx - 19, idx + 1)) / 20
        risk = max(vol * 1.5, 0.003)  # min 0.3% stop
        if direction == "LONG":
            sl = entry_raw * (1 - risk)
            tp = entry_raw * (1 + risk * 2.0)
            entry_fill = entry_raw * (1 + slip)
        else:
            sl = entry_raw * (1 + risk)
            tp = entry_raw * (1 - risk * 2.0)
            entry_fill = entry_raw * (1 - slip)
        result = "TIMEOUT"
        exit_raw = closes[min(entry_i + 24, len(candles) - 1)]
        exit_i = min(entry_i + 24, len(candles) - 1)
        for j in range(entry_i, min(entry_i + 25, len(candles))):
            if direction == "LONG":
                if lows[j] <= sl:
                    exit_raw, result, exit_i = sl, "SL", j
                    break
                if highs[j] >= tp:
                    exit_raw, result, exit_i = tp, "TP", j
                    break
            else:
                if highs[j] >= sl:
                    exit_raw, result, exit_i = sl, "SL", j
                    break
                if lows[j] <= tp:
                    exit_raw, result, exit_i = tp, "TP", j
                    break
            exit_raw, exit_i = closes[j], j
        exit_fill = exit_raw * (1 - slip if direction == "LONG" else 1 + slip)
        sign = 1 if direction == "LONG" else -1
        gross = sign * (exit_fill - entry_fill) / entry_fill * 100
        net = gross - fee * 2 * 100
        trades.append({
            "signal": direction, "result": result,
            "entry": entry_fill, "exit": exit_fill,
            "gross_pct": round(gross, 4), "net_pct": round(net, 4),
            "entry_time": int(candles[entry_i]["open_time"]),
            "exit_time": int(candles[exit_i]["close_time"]),
        })
    if not trades:
        return {
            "profitability_evaluated": True,
            "trades": 0, "wins": 0, "losses": 0,
            "win_rate_pct": 0, "net_pct": 0, "avg_net_pct": 0,
            "profit_factor": 0, "max_drawdown_pct": 0,
            "status": "NO_TRADES",
            "note": "No actionable decisions to simulate",
        }
    wins = [t for t in trades if t["net_pct"] > 0]
    losses = [t for t in trades if t["net_pct"] <= 0]
    gw = sum(t["net_pct"] for t in wins)
    gl = abs(sum(t["net_pct"] for t in losses))
    net = sum(t["net_pct"] for t in trades)
    equity = peak = dd = 0.0
    for t in trades:
        equity += t["net_pct"]
        peak = max(peak, equity)
        dd = max(dd, peak - equity)
    pf = (gw / gl) if gl > 0 else (99.0 if gw > 0 else 0.0)
    status = "EDGE_CANDIDATE" if net > 0 and pf > 1.0 and len(trades) >= 8 else "WEAK_OR_NEGATIVE"
    return {
        "profitability_evaluated": True,
        "trades": len(trades),
        "wins": len(wins),
        "losses": len(losses),
        "win_rate_pct": round(len(wins) / len(trades) * 100, 2),
        "net_pct": round(net, 4),
        "avg_net_pct": round(net / len(trades), 4),
        "profit_factor": round(pf, 3),
        "max_drawdown_pct": round(dd, 4),
        "status": status,
        "assumptions": {
            "entry": "next_1h_open",
            "sl": "1.5x_20bar_vol",
            "tp": "2R",
            "max_bars": 24,
            "fee_rt_pct": 0.08,
            "slip_rt_pct": 0.06,
        },
        "sample_trades": trades[:5],
    }


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
    # Rule-based decisions for profitability (avoid LLM non-determinism in edge measurement)
    rule_decisions = []
    for feature in feats:
        sentiment = {"label": "neutral", "score": 0.0, "reason": "rule-only-for-profitability"}
        # technical-only path mirrors decision() without LLM
        technical = feature["macd"] > feature["macd_signal"] and feature["close"] > feature["bb_mid"]
        technical_short = feature["macd"] < feature["macd_signal"] and feature["close"] < feature["bb_mid"]
        sig = "LONG" if technical else ("SHORT" if technical_short else None)
        rule_decisions.append({"as_of": int(feature["close_time"]), "signal": sig, "sentiment": sentiment})
    profit = evaluate_profitability(candles, rule_decisions)
    report = {"symbol": "BTCUSDT", "interval": INTERVAL, "candles": len(candles), "feature_rows": len(feats), "sqlite_rows": count, "trade_decisions": signals, "model": GEMINI_MODEL, "local_only": True, "profitability_evaluated": True, "profitability": profit, "first_decision": next((x for x in decisions if x["signal"]), None)}
    REPORT_PATH.write_text(json.dumps(report, indent=2), encoding="utf-8")
    print(json.dumps(report, indent=2))
    return report


if __name__ == "__main__":
    run()
