from langgraph.graph import END, START, StateGraph

from state import CouncilState
from agents.fundamentals import fundamentals_node
from agents.sentiment import sentiment_node
from agents.technicals import technicals_node


def build_graph() -> StateGraph:
    """
    Build the Analyst Council layer graph.

    Flow:
      START → fundamentals, technicals, sentiment (parallel)
              ↓ (all complete)
              → council_decision (aggregates views)
              → END

    Each agent builds its own independent view from the snapshot.
    The council node aggregates them and renders a final recommendation.
    """
    graph = StateGraph(CouncilState)

    graph.add_node("fundamentals", fundamentals_node)
    graph.add_node("technicals", technicals_node)
    graph.add_node("sentiment", sentiment_node)
    graph.add_node("council_decision", council_decision_node)

    graph.add_edge(START, "fundamentals")
    graph.add_edge(START, "technicals")
    graph.add_edge(START, "sentiment")

    graph.add_edge("fundamentals", "council_decision")
    graph.add_edge("technicals", "council_decision")
    graph.add_edge("sentiment", "council_decision")

    graph.add_edge("council_decision", END)

    return graph.compile()


def council_decision_node(state: dict) -> dict:
    """
    Aggregate fundamentals, technicals, and sentiment into a council decision.

    Logic:
      1. Technicals: 55% weight (or 100% when sentiment is unavailable in backtest mode).
      2. Sentiment: 45% weight (when available).
      3. Fundamentals: informational health check.
    """
    technicals = state.get("technicals", {})
    sentiment = state.get("sentiment", {})
    fundamentals = state.get("fundamentals", {})

    tech_view = technicals.get("view", "neutral")
    sent_label = sentiment.get("label", "neutral")
    sent_reason = sentiment.get("reason", "")

    # Sentiment is unavailable if backtest mode or explicitly failed
    sentiment_available = (
        sent_label in ("bullish", "bearish")
        and not sent_reason.startswith("sentiment unavailable")
    )

    if not sentiment_available:
        # Backtest mode or sentiment unavailable: decision based on technicals view
        if tech_view == "bullish":
            decision = "LONG"
        elif tech_view == "bearish":
            decision = "SHORT"
        else:
            decision = None
    else:
        bullish_score = (0.55 if tech_view == "bullish" else 0.0) + (0.45 if sent_label == "bullish" else 0.0)
        bearish_score = (0.55 if tech_view == "bearish" else 0.0) + (0.45 if sent_label == "bearish" else 0.0)

        if bullish_score > bearish_score:
            decision = "LONG"
        elif bearish_score > bullish_score:
            decision = "SHORT"
        else:
            decision = None

    return {
        "council_decision": decision,
        "risk_pct": 2.0,
        "reflection_context": f"Technicals: {tech_view}, Sentiment: {sent_label}",
    }
