from typing import Any, TypedDict


class SizingState(TypedDict, total=False):
    symbol: str
    as_of: int

    final_decision: str | None
    final_score: float
    decisive_side: str | None

    market_snapshot: dict[str, Any]
    execution_candidates: list[dict[str, Any]]

    selected_risk_pct: float
    selected_notional: float
    selected_timing_offset_ms: int
    expected_slippage_bps: float
    expected_return_pct: float
    reward: float
    simulation_summary: dict[str, Any]

    execution_status: str
    rejection_reason: str | None
    sqlite_decision_id: int
