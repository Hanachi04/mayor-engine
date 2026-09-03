import config
from environment.execution_env import simulate_candidate
from reward.function import execution_reward


def simulate_all_candidates(direction: str, market_snapshot: dict) -> list[dict]:
    results = []
    for risk_fraction in config.RISK_FRACTION_CANDIDATES:
        for timing_offset_ms in config.TIMING_OFFSETS_MS:
            sim = simulate_candidate(direction, market_snapshot, risk_fraction, timing_offset_ms)
            sim["reward"] = execution_reward(sim)
            results.append(sim)
    return results
