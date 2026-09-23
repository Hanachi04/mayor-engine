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

## Final Status

**CANDIDATE EDGE — NEEDS VALIDATION**

Reasons:
1. No material look-ahead in channel construction.
2. Independent next-open OOS positive after realistic costs on BTC and ETH with double-digit trade counts.
3. Cost sensitivity does not erase BTC OOS.
4. Not optimized on OOS.
5. Still requires deeper validation: compounded equity, short side optional test, more symbols, walk-forward windows, and live/paper — **not** production-ready.

## DECISION

**CONTINUE** (as research candidate only — deeper validation, do not deploy).

Not DISCARD: unlike Candidates #1–#2, independent post-cost OOS is not broadly negative.

Next validation steps (only if pursued):
1. Compounded fixed-fraction equity curve + max DD on BTC/ETH.
2. Additional holdout years / walk-forward folds.
3. Optional short side with symmetric rules.
4. Paper trade checklist — **no parameter changes**.

## Regression isolation

- Deliverable only: this document under `docs/`.
- Core / Scalper / Aegis / adaptation untouched.
