'use strict';

const fs = require('fs');
const path = require('path');
const { CONFIG, normalizeKlines, prepareKlines, analyze1m } = require('./core');

const ROOT = __dirname;
const FIXTURE_DIR = path.join(ROOT, 'fixtures');
const REPORT_FILE = path.join(ROOT, 'data', 'backtest-report.json');
const SYMBOLS = CONFIG.symbols;
const MONTH_MS = 31 * 24 * 60 * 60 * 1000;

function load(symbol) {
  const file = path.join(FIXTURE_DIR, `${symbol}_1m.json`);
  if (!fs.existsSync(file)) return [];
  const raw = JSON.parse(fs.readFileSync(file, 'utf8'));
  const normalized = normalizeKlines(raw);
  const end = normalized.at(-1)?.closeTime || 0;
  return prepareKlines(normalized, end + 1);
}
function simulateSymbol(symbol, candles, startTime, endTime) {
  const trades = []; let lastSignal = -Infinity;
  for (let i = 50; i < candles.length - 1; i++) {
    const signalCandle = candles[i];
    if (signalCandle.closeTime < startTime || signalCandle.closeTime >= endTime) continue;
    const window = candles.slice(Math.max(0, i - 1499), i + 1);
    const signal = analyze1m(window, symbol);
    if (!signal || signal.signalTime >= endTime || signal.signalTime - lastSignal < CONFIG.cooldownMs) continue;
    const entry = candles[i + 1]; if (!entry || entry.openTime < signalCandle.closeTime) continue;
    let exit = null, result = 'TIMEOUT', exitIndex = i + 1;
    const lastExitIndex = Math.min(candles.length - 1, i + Math.ceil(CONFIG.maxTradeAgeMs / 60000));
    for (let j = i + 1; j <= lastExitIndex; j++) {
      const bar = candles[j];
      const stop = signal.dir === 'LONG' ? bar.low <= signal.sl : bar.high >= signal.sl;
      const target = signal.dir === 'LONG' ? bar.high >= signal.tp1 : bar.low <= signal.tp1;
      if (stop) { exit = signal.sl; result = 'SL'; exitIndex = j; break; }
      if (target) { exit = signal.tp1; result = 'TP1'; exitIndex = j; break; }
      exit = bar.close; exitIndex = j;
    }
    if (!Number.isFinite(exit)) continue;
    const sign = signal.dir === 'LONG' ? 1 : -1;
    const grossPct = sign * (exit - entry.open) / entry.open * 100;
    const netPct = grossPct - CONFIG.feeRate * 2 * 100;
    const holdMinutes = (candles[exitIndex].closeTime - entry.openTime) / 60000;
    if (holdMinutes > 20.0001) throw new Error(`hold limit violated for ${symbol}`);
    trades.push({ symbol, dir: signal.dir, entryTime: entry.openTime, exitTime: candles[exitIndex].closeTime, result, netPct: Number(netPct.toFixed(6)), holdMinutes });
    lastSignal = signal.signalTime;
  }
  return trades;
}
function concentration(trades) {
  const net = trades.reduce((s, t) => s + t.netPct, 0);
  const contributions = new Map();
  for (const t of trades) contributions.set(t.symbol, (contributions.get(t.symbol) || 0) + t.netPct);
  const top3 = [...contributions.values()].sort((a, b) => Math.abs(b) - Math.abs(a)).slice(0, 3).reduce((s, x) => s + x, 0);
  const pct = net !== 0 ? Math.abs(top3 / net) * 100 : 0;
  return { netPct: Number(net.toFixed(6)), top3ContributionPct: Number(pct.toFixed(4)), passed: pct <= CONFIG.maxConcentrationPct };
}
function summarize(trades) { const netPct = trades.reduce((s, t) => s + t.netPct, 0); return { trades: trades.length, wins: trades.filter(t => t.netPct > 0).length, netPct: Number(netPct.toFixed(6)), concentration: concentration(trades) }; }
function run() {
  const datasets = Object.fromEntries(SYMBOLS.map(s => [s, load(s)]));
  const available = Object.values(datasets).filter(a => a.length).map(a => a.at(-1).closeTime);
  if (!available.length) throw new Error('No local 1m fixtures found. Populate scalper-v1/fixtures first.');
  const end = Math.min(...available), start = end - MONTH_MS, split = start + MONTH_MS / 2;
  const isTrades = SYMBOLS.flatMap(s => simulateSymbol(s, datasets[s], start, split));
  const oosTrades = SYMBOLS.flatMap(s => simulateSymbol(s, datasets[s], split, end));
  const report = { generatedAt: new Date().toISOString(), mode: 'local-only', symbols: SYMBOLS, timeframe: '1m', periodDays: 31, split: { isEnd: new Date(split).toISOString(), oosStart: new Date(split).toISOString() }, is: summarize(isTrades), oos: summarize(oosTrades), concentrationGate: { maxPct: CONFIG.maxConcentrationPct, passed: summarize(isTrades).concentration.passed && summarize(oosTrades).concentration.passed } };
  fs.mkdirSync(path.dirname(REPORT_FILE), { recursive: true }); fs.writeFileSync(REPORT_FILE, JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report, null, 2));
  return report;
}
if (require.main === module) { try { run(); } catch (e) { console.error(e.message); process.exitCode = 1; } }
module.exports = { load, simulateSymbol, concentration, summarize, run };
