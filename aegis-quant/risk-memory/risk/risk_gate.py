"""The risk gate: decides whether the DRL direction is allowed through.

Rules (in order):
1. No DRL direction (None) -> pass through as None, nothing to gate.
2. Fewer than MIN_METRIC_OBSERVATIONS historical rewards -> not enough
   statistical evidence to block on drawdown/Sharpe, so the gate passes
   the DRL direction through unchanged (reason: "insufficient_history").
3. current_drawdown_pct > MAX_DRAWDOWN_PCT -> blocked.
4. cumulative_sharpe < MIN_SHARPE -> blocked.
5. Otherwise -> passed.
"""

from typing import Optional, Tuple

from config import MAX_DRAWDOWN_PCT, MIN_METRIC_OBSERVATIONS, MIN_SHARPE


def apply_risk_gate(
    drl_direction: Optional[str],
    drawdown_pct: float,
    cumulative_sharpe: float,
    observation_count: int,
) -> Tuple[bool, str, Optional[str]]:
    """Return (passed, reason, final_decision)."""
    if drl_direction is None:
        return True, "no_signal", None

    if observation_count < MIN_METRIC_OBSERVATIONS:
        return True, "insufficient_history", drl_direction

    if drawdown_pct > MAX_DRAWDOWN_PCT:
        return False, "drawdown_breach", None

    if cumulative_sharpe < MIN_SHARPE:
        return False, "sharpe_failure", None

    return True, "ok", drl_direction
