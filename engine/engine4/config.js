'use strict';

/**
 * Engine #4 — Forward-Test configuration (FROZEN assumptions).
 * Do not change costs/sizing during an active forward-test run.
 */

const path = require('path');

const ROOT = path.join(__dirname, '..', '..');
const FT_ROOT = path.join(ROOT, 'forward-test');

module.exports = {
  STRATEGY_VERSION: 'turtle-candidate-03',
  STRATEGY_COMMIT: '114bce4', // deep-validation commit; document-only freeze marker
  ENGINE_ID: 'engine-4',

  SYMBOLS: ['BTCUSDT', 'ETHUSDT', 'SOLUSDT', 'BNBUSDT', 'XRPUSDT'],

  // Frozen Turtle rules
  ENTRY_PERIOD: 20,
  EXIT_PERIOD: 10,
  ATR_PERIOD: 20,
  STOP_MULT: 2.0,
  DIRECTION: 'long_only',
  TIMEFRAME: '1d',

  // Execution assumptions (documented; fixed for this forward-test campaign)
  FEE_PER_SIDE: 0.001, // 0.10%
  SLIPPAGE_PER_SIDE: 0.0005, // 0.05%
  SAME_CANDLE_CONFLICT: 'conservative', // prefer stop if both hit

  // Virtual capital / sizing (forward-test assumption — not original Turtle unit sizing)
  INITIAL_CAPITAL: 10000,
  // Fixed notional per symbol sleeve (equal-weight style, all-in per sleeve when flat)
  SIZING_MODE: 'equal_sleeve_all_in',
  SLEEVE_FRACTION: 1 / 5, // 5 symbols

  DATA_SOURCE: 'okx_public',
  OKX_INST: {
    BTCUSDT: 'BTC-USDT',
    ETHUSDT: 'ETH-USDT',
    SOLUSDT: 'SOL-USDT',
    BNBUSDT: 'BNB-USDT',
    XRPUSDT: 'XRP-USDT',
  },
  BAR: '1D',

  PATHS: {
    root: FT_ROOT,
    signals: path.join(FT_ROOT, 'signals'),
    trades: path.join(FT_ROOT, 'trades'),
    equity: path.join(FT_ROOT, 'equity'),
    state: path.join(FT_ROOT, 'state'),
    audit: path.join(FT_ROOT, 'audit'),
    candles: path.join(FT_ROOT, 'candles'),
  },

  TELEGRAM: {
    // Read from env only — never hardcode secrets
    tokenEnv: 'TELEGRAM_BOT_TOKEN',
    chatIdEnv: 'TELEGRAM_CHAT_ID',
    enabled: Boolean(process.env.TELEGRAM_BOT_TOKEN && process.env.TELEGRAM_CHAT_ID),
  },

  MODE: process.env.ENGINE4_MODE || 'REPLAY', // REPLAY | FORWARD_PAPER
};
