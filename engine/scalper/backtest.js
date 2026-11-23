'use strict';

const fs = require('fs');
const path = require('path');
const {
  CONFIG, ENGINE_VERSION, GATE_VERSION,
  analyze1m, emaDirection, softTrend15m, levelsFromSignal,
  entryFillPrice, exitFillPrice, prepareKlines, Indicators
} = require('./scan');
const { bootstrapEdge, drawdownRisk } = require('../edge_stats');
const { atomicWriteJson } = require('../atomic_json');
const { stateDir } = require('../state_dir');

const DATA_DIR = path.join(__dirname, '..', '..', 'data', 'scalper');
const REPORT_FILE = path.join(DATA_DIR, 'backtest_report.json');
const VERIFICATION_FILE = path.join(stateDir(), 'scalper', 'verification.json');

function finite(v, fb = NaN) {
  const n = Number(v);
  return Number.isFinite(n) ? n : fb;
}
function round(v, d = 4) { return Number(Number(v).toFixed(d)); }

/** Validate local OHLCV series used by scalper backtest */
function validateOhlcvSeries(rows, label = 'series') {
  const errors = [];
  if (!Array.isArray(rows) || !rows.length) return { ok: false, errors: [`${label}: empty`] };
  let prev = -Infinity;
  for (let i = 0; i < rows.length; i++) {
    const k = rows[i];
    const o = finite(k.open), h = finite(k.high), l = finite(k.low), c = finite(k.close);
    const ot = finite(k.openTime), ct = finite(k.closeTime);
    if (![o, h, l, c, ot, ct].every(Number.isFinite)) errors.push(`${label}[${i}]: non-finite ohlcv/time`);
    if (h < Math.max(o, c) || l > Math.min(o, c)) errors.push(`${label}[${i}]: OHLC inconsistency`);
    if (ct <= prev) errors.push(`${label}[${i}]: timestamps not strictly increasing`);
    prev = ct;
  }
  return { ok: errors.length === 0, errors: errors.slice(0, 20), bars: rows.length };
}


function simulateSymbol(symbol, frames) {
  const k1 = frames['1m'] || [];
  if (k1.length < 80) return { symbol, trades: [], reason: 'short-history' };

  const trades = [];
  const cooldownMs = CONFIG.cooldownMs;
  let lastEmitTs = 0;
  const maxAge = CONFIG.maxTradeAgeMs;
  const fee = CONFIG.takerFeeRate;

  for (let i = 50; i < k1.length - 2; i++) {
    const slice1 = k1.slice(0, i + 1);
    const t = k1[i].closeTime;
    const slice3 = (frames['3m'] || []).filter(k => k.closeTime <= t);
    const slice5 = (frames['5m'] || []).filter(k => k.closeTime <= t);
    const slice15 = (frames['15m'] || []).filter(k => k.closeTime <= t);

    if (slice3.length < 25 || slice5.length < 25) continue;

    const base = analyze1m(slice1, { symbol, skipSanitize: true, now: t + 1 });
    if (!base.signal) continue;
    const dir = base.signal.dir;

    const d3 = emaDirection(slice3);
    const d5 = emaDirection(slice5);
    if (d3 !== dir || d5 !== dir) continue;

    if (slice15.length >= 55) {
      const trend = softTrend15m(slice15);
      if (trend && trend !== dir) continue;
    }

    const leveled = levelsFromSignal(base.signal);
    if (!leveled) continue;

    const openTime = k1[i].openTime;
    if (openTime - lastEmitTs < cooldownMs) continue;

    const entryBar = k1[i + 1];
    if (!entryBar) continue;
    const entryRaw = entryBar.open;
    const entryFill = entryFillPrice(entryRaw, dir);

    let exitRaw = null;
    let result = 'TIMEOUT';
    let exitIdx = i + 1;
    const maxBars = Math.ceil(maxAge / 60000) + 2;

    for (let j = i + 1; j < Math.min(k1.length, i + 1 + maxBars); j++) {
      const bar = k1[j];
      const sign = dir === 'LONG' ? 1 : -1;
      const slHit = sign === 1 ? bar.low <= leveled.sl : bar.high >= leveled.sl;
      const tpHit = sign === 1 ? bar.high >= leveled.tp1 : bar.low <= leveled.tp1;
      if (slHit) { exitRaw = leveled.sl; result = 'SL'; exitIdx = j; break; }
      if (tpHit) { exitRaw = leveled.tp1; result = 'TP1'; exitIdx = j; break; }
      exitRaw = bar.close;
      exitIdx = j;
    }
    if (exitRaw == null) continue;

    const exitFill = exitFillPrice(exitRaw, dir);
    const sign = dir === 'LONG' ? 1 : -1;
    const grossPct = sign * (exitFill - entryFill) / entryFill * 100;
    const feesPct = fee * 2 * 100;
    const netPct = grossPct - feesPct;

    trades.push({
      symbol, dir,
      entryTime: entryBar.openTime,
      exitTime: k1[exitIdx].closeTime,
      entryRaw, exitRaw, entryFill, exitFill,
      sl: leveled.sl, tp1: leveled.tp1, rr: leveled.rr,
      result,
      grossPct: round(grossPct, 4),
      feesPct: round(feesPct, 4),
      netPct: round(netPct, 4)
    });
    lastEmitTs = openTime;
  }

  return { symbol, trades };
}

function summarize(trades) {
  if (!trades.length) {
    return { trades: 0, wins: 0, losses: 0, winRatePct: 0, netPct: 0, avgNetPct: 0, profitFactor: 0, maxDrawdownPct: 0 };
  }
  const wins = trades.filter(t => t.netPct > 0);
  const losses = trades.filter(t => t.netPct <= 0);
  const grossWin = wins.reduce((s, t) => s + t.netPct, 0);
  const grossLoss = Math.abs(losses.reduce((s, t) => s + t.netPct, 0));
  const netPct = trades.reduce((s, t) => s + t.netPct, 0);
  let peak = 0, dd = 0, equity = 0;
  for (const t of trades) {
    equity += t.netPct;
    peak = Math.max(peak, equity);
    dd = Math.max(dd, peak - equity);
  }
  return {
    trades: trades.length,
    wins: wins.length,
    losses: losses.length,
    winRatePct: round(wins.length / trades.length * 100, 2),
    netPct: round(netPct, 4),
    avgNetPct: round(netPct / trades.length, 4),
    profitFactor: grossLoss > 0 ? round(grossWin / grossLoss, 3) : (grossWin > 0 ? 99 : 0),
    maxDrawdownPct: round(dd, 4)
  };
}

// Monte Carlo (مصحّح): المقارنة السابقة (مجموع العوائد مقابل eq - dd) كانت موجبة لأي استراتيجية
// وتعتمد على Math.random. الآن: bootstrap للعوائد مع الإرجاع (seeded) → p-value لـ"المتوسط <= 0"،
// وتوزيع التراجع من الخلط كمقياس مخاطرة منفصل.
const EDGE_P_VALUE_MAX = Number(process.env.SCALPER_EDGE_P_VALUE_MAX || process.env.EDGE_P_VALUE_MAX || 0.05);
function monteCarloSequence(returns, runs = 2000, seed = 17) {
  const bootstrap = bootstrapEdge(returns, { iterations: runs, seed });
  const dd = drawdownRisk(returns, { runs, seed: seed + 1 });
  return {
    runs, method: 'bootstrap_mean_returns', seed, n: bootstrap.n,
    observed: bootstrap.observedTotalPct,
    observedMeanPct: bootstrap.observedMeanPct,
    pValue: bootstrap.pValueMeanLeZero,
    p05: bootstrap.totalP05, p50: bootstrap.totalP50, p95: bootstrap.totalP95,
    zScore: bootstrap.zScore,
    observedMaxDrawdownPct: dd.observedMaxDrawdownPct,
    maxDrawdownP50: dd.maxDrawdownP50, maxDrawdownP95: dd.maxDrawdownP95
  };
}

function concentrationCheck(trades) {
  if (!trades.length) return { ok: true, topShare: 0, note: 'no-trades' };
  const bySym = {};
  for (const t of trades) bySym[t.symbol] = (bySym[t.symbol] || 0) + t.netPct;
  const total = Object.values(bySym).reduce((a, b) => a + Math.abs(b), 0) || 1;
  const sorted = Object.entries(bySym).sort((a, b) => Math.abs(b[1]) - Math.abs(a[1]));
  const top3 = sorted.slice(0, 3).reduce((s, [, v]) => s + Math.abs(v), 0);
  const share = top3 / total;
  return {
    ok: share <= 0.5,
    topShare: round(share * 100, 1),
    topSymbols: sorted.slice(0, 3).map(([s, v]) => ({ symbol: s, netPct: round(v, 3) })),
    note: share > 0.5 ? 'REJECT: top-3 symbols > 50% of absolute PnL' : 'concentration OK'
  };
}

function splitIsoos(trades) {
  if (trades.length < 5) return { is: trades, oos: [] };
  const sorted = trades.slice().sort((a, b) => a.entryTime - b.entryTime);
  const cut = Math.floor(sorted.length * 0.7);
  return { is: sorted.slice(0, cut), oos: sorted.slice(cut) };
}

async function runBacktest(framesBySymbol) {
  const allTrades = [];
  const perSymbol = [];
  for (const [symbol, frames] of Object.entries(framesBySymbol)) {
    const sim = simulateSymbol(symbol, frames);
    perSymbol.push({ symbol, summary: summarize(sim.trades), trades: sim.trades.length });
    allTrades.push(...sim.trades);
  }

  const { is, oos } = splitIsoos(allTrades);
  const isSum = summarize(is);
  const oosSum = summarize(oos);
  const allSum = summarize(allTrades);
  const returns = allTrades.map(t => t.netPct);
  const mc = monteCarloSequence(returns, Number(process.env.MONTE_CARLO_RUNS || 2000));
  const conc = concentrationCheck(allTrades);

  const passed =
    isSum.trades >= 15 &&
    oosSum.trades >= 5 &&
    oosSum.netPct > 0 &&
    allSum.profitFactor > 1 &&
    Number.isFinite(mc.pValue) && mc.pValue <= EDGE_P_VALUE_MAX &&
    conc.ok;

  const report = {
    engineVersion: ENGINE_VERSION,
    gateVersion: GATE_VERSION,
    generatedAt: new Date().toISOString(),
    overall: allSum, is: isSum, oos: oosSum,
    monteCarlo: mc, concentration: conc, perSymbol,
    passed, status: passed ? 'PASS' : 'BLOCKED',
    note: 'Edge gate = bootstrap P(mean per-trade return <= 0) <= ' + EDGE_P_VALUE_MAX + '; permutation drawdown is a risk metric only.'
  };

  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
  atomicWriteJson(REPORT_FILE, report, { validate: v => v && typeof v === 'object' && !Array.isArray(v) });

  const verification = {
    gateVersion: GATE_VERSION,
    status: report.status,
    passed: report.passed,
    reason: report.passed ? 'criteria-met' : 'insufficient-or-weak-stats',
    generatedAt: report.generatedAt,
    engineVersion: ENGINE_VERSION,
    overall: allSum, is: isSum, oos: oosSum,
    concentration: conc, monteCarlo: mc
  };
  atomicWriteJson(VERIFICATION_FILE, verification, { validate: v => v && typeof v === 'object' && !Array.isArray(v) });

  console.log(JSON.stringify({
    netPct: allSum.netPct,
    profitFactor: allSum.profitFactor,
    trades: allSum.trades,
    concentration: conc.note
  }));

  return report;
}

async function main() {
  const histDir = path.join(DATA_DIR, 'historical');
  if (!fs.existsSync(histDir)) {
    console.log([
      'No historical dataset available under data/scalper/historical/.',
      'Expected files: SYMBOL_1m.json (and optional _3m/_5m/_15m).',
      'Schema: JSON array of {openTime,open,high,low,close,volume,closeTime} or Binance kline arrays.',
      'Backtest not executed. Verification remains BLOCKED.'
    ].join('\n'));
    const verification = {
      gateVersion: GATE_VERSION, status: 'BLOCKED', passed: false,
      reason: 'no-historical-data', generatedAt: new Date().toISOString(),
      engineVersion: ENGINE_VERSION
    };
    if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
    atomicWriteJson(VERIFICATION_FILE, verification, { validate: v => v && typeof v === 'object' && !Array.isArray(v) });
    console.log(JSON.stringify({ netPct: 0, profitFactor: 0, trades: 0, concentration: 'no-data' }));
    return;
  }

  const framesBySymbol = {};
  for (const symbol of CONFIG.symbols) {
    const frames = {};
    for (const iv of ['1m', '3m', '5m', '15m']) {
      const fp = path.join(histDir, `${symbol}_${iv}.json`);
      if (fs.existsSync(fp)) {
        const raw = JSON.parse(fs.readFileSync(fp, 'utf8'));
        const prepared = prepareKlines(raw, 20, Date.now() + 86400000);
        frames[iv] = prepared.klines;
      }
    }
    if (frames['1m'] && frames['1m'].length > 60) framesBySymbol[symbol] = frames;
  }

  if (!Object.keys(framesBySymbol).length) {
    console.log('No usable historical frames found.');
    console.log(JSON.stringify({ netPct: 0, profitFactor: 0, trades: 0, concentration: 'no-frames' }));
    return;
  }

  await runBacktest(framesBySymbol);
}

if (process.env.SCALPER_TEST === '1' || require.main !== module) {
  module.exports = { validateOhlcvSeries, 
    simulateSymbol, summarize, monteCarloSequence, concentrationCheck,
    splitIsoos, runBacktest
  };
} else {
  main().catch(e => { console.error(e); process.exitCode = 1; });
}
