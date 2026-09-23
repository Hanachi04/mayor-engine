# GitHub Candidate #2 Audit — sumitsaraswat362/btc-momentum-strategy

Generated: 2026-09-23T18:38:26.296386+00:00

## 1. Repository and source

| Field | Value |
|-------|-------|
| URL | https://github.com/sumitsaraswat362/btc-momentum-strategy |
| Owner | sumitsaraswat362 |
| Audited commit | `56db1912a60aec4685aff7a00946fc692fe0f9c5` |
| License | MIT (`LICENSE`) |
| Strategy files | `main.py`, `risk_manager.py`, `data_engine.py` |
| Class / core | Functions `generate_signals`, `backtest`, `RiskManager` |
| Timeframe | **Daily** (yfinance BTC-USD) |
| Exchange | Yahoo/BTC-USD (not exchange-native futures) |
| Pairs (published) | BTC-USD only |
| Entry | MA20 crosses above MA50 → long; MA20 crosses below MA50 → short |
| Exit | Opposite cross **or** stop-loss |
| Stop-loss | Grid-optimized on train; default class `0.05` |
| Take-profit | **None** (explicit design) |
| Leverage | None in code |
| Position sizing | Optional volatility targeting (`0.02 / vol`, cap 1) |
| Fees (claimed) | 0.1% per trade leg in `backtest(fee_rate=0.001)` |
| Slippage (claimed) | 0.05% |
| Published period | From 2022-01-01 (yfinance) |
| Published trades | 25 |
| Published return | **+72.19%** |
| Published win rate | 52% |
| Published PF | 1.90 |
| Published Sharpe | **3.26** |
| Published Max DD | -41.62% |

## 2. Why this candidate

- Executable, small codebase, **clear rules** (not genetic/LLM).
- Published trade count and metrics.
- Claims walk-forward / zero lookahead — worth independent falsification.
- Avoided highest-ROI black boxes from Candidate #1 class.

## 3. Source-code audit — leakage & integrity

| Location | Issue | Severity |
|----------|-------|----------|
| `generate_signals` | Uses `shift(1)` only for cross detection | OK |
| `backtest` entry | Enters at **signal bar Close** (`same_close`) | Mild optimism vs next-open |
| `backtest` returns list | Appends PnL only on exit; pads with trailing zeros under full index → **time-misaligned** `Strategy_Returns` | **Integrity bug** (metrics/equity can be wrong) |
| `main` + `optimize_strategy` | Optimizes `stop_loss_pct` on first 70%, then runs `backtest` on **entire** series including train | **IS contamination of published metrics** |
| Sharpe in `performance_metrics` | Annualizes sparse trade returns with `√252` as if daily | Misleading Sharpe |
| `normalize` / future min-max | Not present | — |
| Centered rolling | Not present | — |

**LEAKAGE (classic future-candle / full-series normalize): NO**

**METHODOLOGY CONTAMINATION: YES** — published headline numbers are not a pure held-out OOS report; SL is chosen on train then full-sample equity is reported.

We do **not** “fix” the author’s engine and call that validation of their claim.

## 4. Independent execution model

| Item | Independent |
|------|-------------|
| Data | OKX public daily OHLCV (research download); symbols BTC/ETH/SOL/BNB/XRP USDT |
| Window | 2022-01-01 → 2026-09-23 (BNB from 2022-12-20) |
| Split | Chronological **70% IS / 30% OOS** by time |
| Signal | MA20/MA50 cross on daily close (same rules) |
| Entry A | **Next day open** + slip (primary, conservative) |
| Entry B | Same-close + slip (author-like sensitivity) |
| SL | **Fixed 5%** — no OOS tuning |
| TP | None |
| Fees | 0.10% per side RT in net |
| Slip | 0.05% per side on entry/exit |
| SL vs signal same bar | SL checked on bar range; conservative |

## 5. Published vs independent (BTC)

| Metric | Published | Indep. next-open ALL | Indep. same-close ALL |
|--------|-----------|----------------------|------------------------|
| Trades | 25 | 30 | 40 |
| Win rate | 52% | 23.3% | 25.0% |
| Net | +72.19% (cum) | **−20.70%** (sum trade %) | +15.70% (sum trade %) |
| PF | 1.90 | 0.81 | 1.11 |
| Max DD | -41.62% | 61.0 (sum path) | 55.5 |

Discrepancy drivers: data vendor (Yahoo vs OKX), return compounding vs sum of trade %, SL selection path, entry timing, sizing, and the author’s full-sample reporting after train-only SL search.

## 6. Independent IS / OOS (next-open, fixed SL 5%)

| Symbol | IS n | IS net% | IS PF | OOS n | OOS net% | OOS PF | OOS WR |
|--------|------|---------|-------|-------|----------|--------|--------|
| BTCUSDT | 21 | 5.16 | 1.07 | 9 | -25.86 | 0.30 | 11.1% |
| ETHUSDT | 19 | 29.73 | 1.46 | 5 | 67.36 | 13.84 | 80.0% |
| SOLUSDT | 23 | -31.63 | 0.71 | 8 | -23.00 | 0.33 | 12.5% |
| BNBUSDT | 16 | 106.22 | 3.14 | 5 | -8.91 | 0.58 | 20.0% |
| XRPUSDT | 22 | 270.21 | 3.86 | 10 | -17.92 | 0.57 | 20.0% |

Primary OOS (BTC) **FAILS** after costs. ETH OOS positive but **n=5** only — not actionable.

## 7. Cross-symbol

- **FAILED / MIXED**: 4/5 symbols negative OOS net under next-open + costs.
- Positive pockets (ETH OOS, some IS on XRP/BNB) do **not** generalize.
- Not robust across assets.

## 8. Cost sensitivity (BTC, next-open OOS)

| Cost model | OOS net% | Trades |
|------------|----------|--------|
| zero | -23.47 | 9 |
| realistic | -25.86 | 9 |
| high | -28.25 | 9 |

Already negative at zero explicit fee (slip remains in fills for zero-fee row gross path). **Not a fee-edge that dies only at high cost** — the OOS signal path itself is weak on BTC.

## 9. Forensics (brief)

- Low win rate (~11–25% OOS) with occasional large winners — path depends on catching trends.
- OOS BTC: long and short both negative under next-open.
- Med hold ~13 days; SL exits frequent in chop.
- **Profit concentration risk**: small OOS samples (5–10 trades/symbol).
- Author claim of 52% WR not reproduced under independent daily OKX series.

## 10. Robustness

| Check | Result |
|-------|--------|
| Cost sensitivity | OOS remains poor |
| Long vs short | Both weak on BTC OOS |
| Cross-symbol | Failed |
| Sample size OOS | Too small for high confidence |

## 11. Final decision block

```
REPOSITORY: sumitsaraswat362/btc-momentum-strategy
COMMIT: 56db1912a60aec4685aff7a00946fc692fe0f9c5
STRATEGY: MA20/MA50 daily crossover long/short + stop-loss

PUBLISHED CLAIM: +72.19% return, Sharpe 3.26, PF 1.90, 25 trades, 52% WR
INDEPENDENT RESULT: BTC OOS next-open net ≈ -25.9% (9 trades, PF 0.30); cross-symbol mostly negative

LEAKAGE: NO (no future-candle normalize)
INDEPENDENT OOS: FAIL
AFTER COSTS: NEGATIVE (BTC primary)
CROSS-SYMBOL: FAILED

FINAL STATUS: EDGE NOT VALIDATED
```

## 12. Commercial screening

**Does this deserve more time searching for a post-cost edge?**

**No.** Discard → Candidate #3.

Reasons (short):
1. Independent BTC OOS negative after realistic costs.
2. Does not generalize across ETH/SOL/BNB/XRP OOS.
3. Published metrics are contaminated by train-fitted SL + full-sample reporting and a fragile returns alignment in the stock backtester.
4. Too few OOS trades for any positive pocket (ETH) to matter.

## 13. Regression / isolation

- Audit-only: no Core / Scalper / Aegis / adaptation changes.
- Deliverable: this file only.
