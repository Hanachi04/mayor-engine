# Historical data for reproducible backtests

## MaYor Cloud Pro (`engine/backtest.js`)

Directory: `data/historical/`

Files per symbol:
- `BTCUSDT_5m.json`
- `BTCUSDT_15m.json`
- `BTCUSDT_1h.json`
- `BTCUSDT_4h.json`

Schema (preferred):
```json
[
  {
    "openTime": 1700000000000,
    "open": 1.0,
    "high": 1.1,
    "low": 0.9,
    "close": 1.05,
    "volume": 123.4,
    "closeTime": 1700000299999
  }
]
```

Binance REST kline arrays are also accepted via `normalizeKlines`.

Run:
```bash
STRATEGY_MODE=core node engine/backtest.js
# optional live fetch when not geo-blocked:
BACKTEST_FETCH=1 BACKTEST_SYMBOLS=BTCUSDT STRATEGY_MODE=core node engine/backtest.js
```

Without files and without successful fetch: **Verification remains BLOCKED**.

## Scalper (`engine/scalper/backtest.js`)

Directory: `data/scalper/historical/`

- `BTCUSDT_1m.json` (required for that symbol)
- optional: `_3m`, `_5m`, `_15m` (otherwise derived/empty handling per code)

Same OHLCV schema as above.

```bash
node engine/scalper/backtest.js
```
