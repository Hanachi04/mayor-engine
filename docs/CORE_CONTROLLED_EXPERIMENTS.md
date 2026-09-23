# Core Controlled Experiments G–K

Generated: 2026-09-23T16:06:11.399980+00:00

## 1. Research Lock

Experiments **G–K** were specified before viewing their results in this run.
No additional scenarios were added after seeing outcomes.
All simulations are **offline / experimental** and do **not** modify Core production strategy.

## 2. Baseline (unchanged)

| Split | Trades | Net % | PF | Max DD % |
|-------|--------|-------|-----|----------|
| IS | 253 | -22.3952 | 0.784 | 22.4882 |
| OOS | 136 | -5.7452 | 0.861 | 12.5684 |

Fees 0.0005/side · Slip 0.0002 · `STRATEGY_MODE=core` · base 15m · BTCUSDT year dataset.

## 3. G — Cost Sensitivity

Same entries/exits; only fee/slip in PnL recomputed.

| Scenario | Fee/side | Slip | IS net | IS exp | OOS net | OOS exp | OOS PF |
|----------|----------|------|--------|--------|---------|---------|--------|
| S0_baseline | 0.0005 | 0.0002 | -22.395 | -0.0885 | -5.745 | -0.0422 | 0.861 |
| S1_zero_cost | 0 | 0 | 13.020 | 0.0515 | 13.291 | 0.0977 | 1.401 |
| S2_half_cost | 0.00025 | 0.0001 | -4.687 | -0.0185 | 3.773 | 0.0277 | 1.101 |
| S3_fee_only | 0.0005 | 0 | -12.280 | -0.0485 | -0.309 | -0.0023 | 0.992 |
| S4_slip_only | 0 | 0.0002 | 2.905 | 0.0115 | 7.855 | 0.0578 | 1.221 |

**Note:** S1 zero-cost is not a realistic live claim; it isolates cost contribution.

## 4. H — Directional Ablation

| Split | Dir | Trades | WR% | Net | PF | Exp | MaxDD |
|-------|-----|--------|-----|-----|----|-----|-------|
| IS | LONG | 120 | 48.3 | -16.123 | 0.588 | -0.1344 | 16.216 |
| IS | SHORT | 133 | 50.4 | -6.272 | 0.903 | -0.0472 | 13.445 |
| OOS | LONG | 65 | 49.2 | -7.631 | 0.618 | -0.1174 | 9.468 |
| OOS | SHORT | 71 | 63.4 | 1.885 | 1.088 | 0.0266 | 5.612 |

## 5. I — Exit Counterfactual

Assumptions: same entry price & SL; fixed target in R of `|entry−SL|`; first-touch SL vs target on 15m path; baseline fees/slip applied; max hold = `maxTradeAgeMs`.
This is **not** the production multi-TP path.

| Scenario | IS net | IS PF | OOS net | OOS PF | OOS exp |
|----------|--------|-------|---------|--------|---------|
| I0_baseline | -22.395 | 0.784 | -5.745 | 0.861 | -0.0422 |
| I1_1R | -37.303 | 0.640 | -10.732 | 0.741 | -0.0789 |
| I2_1_5R | -26.821 | 0.775 | -7.125 | 0.857 | -0.0524 |
| I3_2R | -18.623 | 0.857 | -0.035 | 0.999 | -0.0003 |

### I-4 MFE reachability (within max trade age, before requiring exit rule)

| Split | n | ≥0.5R | ≥1R | ≥1.5R | ≥2R | ≥3R | MFE/R p25 | p50 | p75 | mean |
|-------|---|-------|-----|-------|-----|-----|----------|-----|-----|------|
| IS | 253 | 91.7% | 85.0% | 78.3% | 72.3% | 58.9% | 1.76 | 3.95 | 7.66 | 5.58 |
| OOS | 136 | 94.9% | 89.7% | 82.4% | 77.9% | 63.2% | 2.26 | 4.13 | 8.19 | 8.16 |

## 6. J — Score Buckets (pre-registered)

### corePct
| Split | Bucket | Trades | WR% | Net | PF | Exp |
|-------|--------|--------|-----|-----|----|-----|
| IS | 70-80 | 5 | 20.0 | -3.324 | 0.139 | -0.6649 |
| IS | 80-90 | 55 | 47.3 | -10.465 | 0.571 | -0.1903 |
| IS | <70 | 107 | 50.5 | -1.343 | 0.968 | -0.0126 |
| IS | >=90 | 86 | 51.2 | -7.263 | 0.787 | -0.0845 |
| OOS | 70-80 | 7 | 42.9 | -1.767 | 0.288 | -0.2524 |
| OOS | 80-90 | 24 | 58.3 | -2.946 | 0.614 | -0.1228 |
| OOS | <70 | 59 | 55.9 | -1.515 | 0.913 | -0.0257 |
| OOS | >=90 | 46 | 58.7 | 0.483 | 1.035 | 0.0105 |

### mtfPct
| Split | Bucket | Trades | WR% | Net | PF | Exp |
|-------|--------|--------|-----|-----|----|-----|
| IS | <90 | 3 | 33.3 | -0.823 | 0.216 | -0.2742 |
| IS | >=99 | 250 | 49.6 | -21.573 | 0.790 | -0.0863 |
| OOS | <90 | 1 | 0.0 | -0.550 | 0.000 | -0.5504 |
| OOS | >=99 | 135 | 57.0 | -5.195 | 0.873 | -0.0385 |

Most OOS trades sit in mtfPct **≥99** (135/136); buckets below are sparse.

## 7. K — Independent Validation

Same Core logic, fees, slippage, 70/30 split. Datasets recovered from git history commit `ddc5449` (not re-committed to main).

### ETHUSDT (same calendar year as BTC baseline)

Period: 2025-08-23T00:00:00.000Z → 2026-08-22T23:59:59.999Z

| Split | Trades | WR% | Net | PF | MaxDD |
|-------|--------|-----|-----|-----|-------|
| IS | 254 | 53.9 | 17.056 | 1.133 | 21.747 |
| OOS | 112 | 53.6 | -0.017 | 1.000 | 10.216 |

### BTCUSDT historical-regression-3m (shorter window)

Period: 2026-05-23T00:00:00.000Z → 2026-08-22T23:59:59.999Z

| Split | Trades | WR% | Net | PF | MaxDD |
|-------|--------|-----|-----|-----|-------|
| IS | 37 | 48.6 | -5.346 | 0.569 | 8.111 |
| OOS | 35 | 51.4 | -2.758 | 0.753 | 4.782 |

**Sample-size note:** 3m BTC OOS has 35 trades — descriptive only.

## 8. Cross-Experiment Findings

### Observed
1. Baseline reproduced: IS 253 / −22.40%; OOS 136 / −5.75%.
2. G: Zero costs → OOS net **+13.29%**; half costs → OOS **+3.77%**; fee-only → OOS **−0.31%**; slip-only → OOS **+7.85%.
3. H: OOS LONG −7.63 (65); OOS SHORT +1.89 (71). Pattern also in IS (LONG more negative).
4. I: Fixed 1R / 1.5R OOS nets **worse or similar** to baseline; fixed 2R OOS ≈ **0**. MFE often reaches ≥1R (≈90%) and ≥2R (≈78%) within max age.
5. J: No clear monotonic improvement by corePct bucket on OOS; almost all trades have mtfPct ≥99.
6. K: ETH OOS ≈ 0 net (112 trades); ETH IS +17; BTC 3m IS/OOS both negative with small n.

### Supported Interpretation
- Transaction costs are a major driver of baseline net negativity on BTC year sample.
- LONG contributes most loss mass on the BTC year sample.
- High path MFE does **not** automatically yield higher realized R under fixed-R exits when SL can hit first; fixed higher TP alone did not produce a clearly positive OOS net under baseline costs.
- Entry scores as currently bucketed do not show a simple monotonic quality gradient on OOS.
- Negative/flat OOS appears on more than one BTC window; ETH OOS is flat, not a strong positive independent confirmation.

### Unresolved
- Whether cost reduction is achievable operationally (exchange tier, maker, etc.).
- Whether LONG weakness is structural or period-specific beyond these samples.
- Whether any exit rule can harvest MFE without increasing SL frequency enough to erase gains.

### Future Hypothesis (not tested here)
- Lower effective cost + unchanged signals might move net expectancy.
- Direction-conditioned reporting remains diagnostic, not a live rule.
- Any exit change requires a **new pre-registered** test on held-out data before strategy consideration.

## Decision Gate

**NO STRATEGY CHANGE**

- Evidence is mixed across symbols/windows.
- Counterfactual positives under zero cost are not strategy improvements.
- No consistent positive OOS across independent datasets sufficient to promote a Core change.

## Reproducibility

- Script: `/tmp/core_gk_btc.js`, `/tmp/core_k.js` (research only)
- BTC dataset hashes (sha256×16): 5m `214c39093ab76577`, 15m `90b0979862ada5ad`, 1h `b48d358f0b74faf1`, 4h `e4cf2e5fd5176b8a`
- Independent data from history commit `ddc5449`

*No Core parameters were modified.*
