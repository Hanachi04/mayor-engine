'use strict';

const fs = require('fs');
const path = require('path');
const config = require('./config');

/**
 * Normalize bar to internal shape.
 * ot = open time ms UTC
 */
function normalizeBar(raw) {
  return {
    ot: Number(raw.ot ?? raw[0]),
    o: Number(raw.o ?? raw[1]),
    h: Number(raw.h ?? raw[2]),
    l: Number(raw.l ?? raw[3]),
    c: Number(raw.c ?? raw[4]),
    v: Number(raw.v ?? raw[5] ?? 0),
    data_source: raw.data_source || 'unknown',
    received_at: raw.received_at || new Date().toISOString(),
  };
}

function validateBar(bar) {
  if (!bar || !Number.isFinite(bar.ot)) return { ok: false, reason: 'bad_timestamp' };
  if (![bar.o, bar.h, bar.l, bar.c].every(Number.isFinite)) return { ok: false, reason: 'bad_ohlc' };
  if (bar.h < bar.l) return { ok: false, reason: 'high_lt_low' };
  if (bar.h < bar.o || bar.h < bar.c || bar.l > bar.o || bar.l > bar.c) {
    return { ok: false, reason: 'ohlc_inconsistent' };
  }
  return { ok: true };
}

function sortUniqueBars(bars) {
  const byTs = new Map();
  for (const b of bars) {
    const v = validateBar(b);
    if (!v.ok) continue;
    byTs.set(b.ot, b);
  }
  return [...byTs.values()].sort((a, b) => a.ot - b.ot);
}

function detectGaps(bars, expectedMs = 86400000) {
  const gaps = [];
  for (let i = 1; i < bars.length; i++) {
    const dt = bars[i].ot - bars[i - 1].ot;
    if (dt > expectedMs * 1.5) {
      gaps.push({ from: bars[i - 1].ot, to: bars[i].ot, dt });
    }
  }
  return gaps;
}

function candleFile(symbol) {
  return path.join(config.PATHS.candles, `${symbol}.jsonl`);
}

function persistBars(symbol, bars) {
  const file = candleFile(symbol);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  // rewrite sorted unique for simplicity in v1
  const sorted = sortUniqueBars(bars);
  fs.writeFileSync(file, sorted.map((b) => JSON.stringify(b)).join('\n') + (sorted.length ? '\n' : ''), 'utf8');
  return sorted;
}

function loadBars(symbol) {
  const file = candleFile(symbol);
  if (!fs.existsSync(file)) return [];
  const text = fs.readFileSync(file, 'utf8').trim();
  if (!text) return [];
  return sortUniqueBars(text.split('\n').filter(Boolean).map((l) => JSON.parse(l)));
}

/**
 * Fetch daily candles from OKX public API (no auth).
 * Returns closed candles only up to last fully closed day (caller must filter "today" if incomplete).
 */
async function fetchOkxDaily(symbol, limit = 100) {
  const inst = config.OKX_INST[symbol];
  if (!inst) throw new Error(`Unknown symbol mapping: ${symbol}`);
  const url = `https://www.okx.com/api/v5/market/history-candles?instId=${inst}&bar=${config.BAR}&limit=${limit}`;
  const res = await fetch(url, { headers: { 'User-Agent': 'mayor-engine4/1.0' } });
  if (!res.ok) throw new Error(`OKX HTTP ${res.status}`);
  const body = await res.json();
  if (body.code !== '0') throw new Error(`OKX code ${body.code}: ${body.msg}`);
  const rows = body.data || [];
  // OKX returns newest first: [ts,o,h,l,c,vol,...]
  const bars = rows.map((r) =>
    normalizeBar({
      ot: Number(r[0]),
      o: Number(r[1]),
      h: Number(r[2]),
      l: Number(r[3]),
      c: Number(r[4]),
      v: Number(r[5]),
      data_source: 'okx_public',
      received_at: new Date().toISOString(),
    })
  );
  return sortUniqueBars(bars);
}

/**
 * Merge remote + local, persist.
 * Excludes "today" incomplete candle if now < next day UTC open.
 */
async function syncSymbol(symbol) {
  const remote = await fetchOkxDaily(symbol, 100);
  const local = loadBars(symbol);
  const merged = sortUniqueBars([...local, ...remote]);
  // Drop incomplete current UTC day if still open
  const now = Date.now();
  const dayMs = 86400000;
  const closed = merged.filter((b) => b.ot + dayMs <= now);
  return persistBars(symbol, closed);
}

function loadBarsFromArray(rawBars) {
  return sortUniqueBars(rawBars.map(normalizeBar));
}

module.exports = {
  normalizeBar,
  validateBar,
  sortUniqueBars,
  detectGaps,
  persistBars,
  loadBars,
  fetchOkxDaily,
  syncSymbol,
  loadBarsFromArray,
};
