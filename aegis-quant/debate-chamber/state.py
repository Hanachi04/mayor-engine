from typing import Any, TypedDict


class DebateState(TypedDict, total=False):
    symbol: str
    as_of: int
    snapshot: dict[str, Any]
    fundamentals: dict[str, Any]
    sentiment: dict[str, Any]
    technicals: dict[str, Any]

    bull_case: dict[str, Any]
    bear_case: dict[str, Any]
    final_decision: str | None
    final_score: float
    decisive_side: str | None
    risk_pct: float
    sqlite_decision_id: int
    errors: list[str]
