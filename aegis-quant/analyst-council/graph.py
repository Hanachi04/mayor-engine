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
      1. Technicals: weight 40% (most responsive to real-time price action).
      2. Sentiment: weight 35% (AI-powered momentum detector, external validation).
      3. Fundamentals: weight 25% (long-term health check, lowest frequency change).

    Decision: count bullish/bearish votes (using weights) and return majority.
    Risk: fixed at 2% per position (placeholder, can be overridden later).
    """
    technicals = state.get("technicals", {})
    sentiment = state.get("sentiment", {})
    fundamentals = state.get("fundamentals", {})

    # Extract signals (default to neutral if missing).
    tech_signals = [
        technicals.get("rsi_signal", "neutral"),
        technicals.get("macd_signal", "neutral"),
        technicals.get("bollinger_signal", "neutral"),
    ]
    sent_signal = sentiment.get("label", "neutral")
    fund_signals = []  # Fundamentals don't produce directional signals yet; only info.

    # Weighted vote.
    bullish_score = 0.0
    bearish_score = 0.0

    # Technicals: 40% (3 signals, 40/3 ≈ 13.3% each).
    for sig in tech_signals:
        if sig == "bullish":
            bullish_score += 0.4 / 3
        elif sig == "bearish":
            bearish_score += 0.4 / 3

    # Sentiment: 35%.
    if sent_signal == "bullish":
        bullish_score += 0.35
    elif sent_signal == "bearish":
        bearish_score += 0.35

    # Fundamentals: 25% (no signals yet, placeholder).
    # (could add fundamentals-based signals here in future iterations).

    # Render decision.
    if bullish_score > bearish_score:
        decision = "LONG"
    elif bearish_score > bullish_score:
        decision = "SHORT"
    else:
        decision = None

    return {
        "council_decision": decision,
        "risk_pct": 2.0,
        "reflection_context": f"Technicals: {tech_signals}, Sentiment: {sent_signal}",
    }
