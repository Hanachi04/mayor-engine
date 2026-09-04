"""Cumulative Sharpe ratio calculation from a series of period returns."""

import math
from typing import List


def compute_cumulative_sharpe(returns: List[float], risk_free_rate: float = 0.0) -> float:
    """Return the (non-annualized) Sharpe ratio of a list of period returns.

    Returns 0.0 when there is not enough data (fewer than 2 points) or
    when the standard deviation of returns is zero (no variance to divide by).
    """
    n = len(returns)
    if n < 2:
        return 0.0

    excess = [r - risk_free_rate for r in returns]
    mean_excess = sum(excess) / n
    variance = sum((r - mean_excess) ** 2 for r in excess) / (n - 1)
    std_dev = math.sqrt(variance)

    if std_dev == 0:
        return 0.0

    return mean_excess / std_dev
