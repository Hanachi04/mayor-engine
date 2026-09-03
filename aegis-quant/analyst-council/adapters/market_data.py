"""
Local OHLCV market data adapter.

Reads hourly candles from aegis-quant/data/{symbol}_1h.json and computes
the technical indicator snapshot (RSI, MACD, Bollinger Bands, volatility).
Needed by technicals.py and (for reflection context) by sentiment.py.

Note: The data source is expected to be a flat list of candles with the
following fields: open_time (Unix ms), open, high, low, close, volume.
"""
import json
import math
import os


def load_snapshot(symbol: str = "BTCUSDT", as_of: int | None = None) -> dict:
    """
    Load the latest OHLCV data for a symbol and compute the snapshot.
    Reads from aegis-quant/data/{symbol}_1h.json.
    """
    data_dir = os.path.join(os.path.dirname(__file__), "..", "..", "data")
    data_file = os.path.join(data_dir, f"{symbol}_1h.json")
    
    if not os.path.exists(data_file):
        # Return empty snapshot (all NaN) for missing data.
        return _empty_snapshot(symbol)
    
    with open(data_file, "r", encoding="utf-8") as f:
        candles = json.load(f)
    
    # Filter to as_of if provided (Unix ms).
    if as_of is not None:
        candles = [c for c in candles if c["open_time"] <= as_of]
    
    if not candles:
        return _empty_snapshot(symbol)
    
    # Take the last candle (most recent).
    latest = candles[-1]
    closes = [c["close"] for c in candles]
    
    # Compute indicators.
    rsi = _compute_rsi(closes)
    macd, macd_signal = _compute_macd(closes)
    bb_upper, bb_mid, bb_lower = _compute_bollinger_bands(closes)
    volatility = _compute_volatility(closes)
    
    return {
        "symbol": symbol,
        "close_time": latest["open_time"],  # Candle close time (open_time of next candle).
        "close": latest["close"],
        "open": latest["open"],
        "high": latest["high"],
        "low": latest["low"],
        "rsi": rsi,
        "macd": macd,
        "macd_signal": macd_signal,
        "bb_lower": bb_lower,
        "bb_mid": bb_mid,
        "bb_upper": bb_upper,
        "volatility": volatility,
    }


def _empty_snapshot(symbol: str) -> dict:
    """Return a snapshot with NaN values for missing data."""
    return {
        "symbol": symbol,
        "close_time": None,
        "close": float("nan"),
        "open": float("nan"),
        "high": float("nan"),
        "low": float("nan"),
        "rsi": float("nan"),
        "macd": float("nan"),
        "macd_signal": float("nan"),
        "bb_lower": float("nan"),
        "bb_mid": float("nan"),
        "bb_upper": float("nan"),
        "volatility": float("nan"),
    }


def _compute_rsi(closes: list, period: int = 14) -> float:
    """Compute RSI (Relative Strength Index)."""
    if len(closes) < period:
        return float("nan")
    
    changes = [closes[i] - closes[i - 1] for i in range(1, len(closes))]
    gains = [c if c > 0 else 0 for c in changes]
    losses = [abs(c) if c < 0 else 0 for c in changes]
    
    avg_gain = sum(gains[-period:]) / period
    avg_loss = sum(losses[-period:]) / period
    
    if avg_loss == 0:
        return 100.0 if avg_gain > 0 else 50.0
    
    rs = avg_gain / avg_loss
    return 100 - (100 / (1 + rs))


def _compute_macd(closes: list, fast: int = 12, slow: int = 26, signal: int = 9) -> tuple[float, float]:
    """Compute MACD and signal line."""
    if len(closes) < slow + signal:
        return float("nan"), float("nan")
    
    fast_ema = _compute_ema(closes, fast)
    slow_ema = _compute_ema(closes, slow)
    
    if fast_ema is None or slow_ema is None:
        return float("nan"), float("nan")
    
    macd_line = fast_ema - slow_ema
    
    # Compute signal line (EMA of MACD).
    macd_values = []
    for i in range(slow, len(closes)):
        fast_ema = _compute_ema(closes[:i+1], fast)
        slow_ema = _compute_ema(closes[:i+1], slow)
        if fast_ema is not None and slow_ema is not None:
            macd_values.append(fast_ema - slow_ema)
    
    if len(macd_values) < signal:
        signal_line = float("nan")
    else:
        signal_line = _compute_ema(macd_values, signal)
        if signal_line is None:
            signal_line = float("nan")
    
    return macd_line, signal_line


def _compute_ema(prices: list, period: int) -> float | None:
    """Compute Exponential Moving Average."""
    if len(prices) < period:
        return None
    
    multiplier = 2 / (period + 1)
    ema = sum(prices[:period]) / period
    
    for price in prices[period:]:
        ema = price * multiplier + ema * (1 - multiplier)
    
    return ema


def _compute_bollinger_bands(closes: list, period: int = 20, std_dev: float = 2.0) -> tuple[float, float, float]:
    """Compute Bollinger Bands (upper, middle, lower)."""
    if len(closes) < period:
        return float("nan"), float("nan"), float("nan")
    
    sma = sum(closes[-period:]) / period
    variance = sum((c - sma) ** 2 for c in closes[-period:]) / period
    std = math.sqrt(variance)
    
    return sma + std_dev * std, sma, sma - std_dev * std


def _compute_volatility(closes: list, period: int = 20) -> float:
    """Compute volatility as standard deviation of returns."""
    if len(closes) < period:
        return float("nan")
    
    recent_closes = closes[-period:]
    returns = [math.log(recent_closes[i] / recent_closes[i - 1]) for i in range(1, len(recent_closes))]
    
    mean_return = sum(returns) / len(returns)
    variance = sum((r - mean_return) ** 2 for r in returns) / len(returns)
    
    return math.sqrt(variance)
