"""Rolling volatility estimate used to size the stop distance.

Uses the standard deviation of simple hourly returns over a lookback
window — a plain, dependency-free proxy for realized volatility.
"""

import math
from typing import List, Optional


def compute_rolling_volatility(closes: List[float], lookback: int) -> Optional[float]:
    """Return the stdev of simple returns over the last `lookback` closes.

    Returns None if there isn't enough history yet (needs lookback + 1
    closes to compute `lookback` returns).
    """
    if len(closes) < lookback + 1:
        return None

    window = closes[-(lookback + 1):]
    returns = [
        (window[i] - window[i - 1]) / window[i - 1]
        for i in range(1, len(window))
        if window[i - 1] != 0
    ]
    if len(returns) < 2:
        return None

    mean = sum(returns) / len(returns)
    variance = sum((r - mean) ** 2 for r in returns) / (len(returns) - 1)
    return math.sqrt(variance)


def clamp(value: float, low: float, high: float) -> float:
    return max(low, min(high, value))


def compute_stop_distance_pct(
    volatility: float, multiplier: float, low: float, high: float
) -> float:
    return clamp(multiplier * volatility, low, high)
