"""
See environment/execution_env.py's module docstring for the honesty note:
this is a grid search over simulated candidates, not a trained policy.
"""
import config
from environment.simulator import simulate_all_candidates


def infer_size_and_timing(direction: str, market_snapshot: dict) -> dict:
    candidates = simulate_all_candidates(direction, market_snapshot)
    valid_candidates = [c for c in candidates if not c.get("invalid_action")
                         and not c.get("violates_risk_limit")]

    if not valid_candidates:
        return {
            "execution_status": "REJECTED_SIMULATION",
            "rejection_reason": "no valid candidate (all invalid or violate risk limit)",
            "simulation_summary": {"candidates_tried": len(candidates)},
        }

    best = max(valid_candidates, key=lambda c: c["reward"])

    if best["reward"] <= config.MIN_ACCEPTABLE_REWARD:
        return {
            "execution_status": "REJECTED_SIMULATION",
            "rejection_reason": "selected reward below minimum",
            "simulation_summary": {
                "candidates_tried": len(candidates),
                "best_reward": best["reward"],
            },
        }

    return {
        "execution_status": "SIMULATED",
        "rejection_reason": None,
        "selected_risk_pct": best["sizing"]["risk_pct"],
        "selected_notional": best["sizing"]["notional"],
        "selected_timing_offset_ms": best["timing_offset_ms"],
        "expected_slippage_bps": best["slippage_bps"],
        "expected_return_pct": best["gross_return_pct"],
        "reward": best["reward"],
        "simulation_summary": {
            "candidates_tried": len(candidates),
            "valid_candidates": len(valid_candidates),
            "best_reward": best["reward"],
        },
    }
