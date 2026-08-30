'use strict';

/**
 * Futures Scalper v1 — configuration (isolated from MaYor Cloud Pro MTF)
 * Binance USDT-M Perpetual Futures only. Research/notification only — no real orders.
 */

const DEFAULT_SYMBOLS = [
  'BTCUSDT', 'ETHUSDT', 'SOLUSDT', 'BNBUSDT', 'XRPUSDT'
].join(',');

const CONFIG = {
  symbols: (process.env.SCALPER_SYMBOLS || DEFAULT_SYMBOLS)
    .split(',').map(s => s.trim().toUpperCase()).filter(Boolean),
  futuresEndpoints: [
    'https://fapi.binance.com',
    'https://fstream.binance.com'
  ],
  baseInterval: '1m',
  confirmIntervals: ['3m', '5m'],
  trendInterval: '15m',
  limits: { '1m': 120, '3m': 80, '5m': 80, '15m': 100 },
  minKlines: { '1m': 40, '3m': 30, '5m': 30, '15m': 60 },
  maxSignalsPerDay: Number(process.env.SCALPER_MAX_SIGNALS_PER_DAY || 30),
  cooldownMs: Number(process.env.SCALPER_COOLDOWN_MINUTES || 3) * 60 * 1000,
  maxOpenTrades: Number(process.env.SCALPER_MAX_OPEN || 4),
  maxTradeAgeMs: Number(process.env.SCALPER_MAX_TRADE_AGE_MINUTES || 25) * 60 * 1000,
  volumeSpikeMult: Number(process.env.SCALPER_VOLUME_SPIKE || 1.5),
  emaFast: 9,
  emaSlow: 21,
  rsiPeriod: 7,
  atrPeriod: 14,
  atrSlMult: Number(process.env.SCALPER_ATR_SL_MULT || 1.1),
  minRr: Number(process.env.SCALPER_MIN_RR || 1.5),
  rsiOversold: 30,
  rsiOverbought: 70,
  minQuoteVolume24h: Number(process.env.SCALPER_MIN_QUOTE_VOLUME_24H || 20_000_000),
  capital: Number(process.env.SCALPER_ACCOUNT_CAPITAL || 1000),
  riskPerTradePct: Number(process.env.SCALPER_RISK_PER_TRADE_PCT || 0.35),
  leverage: Number(process.env.SCALPER_LEVERAGE || 5),
  maxNotionalMultiple: Number(process.env.SCALPER_MAX_NOTIONAL_MULTIPLE || 1),
  takerFeeRate: Number(process.env.SCALPER_TAKER_FEE_RATE || 0.0004),
  slippageRate: Number(process.env.SCALPER_SLIPPAGE_RATE || 0.0003),
  requestTimeoutMs: Number(process.env.SCALPER_REQUEST_TIMEOUT_MS || 10000),
  retries: Number(process.env.SCALPER_REQUEST_RETRIES || 2),
  minRequestGapMs: 80,
  verificationGateMode: (process.env.SCALPER_VERIFICATION_GATE_MODE || 'warn').toLowerCase(),
  heartbeatMaxAgeMs: Number(process.env.SCALPER_HEARTBEAT_MAX_AGE_MINUTES || 20) * 60 * 1000,
  telegramToken: process.env.SCALPER_TELEGRAM_TOKEN || process.env.TELEGRAM_TOKEN || '',
  telegramChat: process.env.SCALPER_TELEGRAM_CHAT || process.env.TELEGRAM_CHAT || '',
  dryRun: /^(1|true|yes)$/i.test(process.env.SCALPER_DRY_RUN || process.env.DRY_RUN || '')
};

const ENGINE_VERSION = 'futures-scalper-v1.0';
const GATE_VERSION = 'scalper-statistical-gate-1';

module.exports = { CONFIG, ENGINE_VERSION, GATE_VERSION, DEFAULT_SYMBOLS };
