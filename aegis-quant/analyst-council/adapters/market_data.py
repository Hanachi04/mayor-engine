"""
Local OHLCV market data adapter.

Reads hourly candles from aegis-quant/data/{symbol}_1h.json and computes
the technical indicator snapshot (RSI, MACD, Bollinger Bands, volatility)
for a given point in time.

Default behavior (no args) preserves the original single-symbol,
latest-candle behavior: symbol="BTCUSDT", as_of=None -> last closed candle.
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


def _sma(values: list[float], period: int) -> float:
    window = values[-period:]
    return sum(window) / len(window)


def _rsi(closes: list[float], period: int = 14) -> float:
    if len(closes) < period + 1:
        period = max(1, len(closes) - 1)
    gains, losses = [], []
    for i in range(-period, 0):
        change = closes[i] - closes[i - 1]
        gains.append(max(change, 0.0))
        losses.append(max(-change, 0.0))
    avg_gain = sum(gains) / len(gains) if gains else 0.0
    avg_loss = sum(losses) / len(losses) if losses else 0.0
    if avg_loss == 0:
        return 100.0
    rs = avg_gain / avg_loss
    return 100.0 - (100.0 / (1.0 + rs))


def _macd(closes: list[float]) -> tuple[float, float]:
    def ema(values, period):
        k = 2.0 / (period + 1)
        e = values[0]
        for v in values[1:]:
            e = v * k + e * (1 - k)
        return e

    if len(closes) < 26:
        fast_period = max(2, min(12, len(closes) // 2))
        slow_period = max(fast_period + 1, min(26, len(closes)))
    else:
        fast_period, slow_period = 12, 26

    ema_fast = ema(closes[-max(fast_period * 3, fast_period):], fast_period)
    ema_slow = ema(closes[-max(slow_period * 3, slow_period):], slow_period)
    macd = ema_fast - ema_slow
    signal = macd * 0.8
    return macd, signal


def _bollinger(closes: list[float], period: int = 20) -> tuple[float, float, float]:
    window = closes[-period:] if len(closes) >= period else closes[:]
    mid = sum(window) / len(window)
    variance = sum((c - mid) ** 2 for c in window) / len(window)
    std = math.sqrt(variance)
    return mid - 2 * std, mid, mid + 2 * std


def _volatility(closes: list[float], period: int = 20) -> float:
    window = closes[-period:] if len(closes) >= period else closes[:]
    if len(window) < 2:
        return 0.0
    returns = [(window[i] / window[i - 1] - 1.0) for i in range(1, len(window))]
    mean = sum(returns) / len(returns)
    variance = sum((r - mean) ** 2 for r in returns) / len(returns)
    return math.sqrt(variance)


def load_snapshot(symbol: str = "BTCUSDT", as_of: int | None = None) -> dict:
    candles = _load_candles(symbol)
    if as_of is None:
        idx = len(candles) - 1
    else:
        idx = next((i for i, c in enumerate(candles) if c["close_time"] == as_of or c["open_time"] == as_of), None)
        if idx is None:
            raise ValueError(f"No candle found for {symbol} at as_of={as_of}")

    history = candles[: idx + 1]
    closes = [c["close"] for c in history]
    candle = candles[idx]

    bb_lower, bb_mid, bb_upper = _bollinger(closes)
    macd, macd_signal = _macd(closes)

    return {
        "symbol": symbol,
        "open_time": candle["open_time"],
        "close_time": candle["close_time"],
        "open": candle["open"],
        "high": candle["high"],
        "low": candle["low"],
        "close": candle["close"],
        "volume": candle["volume"],
        "rsi": _rsi(closes),
        "macd": macd,
        "macd_signal": macd_signal,
        "bb_lower": bb_lower,
        "bb_mid": bb_mid,
        "bb_upper": bb_upper,
        "volatility": _volatility(closes),
        "market_cap": None,
    }
