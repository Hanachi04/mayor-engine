"""Configuration for the Aegis Quant end-to-end backtest harness."""

import os

DATA_DIR = os.environ.get(
    "AEGIS_DATA_DIR",
    os.path.join(os.path.dirname(__file__), "..", "data"),
)

SYMBOLS = ["BTCUSDT", "ETHUSDT", "SOLUSDT"]

# Matches the documented, already-implemented exit policy: close on the
# next candle only.
EXIT_HORIZON = 1

# Matches the documented stop-distance formula:
# stop_distance_pct = clamp(3.0 * volatility, 0.002, 0.02)
STOP_VOLATILITY_MULTIPLIER = 3.0
STOP_MIN_PCT = 0.002
STOP_MAX_PCT = 0.02
VOLATILITY_LOOKBACK = 20  # candles used for the rolling volatility estimate

# Realistic Binance USDT-M taker fee + a conservative slippage allowance,
# both applied on entry and on exit (round-trip).
TAKER_FEE_PCT = 0.0004
SLIPPAGE_PCT = 0.0002

STARTING_CAPITAL = 10_000.0

# How many warm-up candles to skip at the start of each symbol's series
# before the first simulated decision (indicators/volatility need history).
WARMUP_CANDLES = 50
