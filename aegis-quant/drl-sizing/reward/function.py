"""
Reward measures the quality of execution and sizing under the direction
that was already fixed by the Debate Chamber (Layer 2) — never the ability
to pick LONG vs SHORT. Includes gross return, slippage cost, fee cost, a
drawdown penalty, and a timing penalty.
"""
import config


def execution_reward(result: dict) -> float:
    if result.get("invalid_action"):
        return config.REJECT_REWARD

    gross_return = result["gross_return_pct"]
    slippage_cost = result["slippage_bps"] / 100.0
    fee_cost = result["fee_bps"] / 100.0
    drawdown_penalty = result["drawdown_pct"] * config.DRAWDOWN_PENALTY_WEIGHT
    timing_penalty = result["timing_penalty_pct"]

    reward = gross_return - slippage_cost - fee_cost - drawdown_penalty - timing_penalty

    if result.get("violates_risk_limit"):
        reward -= 5.0

    return reward
