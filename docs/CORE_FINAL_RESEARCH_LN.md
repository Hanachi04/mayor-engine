# Core Final Research L–N

Generated: 2026-09-23T17:23:39.916211+00:00

## 1. Research Lock

- Strategy: `core` · Engine: `cloud-pro-mtf-2.1` · Base TF: `15m`
- Baseline BTCUSDT year IS 253 / −22.40% · OOS 136 / −5.75% (locked)
- Fees 0.0005/side · Slippage 0.0002 · Adaptation/ML not used
- Prior research: diagnostic A–F · controlled G–K (`dfb8233`)
- **Anti-overfitting:** no threshold search · no cherry-pick · no strategy change · research-only exit sims

### Pre-registered data split (before N selection)

| Role | Dataset | Use |
|------|---------|-----|
| Development | BTCUSDT year IS + ETHUSDT year IS | Compare architectures A–E only |
| Validation | BTCUSDT year OOS | Only if an architecture is frozen |
| Final Holdout | ETHUSDT year OOS + BTC/ETH 3m full | Only after validation recorded |

## 2. L — Expanded Independent Datasets

Source: git history commit `ddc5449` (not committed to main).

| Dataset | Period | 15m rows (approx) | Source path |
|---------|--------|-------------------|-------------|
| BTCUSDT_year | 2025-08-23→2026-08-22 | 35040 | data/historical/ |
| ETHUSDT_year | same | 35040 | data/historical/ |
| BNBUSDT_year | same | 35040 | data/historical/ |
| SOLUSDT_year | same | 35040 | data/historical/ |
| BTCUSDT_3m | 2026-05-23→2026-08-22 | 8832 | data/historical-regression-3m/ |
| ETHUSDT_3m | same | 8832 | data/historical-regression-3m/ |

Hashes (sha256×16 of 15m files): BTC year `90b0979862ada5ad` · ETH year `db69665f9fef0602` · BNB year `eb26a2e4ce91fda8` · SOL year `cfec3842b1cffbf7` · BTC 3m `09c21cf177a9f741` · ETH 3m `d53b3eba59d44a68`.

## 3. L — Baseline Core Results (unchanged strategy)

| Dataset | Split | Trades | Net % | PF | Max DD % | Class |
|---------|-------|--------|-------|-----|----------|-------|
| BTCUSDT_year | IS | 253 | -22.395 | 0.784 | 22.49 | negative |
| BTCUSDT_year | OOS | 136 | -5.745 | 0.861 | 12.57 | negative |
| ETHUSDT_year | IS | 254 | 17.056 | 1.133 | 21.75 | positive |
| ETHUSDT_year | OOS | 112 | -0.017 | 1.000 | 10.22 | approximately flat |
| BNBUSDT_year | IS | 263 | -27.362 | 0.779 | 29.62 | negative |
| BNBUSDT_year | OOS | 132 | -8.920 | 0.811 | 13.78 | negative |
| SOLUSDT_year | IS | 262 | 9.063 | 1.061 | 30.00 | positive |
| SOLUSDT_year | OOS | 158 | -6.017 | 0.919 | 18.73 | negative |
| BTCUSDT_3m | IS | 37 | -5.346 | 0.569 | 8.11 | insufficient sample |
| BTCUSDT_3m | OOS | 35 | -2.758 | 0.753 | 4.78 | insufficient sample |
| ETHUSDT_3m | IS | 33 | -5.750 | 0.635 | 8.81 | insufficient sample |
| ETHUSDT_3m | OOS | 26 | -1.861 | 0.839 | 6.41 | insufficient sample |

### LONG / SHORT OOS attribution

| Dataset | LONG n / net | SHORT n / net |
|---------|--------------|---------------|
| BTCUSDT_year | 65 / -7.631 | 71 / 1.885 |
| ETHUSDT_year | 47 / -4.868 | 65 / 4.852 |
| BNBUSDT_year | 88 / -5.302 | 44 / -3.617 |
| SOLUSDT_year | 71 / -1.642 | 87 / -4.375 |
| BTCUSDT_3m | 24 / -0.600 | 11 / -2.158 |
| ETHUSDT_3m | 20 / 0.067 | 6 / -1.928 |

### L stability answers

1. **Negative expectancy outside BTC baseline?** Yes on several OOS windows (BNB −8.9, SOL −6.0, BTC 3m −2.8, ETH 3m −1.9). ETH year OOS approximately flat (−0.02).
2. **LONG loss concentration?** Often yes (BTC/ETH year OOS LONG negative while SHORT flat/positive), but not universal (SOL SHORT also negative; BNB both negative).
3. **Cost sensitivity?** Supported by prior G and by gross vs fees on ETH OOS (gross +11.2 vs fees 11.2 → net ≈0).
4. **High MFE / low realized R?** Supported on BTC year prior research; not re-derived as a strategy change.
5. **Symbol/regime sensitivity?** High — IS can be positive (ETH, SOL) while OOS is flat/negative.

## 4. M — Execution Cost Reality

### M1 Execution environment

From repo: Core data endpoints include `api.binance.com` / `data-api.binance.vision`; scalper docs reference Binance futures. Exact live order type (maker vs taker) for Core signals is **not fully specified**.

**EXECUTION ENVIRONMENT: PARTIALLY SPECIFIED (Binance-oriented; futures vs spot path ambiguous for Core)**

### M2 Fee assumptions

- Baseline model: `takerFeeRate = 0.0005` per side (0.10% round-trip).
- Binance USD-M Futures Regular User published taker ≈ **0.0500%** per side (matches baseline).
- Spot Regular is often higher (~0.10% per side) — if Core executed as spot taker, baseline **understates** fees.
- VIP / BNB discounts exist but are **not** assumed here (would require volume tier evidence).

### M3 Slippage

**SLIPPAGE REALISM: NOT DIRECTLY MEASURED** (no order-book / trade-level fills in dataset).
Baseline uses fixed 0.0002/side for comparison only.

### M4 Cost components in model

- Fees: yes (taker×2)
- Slippage: yes (fixed)
- Spread: not modeled separately
- Funding: not modeled

### M5 Cost conclusion

**Costs materially affect economics** on the measured samples (gross often positive while net is flat/negative).
Does **not** imply “lower fees solve the strategy.”

## 5. N — Exit Architectures (pre-registered)

| ID | Definition |
|----|------------|
| A | Baseline multi-TP / SL / timeout (control) |
| B | Fixed +1R TP, same initial SL, SL-first same-bar |
| C | Fixed +2R TP, same initial SL |
| D | 50% at +1R, 50% runner to +2R, remainder under SL/expiry |
| E | After +1R move SL to breakeven; retain baseline TP levels |

Entry lock: same Core entries, timing, initial SL, fees, slippage.

## 6. Development Results (BTC IS + ETH IS only)

| Arch | BTC IS net | BTC IS PF | ETH IS net | ETH IS PF |
|------|------------|-----------|------------|-----------|
| A | -22.395 | 0.784 | 17.056 | 1.133 |
| B | -37.303 | 0.640 | -16.949 | 0.868 |
| C | -18.623 | 0.857 | 12.860 | 1.077 |
| D | -28.621 | 0.737 | -13.660 | 0.898 |
| E | -65.108 | 0.403 | -57.203 | 0.575 |

## 7. Frozen Selection

**SELECTED ARCHITECTURE: NO ARCHITECTURE SELECTED**

Reason: no candidate improved **both** Development sets coherently vs control A.
- B, D, E worse on both.
- C slightly less negative on BTC IS but **worse** on ETH IS than A.

## 8. Validation Results

**Not run formally** — no architecture was frozen for promotion.

(Research log only — BTC OOS under C was approximately flat; this is **not** used as selection.)

## 9. Final Holdout

**FINAL HOLDOUT: BLOCKED** for exit-architecture confirmation (no selected architecture).

Baseline A descriptive holdout (not an architecture promotion):

| Set | Trades | Net % | PF |
|-----|--------|-------|-----|
| ETH year OOS | 112 | -0.017 | 1.000 |
| BTC 3m full | 72 | -8.105 | 0.657 |
| ETH 3m full | 59 | -7.611 | 0.721 |

## 10. Cross-Dataset Interpretation

### Observed
- Core OOS net is negative or flat on most expanded sets.
- IS can be positive on some symbols (ETH, SOL) without OOS confirmation.
- LONG often concentrates losses but not always.
- Pre-registered exit variants B–E did not dominate A on Development.

### Supported
- Costs material to net outcomes under baseline fee assumptions aligned with Binance futures regular taker.
- No durable Core edge validated across independent OOS windows.
- Exit architecture changes as pre-registered are not supported for promotion.

### Inconclusive
- Whether maker-capable execution would change outcomes enough to matter.
- Whether symbol-specific regimes drive IS/OOS flips.

### Unproven
- Any claim of profitable Core after exit redesign.
- Slippage realism beyond fixed model.

## Decision Gate

**CORE EDGE NOT VALIDATED**

Most independent OOS evaluations are negative or approximately flat; no exit architecture selected; no strategy change.

## Regression checklist

- Research report only
- No production strategy code change
- Large datasets not committed
