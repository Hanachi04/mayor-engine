"""Drawdown calculation from an equity/reward curve."""

from typing import List


def compute_max_drawdown_pct(equity_curve: List[float]) -> float:
    """Return the maximum drawdown of `equity_curve` as a positive percent.

    `equity_curve` is a running cumulative equity series (e.g. cumulative
    sum of rewards, or a portfolio value series). An empty or single-point
    curve has zero drawdown by definition.
    """
    if not equity_curve or len(equity_curve) < 2:
        return 0.0

    peak = equity_curve[0]
    max_dd = 0.0
    for value in equity_curve:
        if value > peak:
            peak = value
        if peak == 0:
            continue
        drawdown = (peak - value) / abs(peak) * 100.0
        if drawdown > max_dd:
            max_dd = drawdown
    return max_dd
