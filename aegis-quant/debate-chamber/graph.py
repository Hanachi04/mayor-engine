from langgraph.graph import END, START, StateGraph

from state import DebateState
from agents.bull import bull_node
from agents.bear import bear_node
import config


def judge_node(state: dict) -> dict:
    bull = state["bull_case"]
    bear = state["bear_case"]
    margin = bull["score"] - bear["score"]

    if margin >= config.DECISION_MARGIN:
        decision, side = "LONG", "BULL"
    elif margin <= -config.DECISION_MARGIN:
        decision, side = "SHORT", "BEAR"
    else:
        decision, side = None, "TIE"

    return {
        "final_decision": decision,
        "final_score": margin,
        "decisive_side": side,
        "risk_pct": config.ACCEPTED_RISK_PCT if decision else 0.0,
    }


def build_graph():
    graph = StateGraph(DebateState)
    graph.add_node("bull", bull_node)
    graph.add_node("bear", bear_node)
    graph.add_node("judge", judge_node)

    graph.add_edge(START, "bull")
    graph.add_edge(START, "bear")
    graph.add_edge("bull", "judge")
    graph.add_edge("bear", "judge")
    graph.add_edge("judge", END)
    return graph.compile()
