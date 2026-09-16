# Scalper v1.1 — Code Review & Backtest Gate

**Date:** 2026-09-16  
**Engine:** `futures-scalper-v1.1`  
**Gate:** `scalper-statistical-gate-1`

## Standards review

| Area | Status | Notes |
|------|--------|-------|
| Isolation from MaYor | PASS | Separate config, data dir, workflow |
| Costs modeled | PASS | taker 0.04% + slip 0.03% each side |
| Lookahead | PASS | entry next bar open; closed candles only |
| Risk limits | PASS | max open, cooldown, daily cap, trade age |
| Unit tests | PASS | v1.1 minAtrPct + version asserts |

## Spec vs implementation

| Spec | Implementation |
|------|----------------|
| EMA9/21 1m signal | Yes |
| 3m+5m confirm | Yes |
| 15m soft filter | Yes |
| ATR SL ×1.1, R:R ≥1.5 | Yes |
| minAtrPct ≥0.15% | Yes (v1.1) |
| requireRecentCross | Yes (v1.1) |
| RSI soft/hard extremes | Yes (v1.1) |

## Backtest gate (sample run)

Source: OKX SWAP ~2 days (Binance geo-blocked in CI sandbox).

| Metric | Value | Gate need |
|--------|-------|-----------|
| Trades | 23 | IS≥15, OOS≥5 |
| Net % | −2.72 | OOS net > 0 |
| PF | 0.42 | PF > 1 |
| Concentration | FAIL (XRP heavy) | top-3 ≤50% |
| **Result** | **BLOCKED** | |

## Verdict

- **Code quality:** ready for continued research.
- **Edge:** **not proven**. Do not set `SCALPER_VERIFICATION_GATE_MODE=block` until a longer Binance sample shows PF>1 and OOS>0.
- **Next:** 2–4 weeks 1m data on operator machine; optional require VOL_SPIKE with cross; consider 3m base instead of 1m.

## Recommendation

`REFINE` not `DEPLOY`. Keep warn gate. Prefer MaYor `core` / higher-TF hypothesis for edge search.
