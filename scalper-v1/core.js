'use strict';

const CONFIG = Object.freeze({
  symbols: ['BTCUSDT', 'ETHUSDT', 'SOLUSDT', 'BNBUSDT', 'XRPUSDT'],
  baseInterval: '1m',
  confirmIntervals: ['3m', '5m'],
  trendInterval: '15m',
  cooldownMs: 3 * 60 * 1000,
  maxSignalsPerDay: 30,
  maxTradeAgeMs: 20 * 60 * 1000,
  maxConcentrationPct: 50,
  atrPeriod: 14,
  emaFast: 9,
  emaSlow: 21,
  trendEma: 50,
  atrSlMult: 1.1,
  minRr: 1.5,
  minQuoteVolume24h: 20_000_000,
  riskPerTradePct: 0.35,
  capital: 1000,
  feeRate: 0.0005,
  slippageRate: 0.0002
});

function finite(v, fallback = NaN) { const n = Number(v); return Number.isFinite(n) ? n : fallback; }
function normalizeKlines(raw) {
  return (Array.isArray(raw) ? raw : []).map((k, i) => Array.isArray(k)
    ? { openTime: finite(k[0], i), open: finite(k[1]), high: finite(k[2]), low: finite(k[3]), close: finite(k[4]), volume: finite(k[5]), closeTime: finite(k[6], i) }
    : { openTime: finite(k.openTime, i), open: finite(k.open), high: finite(k.high), low: finite(k.low), close: finite(k.close), volume: finite(k.volume), closeTime: finite(k.closeTime, i) })
    .sort((a, b) => a.openTime - b.openTime);
}
function prepareKlines(raw, asOf) {
  if (!Number.isFinite(asOf)) throw new TypeError('asOf is required');
  const out = [], seen = new Set();
  for (const k of normalizeKlines(raw)) {
    if (!Object.values(k).every(Number.isFinite) || k.closeTime >= asOf || seen.has(k.openTime)) continue;
    if (k.open <= 0 || k.high < Math.max(k.open, k.close) || k.low > Math.min(k.open, k.close) || k.low > k.high || k.volume < 0) continue;
    seen.add(k.openTime); out.push(k);
  }
  return out;
}
function ema(values, period) {
  const out = new Array(values.length).fill(null); if (values.length < period) return out;
  let value = values.slice(0, period).reduce((a, b) => a + b, 0) / period; out[period - 1] = value;
  const alpha = 2 / (period + 1);
  for (let i = period; i < values.length; i++) { value = values[i] * alpha + value * (1 - alpha); out[i] = value; }
  return out;
}
function atr(candles, period) {
  if (candles.length < period + 1) return NaN;
  const tr = candles.map((c, i) => i ? Math.max(c.high - c.low, Math.abs(c.high - candles[i - 1].close), Math.abs(c.low - candles[i - 1].close)) : c.high - c.low);
  return tr.slice(-period).reduce((a, b) => a + b, 0) / period;
}
function rsi(values, period = 14) {
  if (values.length <= period) return NaN;
  let gains = 0, losses = 0;
  for (let i = 1; i <= period; i++) { const d = values[i] - values[i - 1]; if (d >= 0) gains += d; else losses -= d; }
  let avgGain = gains / period, avgLoss = losses / period;
  for (let i = period + 1; i < values.length; i++) { const d = values[i] - values[i - 1]; avgGain = (avgGain * (period - 1) + Math.max(0, d)) / period; avgLoss = (avgLoss * (period - 1) + Math.max(0, -d)) / period; }
  return avgLoss === 0 ? 100 : 100 - 100 / (1 + avgGain / avgLoss);
}
function direction(candles, fast = CONFIG.emaFast, slow = CONFIG.emaSlow) {
  const eFast = ema(candles.map(c => c.close), fast).at(-1), eSlow = ema(candles.map(c => c.close), slow).at(-1);
  return Number.isFinite(eFast) && Number.isFinite(eSlow) ? (eFast > eSlow ? 'LONG' : eFast < eSlow ? 'SHORT' : null) : null;
}
function analyze1m(candles, symbol) {
  const closes = candles.map(c => c.close), fast = ema(closes, CONFIG.emaFast), slow = ema(closes, CONFIG.emaSlow);
  const price = closes.at(-1), eFast = fast.at(-1), eSlow = slow.at(-1), previousFast = fast.at(-2), previousSlow = slow.at(-2), a = atr(candles, CONFIG.atrPeriod);
  if (![price, eFast, eSlow, previousFast, previousSlow, a].every(Number.isFinite) || a <= 0) return null;
  const dir = eFast >= eSlow ? 'LONG' : 'SHORT';
  const cross = (dir === 'LONG' && previousFast <= previousSlow) || (dir === 'SHORT' && previousFast >= previousSlow);
  const avgVolume = candles.slice(-21, -1).reduce((s, c) => s + c.volume, 0) / 20;
  const volumeSpike = candles.at(-1).volume >= avgVolume * 1.3;
  if (!cross && !volumeSpike) return null;
  const distance = a * CONFIG.atrSlMult, sl = dir === 'LONG' ? price - distance : price + distance;
  const tp1 = dir === 'LONG' ? price + distance * CONFIG.minRr : price - distance * CONFIG.minRr;
  const rr = Math.abs(tp1 - price) / Math.abs(price - sl);
  return { symbol, dir, price, atr: a, atrPct: a / price, rsi: rsi(closes), volumeSpike, recentCross: cross, sl, tp1, rr, signalTime: candles.at(-1).closeTime };
}
function calculatePositionSize(signal) {
  const riskCapital = CONFIG.capital * CONFIG.riskPerTradePct / 100, riskPerUnit = Math.abs(signal.price - signal.sl);
  const quantity = riskPerUnit > 0 ? riskCapital / riskPerUnit : 0;
  return { quantity, riskCapital, notional: quantity * signal.price };
}
function sliceUntil(candles, asOf) { return prepareKlines(candles, asOf); }
module.exports = { CONFIG, finite, normalizeKlines, prepareKlines, ema, atr, rsi, direction, analyze1m, calculatePositionSize, sliceUntil };
