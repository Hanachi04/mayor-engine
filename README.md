# mayor-engine

Research-oriented trading **signal** engine with multi-timeframe rules, adaptive risk controls, shadow ML scoring, optional futures scalper, and GitHub Actions automation.

> **Not financial advice.** Research / notification only. Does **not** place exchange orders by design.

## Overview

| Component | Role |
|-----------|------|
| **MaYor Cloud Pro MTF** | Primary signal engine (`engine/scan.js`) |
| **STRATEGY_MODE=core** | Simplified vote weights (fewer indicators) |
| **Adaptation layer A** | Temporary symbol blacklist from recent PF/net |
| **Circuit breakers** | Daily loss + loss-streak window with cooldown |
| **Shadow ML** | Logistic `P(win)` in **log** mode only |
| **Futures Scalper** | Isolated 1m scalper (`engine/scalper/`) |
| **Aegis Quant** | Multi-agent research stack (code present; not operationally gated live) |
| **Reporting** | `docs/STATUS.md`, daily/weekly JSON, Telegram optional |

## Architecture

```
GitHub Actions schedule
  → engine/scan.js (core filters, MTF, risk, adaptation, shadow log)
  → data/tracked.json
  → performance_report / auto_status → docs/STATUS.md
```

Shadow ML does **not** filter live signals unless `ML_SHADOW_MODE=filter` (not recommended until OOS proof).

## Local setup

```bash
git clone https://github.com/Hanachi04/mayor-engine.git
cd mayor-engine
# no npm dependencies required for core Node scripts (Node >= 20)
node -v
```

### Run tests (no Telegram secrets)

```bash
npm test
```

### Generate status

```bash
npm run status
# or: node engine/auto_status.js
```

### Strategy mode core (no Telegram)

Telegram is optional. Without tokens the engine logs and skips send.

```bash
STRATEGY_MODE=core VERIFICATION_GATE_MODE=warn DRY_RUN=1 node engine/scan.js
```

### Backtest

```bash
STRATEGY_MODE=core node engine/backtest.js
# Scalper (requires local 1m JSON under data/scalper/historical/):
node engine/scalper/backtest.js
```

### Shadow ML train

```bash
npm run ml:train
```

## STRATEGY_MODE=core

- Uses `WEIGHT_PROFILES.core`: trend, MACD, supertrend, structure, volume only (other votes weight 0).
- Slightly lower default `minMtfPct` / `minCorePct` / `minAdx` than balanced.
- **Does not** mean proven edge. Live gate may remain BLOCKED; workflow often uses `warn`.

Balanced/momentum/breakout remain available for research comparison.

## Environment variables (selected)

| Variable | Meaning |
|----------|---------|
| `STRATEGY_MODE` | `core` \| `balanced` \| `momentum` \| `breakout` |
| `VERIFICATION_GATE_MODE` | `enforce` \| `warn` |
| `MAX_DAILY_LOSS_PCT` | Circuit daily loss (e.g. 4) |
| `MAX_LOSS_STREAK` | Consecutive losses in window (e.g. 4) |
| `LOSS_STREAK_WINDOW_HOURS` | Default 48 |
| `LOSS_STREAK_COOLDOWN_HOURS` | Default 12 |
| `ADAPTATION_ENABLED` | Layer A on/off |
| `ADAPTATION_DATA_DIR` / `DATA_DIR` | Override data dir (tests) |
| `ML_SHADOW_MODE` | `log` (default) \| `filter` \| `off` |
| `BLOCK_UTC_HOURS` | Comma hours 0-23; **empty = off** |
| `TELEGRAM_TOKEN` / `TELEGRAM_CHAT` | Optional notifications |
| `DRY_RUN` | Log signal without tracked write / telegram |

## GitHub Actions

- `mayor.yml` — main signal scan
- `scalper.yml` — futures scalper
- `auto-status.yml` — STATUS docs (manual `workflow_dispatch`)
- `daily/weekly/monthly-report.yml` — performance JSON
- `ci.yml` — `npm test` on push/PR

Secrets: `TELEGRAM_TOKEN`, `TELEGRAM_CHAT` (optional per workflow).

## Security

- Never commit API keys or tokens.
- `.env` is gitignored.
- Research engine only — keep execution accounts separate.

## License

MIT — see `LICENSE`.


## Historical data & verification

See [docs/HISTORICAL_DATA.md](docs/HISTORICAL_DATA.md).

Without local datasets (or reachable public klines), backtests print **BLOCKED** and do **not** invent PASS metrics.

## Coverage

```bash
npm run coverage
```

Uses `c8` via npx (no required dependency install).

## Limitations

- Research / notification engine only.
- Statistical gates may remain BLOCKED until reproducible datasets are provided.
- Shadow ML stays in **log** mode until out-of-sample evidence justifies filtering.
- Past tracked PnL is not a guarantee of future results.
