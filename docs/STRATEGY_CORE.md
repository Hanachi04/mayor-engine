# STRATEGY_MODE=core

## What it does
Selects `WEIGHT_PROFILES.core` in `engine/scan.js`: non-zero weights on trend, MACD, supertrend, structure, volume only.

## What it is not
- Not a guarantee of positive expectancy
- Not the same as historical balanced results
- Not automatically verified by `data/verification.json` until a reproducible core backtest PASSes

## Local example
```bash
STRATEGY_MODE=core VERIFICATION_GATE_MODE=warn DRY_RUN=1 node engine/scan.js
STRATEGY_MODE=core node engine/backtest.js
```
