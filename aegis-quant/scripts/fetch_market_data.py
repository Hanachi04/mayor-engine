"""Fetch real hourly OHLCV candles from Binance's public REST API and save
them as CSV files under aegis-quant/data/.

No API key required (public market-data endpoint). Paginates past the
1000-candle-per-request limit using the returned close time as the next
request's startTime.

Usage:
    python3 fetch_market_data.py --days 184
"""

import argparse
import csv
import os
import time
from datetime import datetime, timedelta, timezone

import requests

BINANCE_KLINES_URL = "https://api.binance.com/api/v3/klines"
BINANCE_US_KLINES_URL = "https://api.binance.us/api/v3/klines"
SYMBOLS = ["BTCUSDT", "ETHUSDT", "SOLUSDT"]
INTERVAL = "1h"
LIMIT_PER_REQUEST = 1000
OUTPUT_DIR = os.path.join(os.path.dirname(__file__), "..", "data")

# Binance kline row indices (per official API docs).
OPEN_TIME, OPEN, HIGH, LOW, CLOSE, VOLUME, CLOSE_TIME = range(7)


def fetch_klines(symbol: str, start_time_ms: int, end_time_ms: int, session=None):
    """Yield raw kline rows for `symbol` between start_time_ms and end_time_ms,
    paginating past Binance's 1000-rows-per-request limit."""
    session = session or requests
    cursor = start_time_ms

    while cursor < end_time_ms:
        params = {
            "symbol": symbol,
            "interval": INTERVAL,
            "startTime": cursor,
            "limit": LIMIT_PER_REQUEST,
        }
        try:
            response = session.get(BINANCE_KLINES_URL, params=params, timeout=30)
            response.raise_for_status()
        except requests.exceptions.HTTPError as err:
            if err.response is not None and err.response.status_code == 451:
                response = session.get(BINANCE_US_KLINES_URL, params=params, timeout=30)
                response.raise_for_status()
            else:
                raise
        rows = response.json()

        if not rows:
            break

        for row in rows:
            if row[OPEN_TIME] >= end_time_ms:
                return
            yield row

        last_close_time = rows[-1][CLOSE_TIME]
        next_cursor = last_close_time + 1
        if next_cursor <= cursor:
            # Safety valve against an infinite loop if the API ever returns
            # a non-advancing page.
            break
        cursor = next_cursor

        if len(rows) < LIMIT_PER_REQUEST:
            break

        time.sleep(0.2)  # be polite to the public endpoint, avoid rate limiting


def save_csv(symbol: str, rows, output_dir: str = OUTPUT_DIR) -> str:
    os.makedirs(output_dir, exist_ok=True)
    path = os.path.join(output_dir, f"{symbol}_1h.csv")
    with open(path, "w", newline="") as f:
        writer = csv.writer(f)
        writer.writerow(["timestamp", "open", "high", "low", "close", "volume"])
        for row in rows:
            writer.writerow(
                [
                    row[OPEN_TIME],
                    row[OPEN],
                    row[HIGH],
                    row[LOW],
                    row[CLOSE],
                    row[VOLUME],
                ]
            )
    return path


def main():
    parser = argparse.ArgumentParser(description="Fetch real Binance hourly candles.")
    parser.add_argument("--days", type=int, default=184)
    parser.add_argument("--symbols", nargs="+", default=SYMBOLS)
    parser.add_argument("--output-dir", default=OUTPUT_DIR)
    args = parser.parse_args()

    end_time = datetime.now(timezone.utc)
    start_time = end_time - timedelta(days=args.days)
    start_ms = int(start_time.timestamp() * 1000)
    end_ms = int(end_time.timestamp() * 1000)

    for symbol in args.symbols:
        print(f"Fetching {symbol} ({args.days} days, {INTERVAL})...")
        rows = list(fetch_klines(symbol, start_ms, end_ms))
        path = save_csv(symbol, rows, args.output_dir)
        print(f"  -> {len(rows)} candles saved to {path}")


if __name__ == "__main__":
    main()
