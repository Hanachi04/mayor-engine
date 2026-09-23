# Scalper Historical Validation

Generated: 2026-09-23T17:39:09.255495+00:00

## 1. Scope

- Engine: `futures-scalper-v1.1` (current `engine/scalper`)
- Symbols: BTCUSDT, ETHUSDT, SOLUSDT, BNBUSDT, XRPUSDT
- Period: 2026-07-30 → 2026-08-30 UTC (~31 days of 1m)
- **No strategy optimization.** Parameters left at config defaults.
- Core / Mayor strategy was not modified.
- Not tested: live API fills, funding, order-book imbalance path (live-only), multi-month history beyond fixtures.

## 2. Data Recovery

Recovered from git commit `01928f74` (`feat: add isolated futures scalper v1`):

| File | Path in commit | Rows | Period (UTC) | SHA256 (full) |
|------|----------------|------|--------------|---------------|
| BTCUSDT_1m.json | scalper-v1/fixtures/BTCUSDT_1m.json | 44640 | 2026-07-30 14:54 → 2026-08-30 14:53 | `0c719053a63724826cb9a1af37009630a539f26a565c125660d6d3accf945fd0` |
| ETHUSDT_1m.json | scalper-v1/fixtures/ETHUSDT_1m.json | 44640 | 2026-07-30 14:54 → 2026-08-30 14:53 | `703615bb5e4387a1ee010ed028a2219ce29ca07b881d27b448850265874a6a23` |
| SOLUSDT_1m.json | scalper-v1/fixtures/SOLUSDT_1m.json | 44640 | 2026-07-30 14:54 → 2026-08-30 14:53 | `2930a470d3ae19d6f442acda19677fd0d85686e84f24d95be48f639d243d9017` |
| BNBUSDT_1m.json | scalper-v1/fixtures/BNBUSDT_1m.json | 44640 | 2026-07-30 14:54 → 2026-08-30 14:53 | `3a57092ab2c72223b4e74fd8595277bbee45311132ce0fcf5930da9fca1394ec` |
| XRPUSDT_1m.json | scalper-v1/fixtures/XRPUSDT_1m.json | 44640 | 2026-07-30 14:54 → 2026-08-30 14:53 | `bb9a31cd1e90c8e5e7c9b77503434758acda19f34909d1b69f88545ec48e1eb9` |

Higher timeframes (3m/5m/15m) were **resampled offline from 1m** for MTF confirmation (not separate stored series). Resample is research-only under `/tmp` staging; not committed.

Original v1 report at same commit showed strongly negative net on this period under older rules (tens of thousands of trades).

## 3. Data Quality

| Check | Result |
|-------|--------|
| Timeframe | True 1-minute (`delta=60000ms`) |
| Duplicates | 0 |
| Non-1m gaps | 0 |
| OHLC consistency (sampled) | 0 violations in first 5k bars/symbol |
| Timestamp monotonic | Strictly increasing closeTimes |
| Timezone | UTC ms epoch |
| Schema | Binance kline arrays `[ot,o,h,l,c,vol,ct]` |

**Sufficient contiguous 1m data for a 31-day baseline.** Not a multi-year sample.

## 4. Methodology Audit

### Signal
- **1m close:** EMA9/21 direction; prefer **recent cross** (`requireRecentCross=true`).
- Volume spike ≥ 1.5× 20-bar avg volume (if no cross).
- RSI(7) soft/hard extremes; ATR(14)/price ≥ `minAtrPct` (0.15%).
- Confirm: 3m and 5m EMA9/21 same direction; soft 15m trend (price vs EMA50) not opposing.
- Decision time: closed 1m bar `i` (`closeTime = t`); only bars with `closeTime ≤ t` on higher TFs.

### Entry
- **Next bar open** (`k1[i+1].open`).
- Slippage: `entry * (1 ± slippageRate)` with `slippageRate=0.0003`.

### Exit
- SL = ATR×1.1 from signal price; TP1 = 1.5R (`minRr=1.5`).
- Max age 25 minutes; TIMEOUT at last bar close in window.
- Same-bar SL/TP: **SL first** (conservative).

### Costs
- Taker fee 0.0004/side (0.08% RT); slippage 0.0003/side in fills.
- No funding in model.

### Position model
- Backtest: sequential signals with **cooldown 3m** between emits (global lastEmit on symbol stream).
- Live config allows up to 4 open; backtest does not model concurrent portfolio heat beyond cooldown.

## 5. Leakage Audit

| Risk | Finding |
|------|---------|
| Future 1m bars in signal | **No** — uses `slice(0, i+1)` / series index `i` |
| Higher TF future bars | **No** — only `closeTime ≤ signal closeTime` |
| Entry uses future high/low | **No** — next open only |
| Same-bar SL/TP ordering | Conservative SL-first |
| Labels as features | **No** |

**LEAKAGE: NOT FOUND** in the measured path.

Technical note: research harness used O(n) indicator series equivalent to `Indicators.rsiSeries` / `atrSeries` / `ema` (same library). No strategy parameter changes.

## 6. Baseline Results

Period: 2026-07-30T14:54:00.000Z → 2026-08-30T14:53:59.999Z
Time split (70%): 2026-08-21T07:41:59.999Z

| Split | Trades | Win% | Gross% | Fees% | Net% | PF | MaxDD% | Exp/trade |
|-------|--------|------|--------|-------|------|-----|--------|-----------|
| all | 209 | 39.7 | -9.229 | 16.720 | -25.949 | 0.456 | 26.226 | -0.1242 |
| is_time | 52 | 44.2 | -1.485 | 4.160 | -5.645 | 0.462 | 5.872 | -0.1086 |
| oos_time | 157 | 38.2 | -7.744 | 12.560 | -20.304 | 0.454 | 20.581 | -0.1293 |

Trade-count 70/30 (engine helper style) for reference:
- IS trades 146 net -13.854
- OOS trades 63 net -12.095

### Exit mix (all)
`{'TIMEOUT': 7, 'TP1': 81, 'SL': 121}` · avg hold 5.9m · med 4.0m · max loss streak 10

### LONG / SHORT (time OOS)

| Dir | Trades | Win% | Net% | PF |
|-----|--------|------|------|-----|
| LONG | 104 | 39.4 | -12.991 | 0.471 |
| SHORT | 53 | 35.8 | -7.314 | 0.422 |

## 7. Trade Forensics (MAE/MFE)

| Group | n | MFE/R mean | MFE/R med | MAE/R mean | Realized R mean |
|-------|---|------------|-----------|------------|-----------------|
| winners | 83 | 1.998 | 1.777 | 0.432 | 1.505 |
| losers | 126 | 0.516 | 0.406 | 1.285 | -0.957 |

Winners typically realize ~1.5R (TP1 target); losers ~−1R SL. Losers show limited favorable excursion (median MFE/R ~0.41).

## 8. Cost Economics

| | Gross (with slip fills) | Fees | Net |
|--|-------------------------|------|-----|
| All | -9.229 | 16.720 | -25.949 |
| OOS time | -7.744 | 12.560 | -20.304 |
| OOS zero fee+slip (raw prices) | 1.675 | 0 | 1.675 |

OOS moves from **slightly positive raw** (~+1.7%) to **negative with costs** (−20.3%). Costs **materially affect** economics; zero-cost is diagnostic only.

## 9. Independent Validation (per symbol, time 70/30)

| Symbol | IS n / net | OOS n / net | OOS PF |
|--------|------------|-------------|--------|
| BTCUSDT | 4 / -0.775 | 7 / -0.210 | 0.788 |
| ETHUSDT | 14 / -0.920 | 16 / -1.870 | 0.370 |
| SOLUSDT | 10 / -1.588 | 55 / -6.336 | 0.461 |
| BNBUSDT | 1 / 0.041 | 3 / -0.500 | 0.202 |
| XRPUSDT | 23 / -2.402 | 76 / -11.388 | 0.454 |

No symbol shows a robust positive OOS net under baseline costs.

## 10. Reproducibility

Run1 trades=209 net=-25.949000 PF=0.455954
Run2 trades=209 net=-25.949000 PF=0.455954
Match: **True**

- Dataset hashes: table above
- Code commit at report time: see git log on push
- Engine: `futures-scalper-v1.1` fee=0.0004 slip=0.0003
- Command: research harness `/tmp/scalper_validate.js` (not production path)

## 11. Limitations

- Only ~31 days of 1m history in recovered fixtures.
- 3m/5m/15m resampled from 1m (not exchange native series).
- No funding; fixed slippage; no partial fills.
- Small trade counts on BTC/BNB reduce confidence.
- Concurrent multi-position risk not fully modeled in backtest.

## 12. Conclusion

**SCALPER EDGE NOT VALIDATED**

Time-based OOS is negative across the combined set and per-symbol OOS nets are negative or weak. Gross-with-slip is already negative OOS; fees increase the loss. No strategy changes were made.
