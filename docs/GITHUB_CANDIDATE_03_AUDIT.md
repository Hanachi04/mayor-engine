# Candidate #3

Generated: 2026-09-23T18:47:55.950882+00:00

## Repository

| Field | Value |
|-------|-------|
| Repository | https://github.com/pplonski/turtle-trading-python |
| Owner | pplonski |
| Commit | `2ee88cf35cc74f3cdc6f8fdc1328b8002d565052` |
| Strategy | Turtle Trading (Donchian breakout) |
| License | MIT |
| Timeframe | Daily channel + hourly monitoring in original; **independent test uses daily** |
| Assets (repo) | BTCUSDT, ETHUSDT sample CSVs to ~2020-02 |
| Entry | Prior-hour close > 20-day high (Donchian upper from `High.shift(1).rolling(20).max()`) |
| Exit | Stop at entry − 2N, or 10-day low channel |
| Stop | 2 × Turtle N (Wilder-like ATR on daily TR) |
| Take Profit | None (channel exit) |
| Position sizing | 100% capital (all-in) in original |
| Fees (repo) | 0.1% |
| Slippage (repo) | Implicit via mid Open/Close fill |
| Published period | Binance data through ~2020-02-04 |
| Published trades | 13 (BTC sample output) |
| Published return | Capital 1000 → ~3513 (**+251%**) |
| Published WR | ~53.8% success rate |
| Published PF / Sharpe / Max DD | **Not published** |
| Forward/live evidence | **None** |

## Published Claim

README documents a BTC run ending capital **3513.47** from 1000 (~+251%) with success rate ~0.54 over listed trades (2017–2020 sample). No multi-year OOS table, no PF/Sharpe, no live track record.

## Source Audit

- Executable single-file `backtest.py` + bundled CSVs.
- Clear Turtle-style rules; long-only.
- Author explicitly avoids using same-row High/Low for channel construction (`shift(1)`).
- Entry fill uses **average of current hour Open and Close** → mild same-bar information.

## Leakage Audit

| Check | Result |
|-------|--------|
| `shift(-N)` / future close in signal | **Not found** for channel |
| Channel high/low | `shift(1).rolling(...)` — **causal** |
| Full-dataset normalize min/max | **No** |
| N calculation | Causal recursive from past TR |
| Same-candle entry fill | **Yes (mild)**: fill = (Open+Close)/2 of signal hour |
| Parameter fit on OOS | **No** fixed 20/10/2N |

**LEAKAGE (material future-series): NO**

**Execution optimism: YES (mild)** — same-bar close enters the average fill price.

Independent tests below use **next-day open** fills only (stricter than the repo).

## Original Backtest Audit

- Fees applied 0.1% on entry notionals and exits.
- Long-only, all-in sizing inflates % returns vs fractional risk units.
- Data ends early 2020 — no published post-2020 validation in repo.
- Success rate mixes units of “positions” not a full statistical package.

## Independent Reproduction

Window restricted to ≤ 2020-02-05 on OKX daily BTC, rules: Donchian 20 entry / 10 exit / 2N stop, **next-open** entry, fee 0.1%/side, slip 0.05%/side:

- Trades: **11** (repo listed 13)
- Win rate: **36.4%** (repo ~53.8%)
- Net sum of trade %: **109.6%** (not identical to compounded all-in equity)
- PF: **2.75**

**REPRODUCTION = PARTIAL** — same direction (positive on 2017–2020 BTC) but not numerically identical (daily vs hourly engine, next-open vs mid-bar, data vendor).

## Independent OOS

Chronological **70% IS / 30% OOS** on full OKX daily history. Fixed parameters. No tuning.

| Symbol | Period | OOS cut | IS n / net% | OOS n / net% | OOS PF | OOS WR |
|--------|--------|---------|-------------|--------------|--------|--------|
| BTCUSDT | 2017-10-10→2026-09-23 | 2024-01-16 | 31 / 472.7 | 16 / 48.6 | 1.79 | 37.5% |
| ETHUSDT | 2017-10-10→2026-09-23 | 2024-01-16 | 27 / 627.0 | 13 / 42.5 | 1.74 | 38.5% |
| SOLUSDT | 2020-09-29→2026-09-23 | 2024-12-07 | 21 / 1085.5 | 9 / 0.7 | 1.02 | 33.3% |
| BNBUSDT | 2022-12-20→2026-09-23 | 2025-08-07 | 14 / 109.0 | 3 / -11.2 | 0.00 | 0.0% |
| XRPUSDT | 2018-01-10→2026-09-23 | 2024-02-13 | 31 / 121.6 | 11 / 312.3 | 8.74 | 45.5% |

### Cost model

| Scenario | BTC OOS net% | OOS trades |
|----------|--------------|------------|
| zero | 53.07 | 16 |
| realistic | 48.61 | 16 |
| high | 44.16 | 16 |

Edge on BTC OOS remains positive under higher costs (fees 0.2%/side, slip 0.1%).

## Cross-Symbol Results

- **BTC, ETH, XRP**: positive OOS net after costs.
- **SOL**: OOS ~flat (PF ≈ 1.02, 9 trades).
- **BNB**: OOS **n=3**, all losers — sample too small, not a pass.
- Results are **mixed but not single-asset only**; XRP OOS is large vs others → concentration note.

## Trade Forensics

| Symbol | MFE/R mean | MAE/R mean | Realized R mean |
|--------|------------|------------|-----------------|
| BTCUSDT | 4.21 | 0.80 | 1.88 |
| ETHUSDT | 4.43 | 0.68 | 1.60 |
| SOLUSDT | 5.20 | 0.66 | 2.06 |
| BNBUSDT | 3.84 | 0.73 | 1.09 |
| XRPUSDT | 4.02 | 0.90 | 1.07 |

- Classic trend-following payoff: moderate win rate (~35–45% OOS), winners larger than losers when trends persist.
- Exit mix dominated by Donchian exit vs hard 2N stop (see per-run exit counters in research JSON).
- **Limitation:** OOS trade counts are modest (3–16). Not high-frequency evidence.
- **Limitation:** Metrics are sum of per-trade percent returns (fixed notional each trade), not a single compounded equity path with overlapping constraints.

---

## Deep Validation

Generated: 2026-09-23T18:56:54.702783+00:00

**Frozen rules:** Donchian 20 entry / 10 exit / 2N stop / long-only / next-open / fee 0.10% + slip 0.05% per side.

**Sizing assumption:** All-in sequential capital (matches original repo style). Initial capital **10,000 USDT** per symbol equity curve. Portfolios use equal sleeves.

### Equity Curve (OOS only, compounded)

| Symbol | OOS n | Start | End | Net return | CAGR | Max DD | PF | Exp/trade | WR |
|--------|-------|-------|-----|------------|------|--------|-----|-----------|-----|
| BTCUSDT | 16 | 10000 | 13579 | 35.8% | 13.2% | 26.5% | 1.79 | 3.04% | 37.5% |
| ETHUSDT | 13 | 10000 | 13468 | 34.7% | 14.2% | 32.2% | 1.74 | 3.27% | 38.5% |
| SOLUSDT | 9 | 10000 | 9469 | -5.3% | -3.2% | 28.0% | 1.02 | 0.08% | 33.3% |
| BNBUSDT | 3 | 10000 | 8918 | -10.8% | -24.5% | 10.8% | 0.00 | -3.73% | 0.0% |
| XRPUSDT | 11 | 10000 | 37016 | 270.2% | 66.0% | 19.9% | 8.74 | 28.40% | 45.5% |

### OOS Stability (4 sequential OOS sub-windows)

**BTCUSDT**

| Part | n | Net ret | PF | Exp | Max DD | WR |
|------|---|---------|-----|-----|--------|-----|
| 1 | 5 | 13.5% | 1.96 | 4.01% | 19.3% | 40.0% |
| 2 | 3 | 53.9% | 7.77 | 17.48% | 7.7% | 66.7% |
| 3 | 5 | -14.1% | 0.28 | -2.90% | 18.8% | 20.0% |
| 4 | 3 | -9.5% | 0.28 | -3.12% | 9.5% | 33.3% |

**ETHUSDT**

| Part | n | Net ret | PF | Exp | Max DD | WR |
|------|---|---------|-----|-----|--------|-----|
| 1 | 2 | 25.3% | 10.65 | 13.05% | 2.7% | 50.0% |
| 2 | 4 | 16.2% | 2.08 | 4.68% | 16.5% | 50.0% |
| 3 | 5 | 5.1% | 1.40 | 2.01% | 23.0% | 40.0% |
| 4 | 2 | -12.0% | 0.00 | -6.17% | 12.0% | 0.0% |

**SOLUSDT**

| Part | n | Net ret | PF | Exp | Max DD | WR |
|------|---|---------|-----|-----|--------|-----|
| 1 | 2 | 1.6% | 1.29 | 1.76% | 12.2% | 50.0% |
| 2 | 3 | -8.7% | 0.30 | -2.79% | 11.8% | 33.3% |
| 3 | 2 | -12.6% | 0.00 | -6.41% | 12.6% | 0.0% |
| 4 | 2 | 16.7% | 3.75 | 9.20% | 6.7% | 50.0% |

**BNBUSDT**

| Part | n | Net ret | PF | Exp | Max DD | WR |
|------|---|---------|-----|-----|--------|-----|
| 1 | 0 | 0.0% | 0.00 | 0.00% | 0.0% | 0.0% |
| 2 | 1 | -1.9% | 0.00 | -1.85% | 1.9% | 0.0% |
| 3 | 2 | -9.1% | 0.00 | -4.66% | 9.1% | 0.0% |
| 4 | 0 | 0.0% | 0.00 | 0.00% | 0.0% | 0.0% |

**XRPUSDT**

| Part | n | Net ret | PF | Exp | Max DD | WR |
|------|---|---------|-----|-----|--------|-----|
| 1 | 3 | 1.6% | 1.27 | 0.75% | 8.2% | 66.7% |
| 2 | 2 | 276.7% | 30.24 | 155.42% | 10.6% | 50.0% |
| 3 | 3 | 6.6% | 1.73 | 2.91% | 11.7% | 33.3% |
| 4 | 3 | -9.3% | 0.01 | -3.16% | 9.4% | 33.3% |

### Walk-Forward (fixed 20/10/2N — no parameter change)

Four sequential time windows covering full history (each window is an independent measurement segment).

**BTCUSDT**

| Window | Period | n | Net ret | PF | Exp | Max DD | WR |
|--------|--------|---|---------|-----|-----|--------|-----|
| 1 | 2017-10-10→2020-01-06 | 11 | 85.2% | 2.75 | 9.96% | 36.3% | 36.4% |
| 2 | 2020-01-06→2022-04-02 | 9 | 559.4% | 10.95 | 39.28% | 22.9% | 55.6% |
| 3 | 2022-04-02→2024-06-28 | 14 | 28.3% | 1.65 | 2.97% | 35.3% | 35.7% |
| 4 | 2024-06-28→2026-09-23 | 13 | 5.6% | 1.31 | 1.27% | 26.5% | 30.8% |

Positive windows: **4** / Negative: **0**

**ETHUSDT**

| Window | Period | n | Net ret | PF | Exp | Max DD | WR |
|--------|--------|---|---------|-----|-----|--------|-----|
| 1 | 2017-10-10→2020-01-06 | 7 | 170.0% | 5.06 | 23.08% | 17.2% | 42.9% |
| 2 | 2020-01-06→2022-04-02 | 8 | 1801.5% | 116.74 | 56.12% | 3.9% | 87.5% |
| 3 | 2022-04-02→2024-06-28 | 14 | 33.6% | 1.71 | 3.04% | 33.8% | 42.9% |
| 4 | 2024-06-28→2026-09-23 | 11 | 7.5% | 1.30 | 1.49% | 32.2% | 36.4% |

Positive windows: **4** / Negative: **0**

**XRPUSDT**

| Window | Period | n | Net ret | PF | Exp | Max DD | WR |
|--------|--------|---|---------|-----|-----|--------|-----|
| 1 | 2018-01-10→2020-03-15 | 10 | -31.4% | 0.56 | -2.99% | 50.8% | 20.0% |
| 2 | 2020-03-15→2022-05-18 | 12 | 179.7% | 3.00 | 13.02% | 42.5% | 50.0% |
| 3 | 2022-05-18→2024-07-21 | 11 | -0.4% | 1.11 | 0.52% | 21.8% | 45.5% |
| 4 | 2024-07-21→2026-09-23 | 9 | 234.3% | 8.48 | 33.54% | 19.9% | 33.3% |

Positive windows: **2** / Negative: **2**

### Cost Stress (BTC OOS equity)

| Scenario | Fee/side | Slip/side | OOS n | Net ret | Max DD | PF | Exp |
|----------|----------|-----------|-------|---------|--------|-----|-----|
| baseline_0.10_0.05 | — | — | 16 | 35.8% | 26.5% | 1.79 | 3.04% |
| stress1_0.15_0.10 | — | — | 16 | 32.1% | 27.3% | 1.72 | 2.86% |
| stress2_0.20_0.10 | — | — | 16 | 30.0% | 27.9% | 1.69 | 2.76% |
| stress3_0.20_0.20 | — | — | 16 | 27.0% | 28.5% | 1.63 | 2.60% |

Baseline remains positive under stress3 (0.20% fee + 0.20% slip).

### XRP Exclusion

| Portfolio | Trades | Net return | Max DD |
|-----------|--------|------------|--------|
| all5 | 52 | 64.9% | 22.7% |
| no_xrp | 41 | 13.6% | 24.8% |
| btc_eth | 29 | 35.2% | 27.6% |
| btc_eth_sol | 38 | 21.7% | 27.7% |

- **With XRP:** +64.9% portfolio OOS.
- **Without XRP:** still **+13.6%**.
- **BTC+ETH only:** **+35.2%**.
- **XRP concentration = HIGH** for total portfolio magnitude, but **edge is not solely XRP** (BTC+ETH remain positive).

### Cross-Symbol Summary

- Positive OOS equity: BTC, ETH, XRP
- Flat/weak: SOL
- Negative / tiny n: BNB (3 trades — ignore as evidence)

### Regime Analysis (heuristic labels on OOS trades)

Labels: trending vs ranging (|60d return| ≷ 15%) × high vs low vol (ann. ~20d vol ≷ 60%).

**BTCUSDT:** ranging_low_vol n=13 exp=5.4%, trending_low_vol n=3 exp=-7.3%
**ETHUSDT:** trending_low_vol n=3 exp=8.1%, ranging_high_vol n=5 exp=5.7%, ranging_low_vol n=3 exp=-7.0%, trending_high_vol n=2 exp=5.2%
**SOLUSDT:** ranging_high_vol n=3 exp=2.1%, trending_high_vol n=3 exp=1.2%, ranging_low_vol n=2 exp=0.7%, trending_low_vol n=1 exp=-10.6%
**BNBUSDT:** ranging_low_vol n=2 exp=-4.1%, trending_low_vol n=1 exp=-2.9%
**XRPUSDT:** ranging_low_vol n=7 exp=42.5%, ranging_high_vol n=3 exp=4.8%, trending_high_vol n=1 exp=0.1%

Trend-following pattern: better expectancy tends to cluster in trending regimes; ranging periods weaker. **No filters added.**

### Trade Distribution (BTC+ETH OOS combined, n=29)

- Median trade: -4.60%
- Mean trade: 3.14%
- Top 1 trade share of gross wins: 21.7%
- Top 5 trades share of gross wins: 77.5%
- Best 10% trades share of gross wins: 41.0%
- Bottom 5 trades sum: -48.2%

Profitability is skewed (typical of trend systems) but not a single-trade story on BTC+ETH.

### Monte Carlo (5000 permutations, BTC+ETH OOS trades, seed=42)

- n trades: 29
- Note: final compounded return is **order-invariant** for a fixed set of multiplicative returns; MC mainly stresses **drawdown path**. 
- Median max DD: 36.9%
- 95th pct max DD: 51.7%
- Prob ending below initial (same trade set): 0.0%

### Bootstrap (5000 resamples, BTC+ETH OOS)

- P(positive expectancy): 86.3%
- P(positive total return): 78.7%
- P(max DD > observed chronological DD 47.6%): 23.6%

### Drawdown Analysis

- BTC OOS max DD ~26.5%; ETH ~32.2% on all-in sizing (aggressive).
- Portfolio BTC+ETH max DD ~27.6%.
- MC p95 max DD ~52% under adverse trade ordering — **material path risk** with all-in units.

### Statistical Reality Check

| Item | Value |
|------|-------|
| BTC OOS trades | 16 |
| ETH OOS trades | 13 |
| BTC+ETH OOS | 29 |
| Positive symbols (OOS equity) | 3 (BTC, ETH, XRP) |
| BTC walk-forward positive windows | 4/4 |
| Sample size | **Modest — not asymptotic** |

Evidence = **promising but insufficient for “proven edge.”**

### Long-only Bias

Strategy captures upside trends; deep crypto bears still produce stop/channel losses. WF window covering 2022-ish remains net positive on BTC but weaker expectancy. Do **not** add shorts in this validation.

---

## CANDIDATE #3 FINAL STATUS

**CANDIDATE EDGE — NEEDS FORWARD TEST**

### DECISION

**FORWARD TEST**

Not a pure backtest anomaly: survives next-open execution, realistic and stressed costs, XRP exclusion (BTC+ETH still positive), and all four BTC walk-forward segments net positive. Still **not** validated for live size — trade counts are modest and all-in DD paths can exceed 40–50% under adverse ordering.

**Honest answer:** Worth controlled **paper / forward** tracking with frozen rules. **Not** worth optimizing parameters. If forward fails, **DISCARD → Candidate #4** without rule changes.

