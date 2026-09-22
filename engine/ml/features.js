'use strict';
/**
 * Feature extraction for shadow ML — from closed tracked trades or live signal candidate.
 */

function finite(v, fb = 0) {
  const n = Number(v);
  return Number.isFinite(n) ? n : fb;
}

function hourUtcFromTs(ts) {
  if (!ts) return -1;
  return new Date(Number(ts)).getUTCHours();
}

/** Vector keys in fixed order for model */
const FEATURE_KEYS = [
  'bias',
  'corePct',
  'mtfPct',
  'adx',
  'atrPct',
  'rr',
  'rsi4h',
  'dirLong',
  'hourSin',
  'hourCos',
  'slot'
];

function signalToFeatures(s) {
  const hour = hourUtcFromTs(s.ts || s.closedCandle || Date.now());
  const rad = (2 * Math.PI * Math.max(0, hour)) / 24;
  return {
    bias: 1,
    corePct: finite(s.corePct) / 100,
    mtfPct: finite(s.mtfPct) / 100,
    adx: finite(s.adx) / 50,
    atrPct: Math.min(finite(s.atrPct), 0.08) / 0.08,
    rr: Math.min(finite(s.rr), 5) / 5,
    rsi4h: finite(s.rsi4h, 50) / 100,
    dirLong: s.dir === 'LONG' ? 1 : 0,
    hourSin: Math.sin(rad),
    hourCos: Math.cos(rad),
    slot: finite(s.slot) / 6
  };
}

function tradeToExample(t) {
  const net = finite(t.closePct, NaN);
  if (!Number.isFinite(net)) return null;
  const feats = signalToFeatures(t);
  return {
    x: FEATURE_KEYS.map(k => feats[k]),
    y: net > 0 ? 1 : 0, // 1 = win
    net,
    symbol: t.symbol,
    ts: t.ts,
    mode: t.strategyMode || null
  };
}

function datasetFromTracked(tracked, { mode = null } = {}) {
  const out = [];
  for (const t of tracked || []) {
    if (!(t.closed || t.closeResult)) continue;
    if (mode && t.strategyMode !== mode) continue;
    const ex = tradeToExample(t);
    if (ex) out.push(ex);
  }
  return out;
}

module.exports = { FEATURE_KEYS, signalToFeatures, tradeToExample, datasetFromTracked, hourUtcFromTs };
