'use strict';
/** Shared, versioned feature computation for historical rows and live candidates. */

function finite(v, fallback = 0) {
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
}

function hourUtcFromTs(ts) {
  const value = Number(ts);
  return Number.isFinite(value) && value > 0 ? new Date(value).getUTCHours() : 0;
}

const FEATURE_KEYS = ['bias','corePct','mtfPct','adx','atrPct','rr','rsi4h','dirLong','hourSin','hourCos','slot'];

function signalToFeatures(signal) {
  const hour = hourUtcFromTs(signal.ts ?? signal.closedCandle);
  const radians = 2 * Math.PI * hour / 24;
  return {
    bias: 1,
    corePct: finite(signal.corePct) / 100,
    mtfPct: finite(signal.mtfPct) / 100,
    adx: finite(signal.adx) / 50,
    atrPct: Math.min(Math.max(finite(signal.atrPct), 0), 0.08) / 0.08,
    rr: Math.min(Math.max(finite(signal.rr), 0), 5) / 5,
    rsi4h: finite(signal.rsi4h, 50) / 100,
    dirLong: signal.dir === 'LONG' ? 1 : 0,
    hourSin: Math.sin(radians),
    hourCos: Math.cos(radians),
    slot: finite(signal.slot) / 6
  };
}

function tradeToExample(trade) {
  const net = finite(trade.closePct, NaN);
  if (!Number.isFinite(net)) return null;
  const features = signalToFeatures(trade);
  return { x: FEATURE_KEYS.map(key => features[key]), y: net > 0 ? 1 : 0, net, symbol: trade.symbol, ts: trade.ts ?? trade.closedCandle, mode: trade.strategyMode || null };
}

function datasetFromTracked(tracked, { mode = null } = {}) {
  const out = [];
  for (const trade of tracked || []) {
    if (!(trade.closed || trade.closeResult)) continue;
    if (mode && trade.strategyMode !== mode) continue;
    const example = tradeToExample(trade);
    if (example) out.push(example);
  }
  return out;
}

module.exports = { FEATURE_KEYS, signalToFeatures, tradeToExample, datasetFromTracked, hourUtcFromTs };
