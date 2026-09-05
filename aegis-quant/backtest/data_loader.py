"""Loads a symbol's hourly candle CSV (as produced by
aegis-quant/scripts/fetch_market_data.py) into a list of dict rows."""

import csv
import os
from typing import List

from config import DATA_DIR


def load_candles(symbol: str, data_dir: str = DATA_DIR) -> List[dict]:
    path = os.path.join(data_dir, f"{symbol}_1h.csv")
    if not os.path.exists(path):
        raise FileNotFoundError(
            f"No candle data for {symbol} at {path} — run fetch_market_data.py first."
        )

    rows = []
    with open(path, newline="") as f:
        reader = csv.DictReader(f)
        for row in reader:
            rows.append(
                {
                    "timestamp": int(row["timestamp"]),
                    "open": float(row["open"]),
                    "high": float(row["high"]),
                    "low": float(row["low"]),
                    "close": float(row["close"]),
                    "volume": float(row["volume"]),
                }
            )
    rows.sort(key=lambda r: r["timestamp"])
    return rows


def timestamp_ms_to_iso(ts_ms: int) -> str:
    from datetime import datetime, timezone

    return datetime.fromtimestamp(ts_ms / 1000, tz=timezone.utc).strftime("%Y-%m-%dT%H:%M:%S")
