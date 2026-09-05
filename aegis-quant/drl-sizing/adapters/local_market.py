"""
Local OHLCV candle access for the simulation environment.

Deliberately self-contained (re-reads the same aegis-quant/data/{symbol}_1h.json
files that analyst-council/adapters/market_data.py reads) rather than
importing analyst-council's module — same cross-layer-import-collision
reasoning as adapters/debate_input.py's docstring.

Only computes what this layer needs: the entry candle at/after a given
as_of timestamp, a short local volatility estimate (same formula as
analyst-council's, duplicated intentionally so this layer has no runtime
dependency on Layer 1's code), and the candle(s) needed to simulate a given
timing offset + the single-next-candle exit policy.
"""
import json
import math
import os

DATA_DIR = os.path.join(os.path.dirname(__file__), "..", "..", "data")


def _load_candles(symbol: str) -> list[dict]:
    path_csv = os.path.join(DATA_DIR, f"{symbol}_1h.csv")
    if os.path.exists(path_csv):
        import csv
        candles = []
        with open(path_csv, "r", newline="") as f:
            reader = csv.DictReader(f)
            for row in reader:
                t = int(row["timestamp"])
                candles.append({
                    "open_time": t,
                    "close_time": t + 3599999,
                    "open": float(row["open"]),
                    "high": float(row["high"]),
                    "low": float(row["low"]),
                    "close": float(row["close"]),
                    "volume": float(row["volume"]),
                })
        return sorted(candles, key=lambda c: c["open_time"])

    path_json = os.path.join(DATA_DIR, f"{symbol}_1h.json")
    if os.path.exists(path_json):
        with open(path_json, "r") as f:
            candles = json.load(f)
        return sorted(candles, key=lambda c: c["open_time"])

    raise FileNotFoundError(f"No candle data found for {symbol} in {DATA_DIR}")


def _volatility(closes: list[float], period: int = 20) -> float:
    window = closes[-period:] if len(closes) >= period else closes[:]
    if len(window) < 2:
        return 0.0
    returns = [(window[i] / window[i - 1] - 1.0) for i in range(1, len(window))]
    mean = sum(returns) / len(returns)
    variance = sum((r - mean) ** 2 for r in returns) / len(returns)
    return math.sqrt(variance)


def _candle_at_or_after(candles: list[dict], ts_ms: int) -> dict | None:
    for c in candles:
        if c["close_time"] >= ts_ms:
            return c
    return None


def load_market_snapshot(symbol: str = "BTCUSDT", as_of: int | None = None) -> dict:
    candles = _load_candles(symbol)
    if as_of is None:
        idx = len(candles) - 1
    else:
        idx = next((i for i, c in enumerate(candles) if c["close_time"] == as_of or c["open_time"] == as_of), None)
        if idx is None:
            raise ValueError(f"No candle found for {symbol} at as_of={as_of}")

    closes_up_to_entry = [c["close"] for c in candles[: idx + 1]]
    return {
        "symbol": symbol,
        "entry_index": idx,
        "entry_time": candles[idx]["close_time"],
        "entry_price": candles[idx]["close"],
        "volatility": _volatility(closes_up_to_entry),
        "candles": candles,
    }


def candle_for_offset(market_snapshot: dict, timing_offset_ms: int) -> dict | None:
    target_ts = market_snapshot["entry_time"] + timing_offset_ms
    return _candle_at_or_after(market_snapshot["candles"], target_ts)


def next_candle_after(market_snapshot: dict, execution_candle: dict) -> dict | None:
    candles = market_snapshot["candles"]
    idx = next((i for i, c in enumerate(candles) if c["close_time"] == execution_candle["close_time"]), None)
    if idx is None or idx + 1 >= len(candles):
        return None
    return candles[idx + 1]
