# MaYor Engine — FROZEN / STOPPED

**Effective:** 2026-09-28  
**Scope:** Core (MaYor Cloud Pro MTF), Futures Scalper v1.1, related reports  
**Still active (scheduled):** Engine #4 Turtle Candidate #3 forward paper only

---

## Status

| Component | Live / scheduled | Code kept | Research verdict |
|-----------|------------------|-----------|------------------|
| MaYor Cloud Pro MTF (Core) | **STOPPED** | Yes | `verification.json` = **BLOCKED** |
| Futures Scalper v1.1 | **STOPPED** | Yes | Historical OOS **not validated** |
| Daily / Weekly / Monthly reports | **STOPPED** (manual only) | Yes | Tied to frozen product |
| Auto Status docs | **STOPPED** (manual only) | Yes | — |
| Aegis Quant | Manual verify only | Yes | Separate track |
| **Engine #4 Turtle Forward** | **ACTIVE** schedule 00:20 UTC | Yes | Candidate edge — needs forward data |

---

## Why freeze (not delete)

- No proven post-cost edge for Core / Scalper in independent validation.
- Deleting code would erase audit trail and comparison baselines.
- GitHub Actions quota was exhausted largely by Scalper (15m) + MaYor (3h).

---

## What still runs automatically

Only:

```text
.github/workflows/engine4-forward.yml
cron: 20 0 * * *   # 00:20 UTC daily
```

Requires GitHub Actions to be **enabled** on the account (billing).

---

## Manual re-run (research only)

Actions tab → select workflow → **Run workflow**.  
Do **not** treat outputs as live trading signals.

---

## Do not

- Re-enable Scalper/MaYor schedules without a new validated edge.
- Place real capital on Core/Scalper while status is FROZEN.
- Optimize frozen rules to “rescue” old backtests.

---

## Next product focus

1. Restore Actions billing if disabled.  
2. Accumulate Engine #4 forward journals.  
3. Separate validation gate after enough closed paper trades.  
4. Only then consider a new live candidate (or Candidate #4 search).
