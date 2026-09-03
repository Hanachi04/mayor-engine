"""
All values below are protective bounds / simulation parameters, not trading
recommendations. They must stay centrally defined here — never duplicated
inside an agent or the environment.
"""

# --- Risk & position sizing ---
MAX_RISK_PCT = 0.35
MIN_RISK_PCT = 0.0
RISK_FRACTION_CANDIDATES = (0.10, 0.20, 0.35)
EQUITY_USD = 10_000.0

VOLATILITY_MULTIPLIER = 3.0
MIN_STOP_DISTANCE_PCT = 0.002
MAX_STOP_DISTANCE_PCT = 0.02

# --- Execution timing / cost model ---
TIMING_OFFSETS_MS = (0, 60_000, 120_000, 300_000)
MAX_SLIPPAGE_BPS = 10.0
FEE_BPS = 4.0
MAX_DRAWDOWN_PCT = 2.0
TIMING_PENALTY_MAX_PCT = 0.02
DRAWDOWN_PENALTY_WEIGHT = 1.0

EXIT_HORIZON_CANDLES = 1

MIN_ACCEPTABLE_REWARD = 0.0

REJECT_REWARD = -10.0
