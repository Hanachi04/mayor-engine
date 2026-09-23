# GitHub Candidate #1 Audit — ceyhanmolla/freqtrade-strategies

Generated: 2026-09-23T18:00:02.629628+00:00

## 1. Repository

| Field | Value |
|-------|-------|
| Repo | https://github.com/ceyhanmolla/freqtrade-strategies |
| Commit SHA | `937fefc25ef209120fa2a59d2f520f52d991f26b` |
| Snapshot | `937fefc` — Add strategy files, keep README.md |
| License | **Not specified** in repository root (no LICENSE file observed) |
| Framework | Freqtrade 2026.4 (claimed) / Docker |
| Exchange (claimed) | Binance Spot |
| Stake model (claimed) | Unlimited / balance split; max open trades 5 |

**README is treated as marketing claims, not evidence.**

## 2. Strategy candidates selected (≤5)

| # | Strategy | TF | Why selected |
|---|----------|-----|--------------|
| 1 | GeneticEngineV1 | 5m | Strongest published claim; complete code |
| 2 | TrendFollowingStrategyV2 | 5m | Clear entry/exit; executable |
| 3 | EwoMomentumV1 | 5m | Simple EWO logic; published strong |
| 4 | FSampleStrategy | 1h | Minimal indicators; low trade count specialist |
| 5 | AdaptiveMomentum | 15m | Multi-signal + custom exit (code audit only; complex DCA) |

Not selected for full independent run: ContraRatings (complex multi-TF ratings), EVX (negative published), Pivot/Yigit variants (less specified).

## 3. Published claims (from README — unverified)

| Strategy | Period (claimed) | Profit | Trades | Win% | DD |
|----------|------------------|--------|--------|-----|-----|
| GeneticEngineV1 | 2026-02-08→05-13 | +42.56% | 183 | 98.9% | 1.65% |
| FSampleStrategy | same table | +15.72% | 18 | 55.6% | 3.32% |
| TrendFollowingV2 | same | +8.39% | 53 | 75.5% | 9.87% |
| AdaptiveMomentum | same | +3.83% | 154 | 89.6% | 10.24% |
| EwoMomentumV1 | same | +3.76% | 171 | 77.2% | 13.97% |

Internal docstring of GeneticEngine also cites different numbers (+23.35%, 343 trades, 93% WR) — **published figures are inconsistent across files**.

## 4. Code audit (summary)

### GeneticEngineV1
- Hyperoptable Categorical/Decimal parameters; defaults in `buy_params` / `sell_params`.
- Gene pool of TA-Lib indicators; **3 AND conditions** for entry/exit.
- Risk: `stoploss=-0.10`, trailing stop, `minimal_roi` (class body uses 0.5%–2.5% ladder).
- `can_short=False`, `timeframe=5m`, `startup_candle_count=110`.
- Parameters are clearly **hyperopt-oriented** (optimized appearance).

### TrendFollowingStrategyV2
- Entry: close crosses above EMA20 + rising OBV + 1h close > EMA50.
- Exit: close crosses below EMA20 with rising OBV.
- SL -15%, trailing 5%/10% offset, ROI ladder 15%/10%/5%.

### EwoMomentumV1
- EWO = (SMA50−SMA200)/close×100; RSI filter; no exit signal (ROI/trailing/SL only).
- ROI table values look like **possible unit typos** (0.5 = 50% in Freqtrade units).

### FSampleStrategy
- RSI cross 30 + TEMA ≤ BB mid + rising TEMA; exit RSI cross 70 + TEMA falling above mid.
- SL -5%; ROI effectively disabled (`0: 1` = 100%).

## 5. Leakage audit

| Strategy | Finding | Severity |
|----------|---------|----------|
| **GeneticEngineV1** | `normalize()` uses **full-series** `min()`/`max()` on indicator series before comparisons (`gene_calculator` → `dataframe[indicator] = normalize(result)`). At time *t*, normalized value depends on future extremes. | **CRITICAL look-ahead** |
| GeneticEngineV1 | Hyperopt spaces invite in-sample fitting; defaults present as “pasted results”. | High overfitting risk |
| TrendFollowingV2 | Uses `.shift(1)` only (past). Informative 1h alignment relies on Freqtrade `@informative` (standard). | No material leakage found in entry formula |
| EwoMomentumV1 | Standard SMA/RSI; no negative shifts. | No material leakage found |
| FSampleStrategy | `shift(1)` for crosses only. | No material leakage found |
| AdaptiveMomentum | Custom exit via `dp.get_analyzed_dataframe` — needs live DP; not fully audited in isolation. | Complexity / non-isolated |

**GeneticEngineV1 is classified INVALID BACKTEST for any claim relying on this normalization.**

Do **not** treat a “fixed” causal-normalize rewrite as the original strategy.

## 6. Dataset (independent)

| Item | Value |
|------|-------|
| Source | mayor-engine history commit `ddc5449` `data/historical/*` |
| Symbols | BTC/ETH/SOL/BNB/XRP USDT |
| 5m bars | 105120 (~2025-08-23 → 2026-08-22 UTC) |
| 1h bars | available same window |
| Split | Chronological 70% IS / 30% OOS by time |
| Holdout | Not reserved beyond OOS (single split) |

Author’s published window (2026-02→05) is **not** the only period tested.

## 7. Execution assumptions (independent)

| Item | Independent model |
|------|-------------------|
| Entry | Next bar open after signal close |
| Exit | ROI level / SL / trailing / exit signal on bar (conservative) |
| Fee | **0.10% per side** (Binance spot retail-scale taker) |
| Slippage | **0.02% per side** |
| Shorting | Disabled (matches strategies) |
| Position | One position at a time per symbol in harness |

Author README does not clearly state fee/slippage; Freqtrade defaults are often lower if maker/BNB assumed.

## 8. Published vs independent

GeneticEngine published +42% / 98.9% WR **cannot be validated** due to leakage; independent reproduction of the gene defaults produced **no trades** under a naive port (parameter/operator mapping + normalize interaction).

For non-leaky simpler strategies, independent **IS is largely negative** after costs; OOS is mixed and thin.

## 9. Independent IS/OOS results

Costs: fee 0.1%/side + slip 0.02%/side.

### TrendFollowingStrategyV2 (5m)

| Symbol | IS trades | IS net% | OOS trades | OOS net% | OOS PF |
|--------|-----------|---------|------------|----------|--------|
| BTCUSDT | 12 | -42.86 | 8 | -7.84 | 0.752 |
| ETHUSDT | 35 | -73.37 | 13 | 12.85 | 1.370 |
| SOLUSDT | 45 | -65.78 | 15 | 5.40 | 1.115 |
| BNBUSDT | 25 | -20.99 | 5 | -1.99 | 0.878 |
| XRPUSDT | 36 | -68.62 | 13 | 14.90 | 1.456 |

### EwoMomentumV1 (5m)

| Symbol | IS trades | IS net% | OOS trades | OOS net% | OOS PF |
|--------|-----------|---------|------------|----------|--------|
| BTCUSDT | 39 | -24.95 | 14 | -2.09 | 0.934 |
| ETHUSDT | 93 | -82.65 | 18 | 2.00 | 1.058 |
| SOLUSDT | 115 | -85.53 | 32 | 0.09 | 1.001 |
| BNBUSDT | 75 | 11.69 | 21 | 12.63 | 1.406 |
| XRPUSDT | 92 | -108.80 | 28 | -14.76 | 0.786 |

### FSampleStrategy (1h)

| Symbol | IS trades | IS net% | OOS trades | OOS net% | OOS PF |
|--------|-----------|---------|------------|----------|--------|
| BTCUSDT | 13 | -57.92 | 4 | 6.41 | 1.408 |
| ETHUSDT | 28 | -65.59 | 8 | 6.36 | 1.202 |
| SOLUSDT | 14 | -73.33 | 7 | -13.61 | 0.567 |
| BNBUSDT | 11 | -46.59 | 2 | 19.66 | 4.753 |
| XRPUSDT | 18 | -94.28 | 7 | 20.41 | 1.779 |

**Note:** Independent harness approximates Freqtrade (no exact stake packing, no exact informative merge for TrendFollowing 1h filter omitted in this port — **bias toward more entries**). Even so, IS fails broadly.

## 10. Cross-symbol / generalization

- No strategy shows **consistent positive OOS across all five symbols** after costs.
- Where OOS is positive (e.g. some FSample/XRP, TrendFollowing/XRP), **trade counts are small** (often <15) → concentration risk.
- IS drawdowns are large (tens of percent summed trade net on the harness’s %-of-price accounting).

## 11. Forensics

Not expanded to MAE/MFE for a “promising” candidate — **no candidate cleared integrity + robust multi-symbol OOS**.
GeneticEngine: leakage dominates any forensics on published equity.

## 12. Cost sensitivity

- Independent model uses **spot-like taker fees**; if author used near-zero fees, published nets would look better.
- Strategies with high trade frequency (EWO) are **cost-sensitive**.
- FSample fewer trades → less fee drag, but IS still negative → edge not established.

## 13. Reproducibility

| Item | Value |
|------|-------|
| Candidate commit | `937fefc25ef209120fa2a59d2f520f52d991f26b` |
| Data source | ddc5449 historical OHLCV |
| Harness | `/tmp/cand01_backtest.py` (research-only) |
| Results JSON | `/tmp/cand01_results.json` |

## 14. Final status (per candidate)

| Strategy | Status |
|----------|--------|
| GeneticEngineV1 | **INVALID BACKTEST** (full-series normalize look-ahead) |
| TrendFollowingStrategyV2 | **EDGE NOT VALIDATED** |
| EwoMomentumV1 | **EDGE NOT VALIDATED** |
| FSampleStrategy | **EDGE NOT VALIDATED** (small OOS samples; weak IS) |
| AdaptiveMomentum | **EDGE INCONCLUSIVE** (not fully independently executed; complexity) |

## 15. Recommendation

**Discard Candidate #1 repository as a source of validated edge.**

- Do not invest further time “fixing” GeneticEngine while presenting it as the original.
- Move to **Candidate #2** (different repository) for commercial edge search.
- Optional later work: only if a new repo passes leakage audit and multi-symbol OOS after costs.

## 16. Regression / isolation

- This audit does not modify Mayor Core, Scalper, or Aegis production logic.
- Report only committed under `docs/`.
