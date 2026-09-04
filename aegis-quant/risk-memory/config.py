"""Constants for the Risk Gate + Memory + Reflection layer (Layer 4)."""

import os

# Shared SQLite database used by all Aegis Quant layers.
DB_PATH = os.environ.get(
    "AEGIS_DB_PATH",
    os.path.join(os.path.dirname(__file__), "..", "data", "aegis.sqlite3"),
)

# Risk gate thresholds.
MAX_DRAWDOWN_PCT = 2.0  # percent, e.g. 2.0 == 2.0%
MIN_SHARPE = 1.0
MIN_METRIC_OBSERVATIONS = 10  # below this, the gate cannot reject on stats alone

# Reflection agent pattern thresholds.
REPEATED_NEGATIVE_REWARD_WINDOW = 5
REPEATED_NEGATIVE_REWARD_MIN_COUNT = 4  # e.g. 4 of last 5 rewards negative
SIMULATION_REJECTION_CLUSTER_WINDOW = 10
SIMULATION_REJECTION_CLUSTER_MIN_COUNT = 5

REFLECTION_PATTERNS = (
    "REPEATED_NEGATIVE_REWARD",
    "DRAWDOWN_BREACH",
    "SHARPE_FAILURE",
    "SIMULATION_REJECTION_CLUSTER",
)
