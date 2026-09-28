# Engine #4 — Automated Forward-Test (Turtle Candidate #3)

## Purpose

Independent **paper / virtual** forward-test engine for the **frozen** Turtle / Donchian strategy validated as Candidate #3.

Flow:

```
observe → signal → record → next-open entry → monitor → close → evaluate → notify
```

- **No real trading orders**
- **No optimization**
- **No changes to Core / Scalper / Aegis / adaptation**

## Frozen strategy

| Rule | Value |
|------|--------|
| Entry | 20-period Donchian breakout (close > max prior 20 highs) |
| Exit | 10-period Donchian (close < min prior 10 lows) |
| Stop | 2 × Turtle N |
| Direction | Long only |
| Execution | Signal on close → **next open** fill |
| Strategy version | `turtle-candidate-03` |

If strategy rules must change, start a **new** strategy version. Do not edit this freeze in place.

## Execution assumptions (fixed)

| Item | Value |
|------|--------|
| Fee | 0.10% per side |
| Slippage | 0.05% per side |
| Same-candle stop+exit | **conservative** → stop |
| Initial capital | 10,000 USDT virtual |
| Sizing | Equal sleeve all-in (`1/5` equity per symbol when flat) — *forward-test assumption* |

## Data source

- Default: **OKX public** daily candles (`history-candles`)
- Only **closed** UTC days are processed
- Bars stored under `forward-test/candles/`
- Gaps / API failures → pause signal generation + audit + Telegram alert

## Repository layout

```
engine/engine4/
  config.js          # frozen params + paths
  strategy.js        # pure Turtle math
  data.js            # OHLCV sync + validation
  execution.js       # fills, fees, sizing
  journal.js         # append-only JSONL + state
  metrics.js         # summaries
  notifications.js   # Telegram (env credentials)
  worker.js          # bar processor
  replay.js          # historical engine check
  forward.js         # FORWARD_PAPER once-runner
  index.js

forward-test/
  signals/           # append-only per symbol
  trades/
  equity/
  state/engine4_state.json
  audit/events.jsonl
  candles/

test/engine4/unit.test.js
docs/ENGINE_4_FORWARD_TEST.md
```

## Journal schema (trade)

```
trade_id, signal_id, symbol, strategy_version, strategy_commit,
signal_time, entry_time, entry_price, initial_stop,
exit_time, exit_price, exit_reason, exit_resolution,
gross_pnl, fees, slippage, net_pnl, return_pct, holding_time, status
```

Losers are never deleted. Records are append-only.

## State / restart

`forward-test/state/engine4_state.json` holds:

- open positions
- pending next-open signals
- seen signal/trade/notification ids (idempotency)
- equity / peak / max DD
- last processed bar timestamp per symbol

After restart: no duplicate signals, no double entry, open positions recovered.

## Telegram

Environment variables (never commit secrets):

```
TELEGRAM_BOT_TOKEN=
TELEGRAM_CHAT_ID=
```

Without credentials, notifications are audited as `TELEGRAM_SKIPPED`.

## How to run

### Unit tests

```bash
node test/engine4/unit.test.js
# or full suite after package.json wire-up:
npm test
```

### Historical replay (engine correctness only)

Place `{SYMBOL}_1d.json` arrays under a directory, then:

```bash
ENGINE4_FRESH=1 node engine/engine4/replay.js /path/to/daily-json
```

### Forward paper (one shot)

```bash
ENGINE4_MODE=FORWARD_PAPER node engine/engine4/forward.js
```

Schedule daily via cron / GitHub Action **without** exchange trading keys.

### Stop

Stop the scheduler / process. State remains on disk for resume.

### Inspect

- `forward-test/trades/*.jsonl`
- `forward-test/signals/*.jsonl`
- `forward-test/equity/equity.jsonl`
- `forward-test/audit/events.jsonl`
- `forward-test/state/engine4_state.json`

## Failure handling

| Issue | Action |
|-------|--------|
| API / gap | Pause signals, audit `DATA_ERROR`, Telegram warning |
| Bad OHLC | Drop bar, do not invent candles |
| Telegram down | Audit failure; do not roll back trade |
| Process crash | Resume from state; idempotent ids |

## What this engine does **not** do

- Live exchange orders
- Parameter search
- Strategy mutation
- Manual PnL editing
- Auto-stop after a few losers
- Claim that Turtle is profitable

Forward-test data accumulates; **validation is a separate later stage**.


## Automated schedule (GitHub Actions)

Workflow: `.github/workflows/engine4-forward.yml`

| Trigger | When |
|---------|------|
| `schedule` | `20 0 * * *` (00:20 UTC daily) |
| `workflow_dispatch` | Manual from Actions tab |

### Required for live paper

1. **GitHub Actions enabled** (Billing + Actions permissions).
2. Secrets (reuse existing MaYor names or dedicated):
   - `TELEGRAM_TOKEN` / `TELEGRAM_CHAT` **or**
   - `TELEGRAM_BOT_TOKEN` / `TELEGRAM_CHAT_ID`
3. After each run, journals under `forward-test/` and `data/reports/engine4_forward_status.json` are committed.

### Manual one-shot

```bash
ENGINE4_MODE=FORWARD_PAPER npm run engine4:forward
npm run engine4:status
```

### If Actions stopped (billing)

GitHub → Settings → Billing → Actions minutes / spending limit.  
Until Actions run, no new forward rows will appear.

