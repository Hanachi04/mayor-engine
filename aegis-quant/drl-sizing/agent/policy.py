"""
No learned weights exist in this project yet. This module documents the
action space the (future, real) DRL policy would operate over — currently
realized as the fixed grid search in agent/infer.py and environment/simulator.py.
"""
import config

ACTION_SPACE = {
    "risk_fraction": config.RISK_FRACTION_CANDIDATES,
    "timing_offset_ms": config.TIMING_OFFSETS_MS,
}
