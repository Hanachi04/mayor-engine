'use strict';

const fs = require('fs');
const path = require('path');
const {
  CONFIG, ENGINE_VERSION, GATE_VERSION,
  analyze1m, emaDirection, softTrend15m, levelsFromSignal,
  entryFillPrice, exitFillPrice, prepareKlines, Indicators
} = require('./scan');
const { assertNoLookahead, sliceWindowUntil } = require('../shared/data-contract');

const DATA_DIR = path.join(__dirname, '..', '..', 'data', 'scalper');
const REPORT_FILE = path.join(DATA_DIR, 'backtest_report.json');
const VERIFICATION_FILE = path.join(DATA_DIR, 'verification.json');

function finite(v, fb = NaN) {
  const n = Number(v);
  return Number.isFinite(n) ? n : fb;
}
function round(v, d = 4) { return Number(Number(v).toFixed(d)); }

function simulateSymbol(symbol, frames) {
  const k1 = frames['1m'] || [];
  if (k1.length < 80) return { symbol, trades: [], reason: 'short-history' };

  const trades = [];
  const cooldownMs = CONFIG.cooldownMs;
  let lastEmitTs = 0;
  const maxAge = CONFIG.maxTradeAgeMs;
  const fee = CONFIG.takerFeeRate;

  for (let i = 50; i < k1.length - 2; i++) {
    const t = k1[i].closeTime;
    const asOf = t + 1;
    const slice1 = sliceWindowUntil(k1, asOf, 1500);
    const slice3 = sliceWindowUntil(frames['3m'] || [], asOf, 1500);
    const slice5 = sliceWindowUntil(frames['5m'] || [], asOf, 1500);
    const slice15 = sliceWindowUntil(frames['15m'] || [], asOf, 1500);
    assertNoLookahead(slice1, asOf);
    assertNoLookahead(slice3, asOf);
    assertNoLookahead(slice5, asOf);
    assertNoLookahead(slice15, asOf);

    if (slice3.length < 25 || slice5.length < 25) continue;

    const base = analyze1m(slice1, { symbol, skipSanitize: true, now: asOf });
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

function monteCarloSequence(returns, runs = 500) {
  if (returns.length < 3) {
    return { runs: 0, method: 'permutation_paths', zScore: 0, p05: 0, p50: 0, p95: 0, observed: 0 };
  }
  const observed = returns.reduce((a, b) => a + b, 0);
  const scores = [];
  for (let r = 0; r < runs; r++) {
    const arr = returns.slice();
    for (let i = arr.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [arr[i], arr[j]] = [arr[j], arr[i]];
    }
    let eq = 0, peak = 0, dd = 0;
    for (const x of arr) {
      eq += x;
      peak = Math.max(peak, eq);
      dd = Math.max(dd, peak - eq);
    }
    scores.push(eq - dd);
  }
  scores.sort((a, b) => a - b);
  const mean = scores.reduce((a, b) => a + b, 0) / scores.length;
  const variance = scores.reduce((a, b) => a + (b - mean) ** 2, 0) / scores.length;
  const std = Math.sqrt(variance) || 1e-9;
  const z = (observed - mean) / std;
  return {
    runs, method: 'permutation_paths',
    observed: round(observed, 4),
    p05: round(scores[Math.floor(runs * 0.05)], 4),
    p50: round(scores[Math.floor(runs * 0.5)], 4),
    p95: round(scores[Math.floor(runs * 0.95)], 4),
    mean: round(mean, 4), stddev: round(std, 4), zScore: round(z, 4)
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
  const mc = monteCarloSequence(returns, Number(process.env.MONTE_CARLO_RUNS || 500));
  const conc = concentrationCheck(allTrades);

  const passed =
    isSum.trades >= 15 &&
    oosSum.trades >= 5 &&
    oosSum.netPct > 0 &&
    allSum.profitFactor > 1 &&
    conc.ok;

  const report = {
    engineVersion: ENGINE_VERSION,
    gateVersion: GATE_VERSION,
    generatedAt: new Date().toISOString(),
    overall: allSum, is: isSum, oos: oosSum,
    monteCarlo: mc, concentration: conc, perSymbol,
    passed, status: passed ? 'PASS' : 'BLOCKED',
    note: 'Monte Carlo here measures sequence risk only, not edge vs random entries.'
  };

  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
  fs.writeFileSync(REPORT_FILE, JSON.stringify(report, null, 2));

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
  fs.writeFileSync(VERIFICATION_FILE, JSON.stringify(verification, null, 2));

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
    console.log('No data/scalper/historical/ — place SYMBOL_1m.json then re-run.');
    const verification = {
      gateVersion: GATE_VERSION, status: 'BLOCKED', passed: false,
      reason: 'no-historical-data', generatedAt: new Date().toISOString(),
      engineVersion: ENGINE_VERSION
    };
    if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
    fs.writeFileSync(VERIFICATION_FILE, JSON.stringify(verification, null, 2));
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
  module.exports = {
    simulateSymbol, summarize, monteCarloSequence, concentrationCheck,
    splitIsoos, runBacktest
  };
} else {
  main().catch(e => { console.error(e); process.exitCode = 1; });
}
