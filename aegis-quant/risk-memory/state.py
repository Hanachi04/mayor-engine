"""Shared state definition for the Risk Gate + Memory + Reflection graph."""

from typing import Optional, TypedDict


class RiskMemoryState(TypedDict, total=False):
    # Inputs.
    symbol: str
    as_of: str

    # Populated by drl_input_node.
    drl_direction: Optional[str]  # "LONG" | "SHORT" | None
    drl_risk_fraction: Optional[float]
    drl_timing_offset: Optional[float]
    drl_reward: Optional[float]

    # Populated by risk_gate_node.
    current_drawdown_pct: Optional[float]
    cumulative_sharpe: Optional[float]
    metric_observations: int
    risk_gate_passed: Optional[bool]
    risk_gate_reason: Optional[str]

    # Final direction after the gate (None means "blocked, no trade").
    final_decision: Optional[str]

    # Populated by reflection_node.
    reflection_patterns: list
    reflection_context: Optional[str]
