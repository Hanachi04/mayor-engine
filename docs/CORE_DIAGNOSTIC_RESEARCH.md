# Core Diagnostic Research (Pre-registered)

Generated: 2026-09-23T15:37:39.475996+00:00

**Purpose:** Descriptive diagnosis of Mayor/Core expectancy weakness on the fixed BTCUSDT baseline.
**Not purpose:** Strategy optimization, parameter search, or claiming a profitable edge.

## 1. Baseline

| Field | Value |
|-------|-------|
| Strategy | `core` |
| Engine | `cloud-pro-mtf-2.1` |
| Base TF | `15m` |
| Symbol | BTCUSDT |
| Period | 2025-08-23 → 2026-08-22 UTC |
| Fees | taker `0.0005` per side |
| Slippage | `0.0002` |
| Adaptation / ML | not used in this backtest |

| Split | Trades | Win rate | Net % | PF | Max DD % |
|-------|--------|----------|-------|-----|----------|
| IS | 253 | 49.41% | -22.3952 | 0.784 | 22.4882 |
| OOS | 136 | 56.62% | -5.7452 | 0.861 | 12.5684 |

Baseline measurement previously audited as **VALID** (no look-ahead / leakage found). Gate remains **BLOCKED**.

## 2. Methodology

- Trades taken from `engine/backtest.js` `runWindow` with `STRATEGY_MODE=core` (unchanged rules).
- IS/OOS: 70/30 chronological split on base series timestamps.
- **MAE/MFE:** On base (15m) bars from entry to exit, favorable = move toward profit from entry, adverse = move against; reported in % of entry and as fraction of initial risk `|entry−SL|`.
- Costs: `grossPct` from slipped fills; `feesPct = 2 × takerFeeRate × 100`; net as engine reports.
- Scores: existing `corePct`, `mtfPct`, `rr`, holding time only — no new features or models.
- Time buckets: OOS only, descriptive; small-n buckets are unreliable.

## 3. MAE / MFE Path Analysis

### IS
**winners**
- MFE/R: n=125, mean=1.553, median=1.294, p25=1.134, p75=1.549
- MAE/R: n=125, mean=0.390, median=0.329, p25=0.168, p75=0.577
- Realized R: n=125, mean=1.184, median=1.000, p25=1.000, p75=1.000

**losers**
- MFE/R: n=128, mean=0.418, median=0.388, p25=0.130, p75=0.670
- MAE/R: n=128, mean=1.320, median=1.183, p25=1.056, p75=1.388
- Realized R: n=128, mean=-1.000, median=-1.000, p25=-1.000, p75=-1.000

### OOS
**winners**
- MFE/R: n=77, mean=1.436, median=1.324, p25=1.092, p75=1.526
- MAE/R: n=77, mean=0.361, median=0.323, p25=0.125, p75=0.520
- Realized R: n=77, mean=1.156, median=1.000, p25=1.000, p75=1.000

**losers**
- MFE/R: n=59, mean=0.434, median=0.464, p25=0.153, p75=0.686
- MAE/R: n=59, mean=1.268, median=1.197, p25=1.067, p75=1.347
- Realized R: n=59, mean=-1.000, median=-1.000, p25=-1.000, p75=-1.000

**Observed:** Winners show median MFE/R ≈ 1.3 with realized R ≈ 1.0. Losers show median MFE/R ≈ 0.4–0.5 and MAE/R ≈ 1.2 with realized R = −1.0.

**Interpretation:** Many winners do reach about +1R of favorable excursion and exit near that (TP1). Losers rarely produce large favorable excursion before full adverse 1R stop.

## 4. Long / Short Attribution

### IS
| Dir | N | WR% | Gross | Fees | Net | PF | Avg | Med | AvgW | AvgL | MaxDD | MaxLStreak | Hold-h |
|-----|---|-----|-------|------|-----|----|-----|-----|------|------|-------|------------|--------|
| LONG | 120 | 48.3 | -4.123 | 12.00 | -16.123 | 0.588 | -0.1344 | -0.3690 | 0.3970 | -0.6314 | 16.216 | 6 | 233.7 |
| SHORT | 133 | 50.4 | 7.028 | 13.30 | -6.272 | 0.903 | -0.0472 | 0.1623 | 0.8696 | -0.9778 | 13.445 | 5 | 213.7 |

### OOS
| Dir | N | WR% | Gross | Fees | Net | PF | Avg | Med | AvgW | AvgL | MaxDD | MaxLStreak | Hold-h |
|-----|---|-----|-------|------|-----|----|-----|-----|------|------|-------|------------|--------|
| LONG | 65 | 49.2 | -1.131 | 6.50 | -7.631 | 0.618 | -0.1174 | -0.3552 | 0.3854 | -0.6049 | 9.468 | 6 | 98.2 |
| SHORT | 71 | 63.4 | 8.985 | 7.10 | 1.885 | 1.088 | 0.0266 | 0.2918 | 0.5189 | -0.8256 | 5.612 | 5 | 121.5 |

**Observed:** On this sample, LONG accounts for most negative net in both IS and OOS; OOS SHORT is slightly net-positive after fees.

**Interpretation:** Loss mass is directionally concentrated toward LONG in this dataset — not proof that SHORT is a tradable edge.

## 5. Trade-Frequency / Cost Economics

| Split | N | Σ Gross | Σ Fees | Σ Net | Fee/trade | Gross exp/trade | Net exp/trade |
|-------|---|---------|--------|-------|-----------|-----------------|---------------|
| IS | 253 | 2.9048 | 25.3000 | -22.3952 | 0.1000 | 0.0115 | -0.0885 |
| OOS | 136 | 7.8548 | 13.6000 | -5.7452 | 0.1000 | 0.0578 | -0.0422 |
| ALL | 389 | 10.7596 | 38.9000 | -28.1404 | 0.1000 | 0.0277 | -0.0723 |

OOS contribution (net space): winners **+35.68**; losers **−41.43**; fees **−13.60** (fees already in net path; listed for scale).

**Observed:** Gross sum is positive IS and OOS; fee load (0.10% round-trip × N) exceeds gross edge.

**Interpretation:** Expectancy failure is consistent with a thin gross edge consumed by transaction costs and asymmetric win/loss sizes — not with zero gross skill alone.

## 6. Exit Path / R Realization

### IS
| Exit | Count | % | Σ Net | Avg Net | Avg R | Med R |
|------|-------|---|-------|---------|-------|-------|
| SL | 128 | 50.6 | -103.680 | -0.8100 | -1.000 | -1.000 |
| TP1 | 109 | 43.1 | 58.240 | 0.5343 | 1.000 | 1.000 |
| TP2 | 9 | 3.6 | 10.421 | 1.1579 | 2.000 | 2.000 |
| TP3 | 7 | 2.8 | 12.624 | 1.8034 | 3.000 | 3.000 |

### OOS
| Exit | Count | % | Σ Net | Avg Net | Avg R | Med R |
|------|-------|---|-------|---------|-------|-------|
| SL | 59 | 43.4 | -41.427 | -0.7022 | -1.000 | -1.000 |
| TP1 | 67 | 49.3 | 27.729 | 0.4139 | 1.000 | 1.000 |
| TP2 | 8 | 5.9 | 6.370 | 0.7963 | 2.000 | 2.000 |
| TP3 | 2 | 1.5 | 1.583 | 0.7913 | 3.000 | 3.000 |

**Observed:** No timeouts in this sample. OOS: SL 43.4%, TP1 49.3%, TP2 5.9%, TP3 1.5%. Winners mostly TP1 (R≈1); losers SL (R=−1).

**Interpretation:** Theoretical multi-TP RR rarely materializes beyond TP1, so realized reward distribution is closer to ~1R wins vs 1R losses, then fees tip expectancy negative.

## 7. Score Separation (existing scores only)

### IS
| Score | Winners (mean / median) | Losers (mean / median) |
|-------|-------------------------|------------------------|
| corePct | 84.960 / 81.500 | 83.221 / 81.500 |
| mtfPct | 99.861 / 100.000 | 99.728 / 100.000 |
| rr | 3.000 / 3.000 | 3.000 / 3.000 |
| holdH | 1.512 / 1.000 | 2.020 / 1.250 |
| mfeR | 1.553 / 1.294 | 0.418 / 0.388 |
| maeR | 0.390 / 0.329 | 1.320 / 1.183 |

### OOS
| Score | Winners (mean / median) | Losers (mean / median) |
|-------|-------------------------|------------------------|
| corePct | 81.478 / 81.500 | 83.278 / 75.300 |
| mtfPct | 100.000 / 100.000 | 99.705 / 100.000 |
| rr | 3.000 / 3.000 | 3.000 / 3.000 |
| holdH | 1.357 / 0.750 | 1.953 / 1.500 |
| mfeR | 1.436 / 1.324 | 0.434 / 0.464 |
| maeR | 0.361 / 0.323 | 1.268 / 1.197 |

**Observed:** `corePct` and `mtfPct` are similar for winners and losers. `mfeR`/`maeR` differ strongly by construction of outcome.

**Interpretation:** Existing entry strength scores do not clearly separate outcomes on this sample.

## 8. Time Distribution (OOS descriptive)

**Warning:** Many hour/DOW buckets have very small n; not usable as filters or edge claims.

### By month
| Month | N | WR% | Net | Avg |
|-------|---|-----|-----|-----|
| 2026-05 | 33 | 57.6 | -2.341 | -0.0709 |
| 2026-06 | 47 | 68.1 | 4.642 | 0.0988 |
| 2026-07 | 25 | 40.0 | -5.902 | -0.2361 |
| 2026-08 | 31 | 51.6 | -2.144 | -0.0692 |

### By UTC hour (all hours present in sample)
| Hour | N | WR% | Net | Avg |
|------|---|-----|-----|-----|
| 0 | 7 | 85.7 | 2.372 | 0.3388 |
| 1 | 5 | 60.0 | 0.592 | 0.1184 |
| 2 | 5 | 60.0 | 0.129 | 0.0257 |
| 3 | 7 | 71.4 | 0.151 | 0.0216 |
| 4 | 3 | 33.3 | -1.568 | -0.5226 |
| 6 | 4 | 100.0 | 1.981 | 0.4953 |
| 7 | 6 | 83.3 | 0.431 | 0.0718 |
| 8 | 6 | 83.3 | 0.933 | 0.1556 |
| 9 | 9 | 55.6 | -1.270 | -0.1411 |
| 10 | 5 | 40.0 | -1.491 | -0.2983 |
| 11 | 3 | 66.7 | -0.396 | -0.1319 |
| 12 | 6 | 66.7 | 2.077 | 0.3462 |
| 13 | 8 | 50.0 | -0.244 | -0.0304 |
| 14 | 9 | 77.8 | 2.343 | 0.2603 |
| 15 | 11 | 36.4 | -2.240 | -0.2036 |
| 16 | 14 | 35.7 | -3.842 | -0.2745 |
| 17 | 5 | 100.0 | 2.327 | 0.4654 |
| 18 | 5 | 0.0 | -3.994 | -0.7989 |
| 19 | 3 | 33.3 | -0.773 | -0.2577 |
| 20 | 3 | 66.7 | 0.532 | 0.1775 |
| 21 | 5 | 40.0 | -0.925 | -0.1849 |
| 22 | 4 | 25.0 | -1.844 | -0.4610 |
| 23 | 3 | 33.3 | -1.027 | -0.3425 |

### By day-of-week (JS: 0=Sunday)
| DOW | N | WR% | Net | Avg |
|-----|---|-----|-----|-----|
| 0 | 4 | 25.0 | -1.331 | -0.3326 |
| 1 | 19 | 68.4 | 0.614 | 0.0323 |
| 2 | 33 | 54.5 | -1.977 | -0.0599 |
| 3 | 25 | 68.0 | 2.017 | 0.0807 |
| 4 | 14 | 57.1 | 1.378 | 0.0984 |
| 5 | 28 | 42.9 | -5.613 | -0.2005 |
| 6 | 13 | 61.5 | -0.834 | -0.0641 |

**Observed:** OOS monthly nets vary (e.g. 2026-06 positive, 2026-07 negative). Losses are not a single-day artifact but are uneven across months.

## 9. Findings

### Observed
1. Baseline reproduced: IS 253 / −22.40%; OOS 136 / −5.75%.
2. Gross positive; fees dominate.
3. Realized payoff ≈ TP1 (+1R) vs SL (−1R); rare TP2/TP3.
4. Winners reach MFE/R ~1.3 median; losers MFE/R ~0.4 median.
5. LONG concentrates losses; SHORT less negative / slightly positive OOS.
6. Entry scores (core/mtf) do not separate winners from losers.

### Interpretation
- Failure mode fits **thin gross edge + fee load + 1R-vs-1R realization**, with **LONG-heavy loss mass** on this dataset.
- Not interpreted as proof of future profitability or of a fix.

### Hypotheses (for later controlled tests only — not executed)
1. Fee load exceeds structural edge at current trade frequency.
2. LONG leg drives most of the sample loss.
3. Multi-TP structure rarely converts MFE beyond ~1R into realized gains.
4. Entry scores lack outcome calibration on this sample.
5. Negative expectancy is structural across IS (not OOS-only).

## 10. Reproducibility

| Item | Value |
|------|-------|
| Dataset | `data/historical/BTCUSDT_{5m,15m,1h,4h}.json` from commit `ddc5449` |
| Hashes (sha256×16) | 5m `214c39093ab76577`, 15m `90b0979862ada5ad`, 1h `b48d358f0b74faf1`, 4h `e4cf2e5fd5176b8a` |
| Strategy mode | core |
| Engine | cloud-pro-mtf-2.1 |
| Command | `STRATEGY_MODE=core BACKTEST_SYMBOLS=BTCUSDT node engine/backtest.js` |
| Diagnostic | `/tmp/core_research.js` (analysis only; no strategy change) |
| IS/OOS | 70/30 by time on base series |

---
*Diagnostic research only. No strategy parameters were modified.*
