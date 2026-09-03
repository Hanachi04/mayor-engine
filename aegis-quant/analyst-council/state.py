from typing import TypedDict, Any


class CouncilState(TypedDict, total=False):
    symbol: str
    as_of: int
    snapshot: dict[str, float]
    fundamentals: dict[str, float]
    sentiment: dict[str, Any]
    technicals: dict[str, str]
    council_decision: str
    risk_pct: float
    reflection_context: str
