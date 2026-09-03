from langgraph.graph import END, START, StateGraph

from state import SizingState
import config


def load_debate_input_node(state: dict) -> dict:
    return {}


def route_direction(state: dict) -> str:
    return "reject" if state.get("final_decision") is None else "simulate"


def reject_if_no_direction_node(state: dict) -> dict:
    return {
        "execution_status": "REJECTED_NO_DIRECTION",
        "rejection_reason": "no directional decision from debate chamber",
        "reward": config.REJECT_REWARD,
    }


def simulate_candidates_node(state: dict) -> dict:
    from environment.simulator import simulate_all_candidates
    candidates = simulate_all_candidates(state["final_decision"], state["market_snapshot"])
    return {"execution_candidates": candidates}


def infer_size_and_timing_node(state: dict) -> dict:
    from agent.infer import infer_size_and_timing
    return infer_size_and_timing(state["final_decision"], state["market_snapshot"])


def validate_action_node(state: dict) -> dict:
    return {}


def log_result_node(state: dict) -> dict:
    return {}


def build_graph():
    graph = StateGraph(SizingState)
    graph.add_node("load_debate_input", load_debate_input_node)
    graph.add_node("reject_if_no_direction", reject_if_no_direction_node)
    graph.add_node("simulate_candidates", simulate_candidates_node)
    graph.add_node("infer_size_and_timing", infer_size_and_timing_node)
    graph.add_node("validate_action", validate_action_node)
    graph.add_node("log_result", log_result_node)

    graph.add_edge(START, "load_debate_input")
    graph.add_conditional_edges(
        "load_debate_input",
        route_direction,
        {"reject": "reject_if_no_direction", "simulate": "simulate_candidates"},
    )
    graph.add_edge("simulate_candidates", "infer_size_and_timing")
    graph.add_edge("infer_size_and_timing", "validate_action")
    graph.add_edge("validate_action", "log_result")
    graph.add_edge("reject_if_no_direction", "log_result")
    graph.add_edge("log_result", END)
    return graph.compile()
