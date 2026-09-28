# GitHub Actions budget policy (mayor-engine)

Updated to stop account-level **Actions disabled** from quota exhaustion.

## Active schedules (after budget cut)

| Workflow | Schedule | Notes |
|----------|----------|-------|
| Engine #4 Turtle Forward | `20 0 * * *` (00:20 UTC daily) | **Priority** — paper forward journal |
| MaYor Cloud Pro MTF | `0 12 * * *` (12:00 UTC daily) | Was every 3 hours |
| Daily Performance Report | `5 20 * * *` | Once daily |
| Auto Status docs | `15 21 * * *` | Once daily |
| Weekly Report | Friday 15:00 UTC | Weekly |
| Monthly Report | 1st of month 02:00 UTC | Monthly |

## Disabled / manual only

| Workflow | Change |
|----------|--------|
| **Futures Scalper v1.1** | Schedule **removed** (was every 15 minutes). Use **Actions → Run workflow** only. |
| Verify Aegis / Telegram test | Manual only (unchanged) |

## CI

- Still runs on PR and on push to `main` for **code** changes.
- **Ignores** pushes that only touch `data/**`, `forward-test/**`, and markdown — so bot journal commits do not burn a full `npm test` cycle.

## Expected load

Roughly **~4–6 scheduled jobs/day** instead of **100+/day**.

## If Actions still disabled

1. GitHub → Settings → Billing → enable Actions / raise spending limit.
2. Repo → Settings → Actions → Allow actions.
3. Run **Engine #4 Turtle Forward Paper** once manually.

## Local fallback (zero Actions minutes)

```bash
ENGINE4_MODE=FORWARD_PAPER npm run engine4:forward
npm run engine4:status
```
