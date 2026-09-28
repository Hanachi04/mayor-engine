# GitHub Actions budget policy (mayor-engine)

## Product freeze (2026-09-28)

**MaYor Cloud Pro MTF + Scalper + related reports = FROZEN / STOPPED.**

See `docs/MAYOR_ENGINE_FROZEN.md`.

## Only scheduled workflow

| Workflow | Schedule |
|----------|----------|
| **Engine #4 Turtle Forward Paper** | `20 0 * * *` (00:20 UTC daily) |

## Manual only (no cron)

- MaYor Cloud Pro MTF  
- Futures Scalper v1.1  
- Daily / Weekly / Monthly performance reports  
- Auto Status Documentation  
- Verify Aegis / Telegram test / CI (on code push & PR)

## CI

Ignores pure `data/**`, `forward-test/**`, and markdown pushes.

## Expected load

**~1 scheduled job/day** (Engine #4), plus CI on real code changes.

## If Actions disabled on account

GitHub → Settings → Billing → enable Actions / spending limit.  
Repo → Settings → Actions → Allow actions.
