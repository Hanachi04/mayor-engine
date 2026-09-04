"""Graph wiring for Layer 4: Risk Gate + Memory + Reflection.

Node functions are plain, independently-testable functions (state dict in,
partial state dict out) — the LangGraph wiring at the bottom is a thin
layer on top of them, matching the pattern used in Layers 1-3. If the
LangGraph API differs slightly in this environment's pinned version,
only build_graph() below needs adjusting; the node functions themselves
don't import langgraph and work standalone (see main.py / tests).
"""

from adapters.drl_input import fetch_latest_drl_decision
from adapters.historical_memory import fetch_recent_rewards, rewards_to_equity_curve
from metrics.drawdown import compute_max_drawdown_pct
from metrics.sharpe import compute_cumulative_sharpe
from persistence.sqlite_store import (
    fetch_recent_risk_memory_events,
    get_connection,
    init_db,
    insert_reflection_memory,
    insert_risk_memory_event,
    insert_risk_metric_snapshot,
)
from reflection.reflection_agent import build_reflection_context, run_reflection
from risk.risk_gate import apply_risk_gate


def drl_input_node(state: dict) -> dict:
    decision = fetch_latest_drl_decision(state["symbol"], state["as_of"])
    if decision is None:
        return {
            "drl_direction": None,
            "drl_risk_fraction": None,
            "drl_timing_offset": None,
            "drl_reward": None,
        }
    return decision


def risk_gate_node(state: dict) -> dict:
    rewards = fetch_recent_rewards(state["symbol"], state["as_of"])
    equity_curve = rewards_to_equity_curve(rewards)
    drawdown_pct = compute_max_drawdown_pct(equity_curve)
    cumulative_sharpe = compute_cumulative_sharpe(rewards)
    observation_count = len(rewards)

    passed, reason, final_decision = apply_risk_gate(
        state.get("drl_direction"), drawdown_pct, cumulative_sharpe, observation_count
    )

    return {
        "current_drawdown_pct": drawdown_pct,
        "cumulative_sharpe": cumulative_sharpe,
        "metric_observations": observation_count,
        "risk_gate_passed": passed,
        "risk_gate_reason": reason,
        "final_decision": final_decision,
    }


def persist_node(state: dict) -> dict:
    init_db()
    with get_connection() as conn:
        insert_risk_memory_event(
            conn,
            {
                "symbol": state["symbol"],
                "as_of": state["as_of"],
                "drl_direction": state.get("drl_direction"),
                "drl_reward": state.get("drl_reward"),
                "drawdown_pct": state.get("current_drawdown_pct"),
                "cumulative_sharpe": state.get("cumulative_sharpe"),
                "risk_gate_passed": int(bool(state.get("risk_gate_passed"))),
                "risk_gate_reason": state.get("risk_gate_reason"),
                "final_decision": state.get("final_decision"),
            },
        )
        insert_risk_metric_snapshot(
            conn,
            {
                "symbol": state["symbol"],
                "as_of": state["as_of"],
                "drawdown_pct": state.get("current_drawdown_pct"),
                "cumulative_sharpe": state.get("cumulative_sharpe"),
                "observation_count": state.get("metric_observations"),
            },
        )
    return {}


def reflection_node(state: dict) -> dict:
    rewards = fetch_recent_rewards(state["symbol"], state["as_of"])
    with get_connection() as conn:
        recent_events = fetch_recent_risk_memory_events(conn, state["symbol"])

    patterns = run_reflection(rewards, recent_events)
    context = build_reflection_context(patterns)

    if patterns:
        with get_connection() as conn:
            for pattern in patterns:
                insert_reflection_memory(conn, state["symbol"], state["as_of"], pattern, context)

    return {"reflection_patterns": patterns, "reflection_context": context}


def run_pipeline(symbol: str, as_of: str) -> dict:
    """Run all four nodes in sequence without requiring langgraph — used
    by main.py and by tests that only need the end-to-end result."""
    state = {"symbol": symbol, "as_of": as_of}
    state.update(drl_input_node(state))
    state.update(risk_gate_node(state))
    state.update(persist_node(state))
    state.update(reflection_node(state))
    return state


def build_graph():
    """Compile the LangGraph version of this pipeline (used in production)."""
    from langgraph.graph import END, StateGraph

    from state import RiskMemoryState

    graph = StateGraph(RiskMemoryState)
    graph.add_node("drl_input", drl_input_node)
    graph.add_node("risk_gate", risk_gate_node)
    graph.add_node("persist", persist_node)
    graph.add_node("reflection", reflection_node)
    graph.set_entry_point("drl_input")
    graph.add_edge("drl_input", "risk_gate")
    graph.add_edge("risk_gate", "persist")
    graph.add_edge("persist", "reflection")
    graph.add_edge("reflection", END)
    return graph.compile()
