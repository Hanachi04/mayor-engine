'use strict';

process.env.SCALPER_TEST = '1';
process.env.CLOUD_PRO_TEST = '1';

const assert = require('assert');
const {
  CONFIG, ENGINE_VERSION, GATE_VERSION,
  analyze1m, levelsFromSignal, canEmit, entryFillPrice, exitFillPrice, Indicators
} = require('../../engine/scalper/scan');
const {
  summarize, monteCarloSequence, concentrationCheck, splitIsoos
} = require('../../engine/scalper/backtest');

function makeKlines(n, startTs = 1_700_000_000_000) {
  const out = [];
  for (let i = 0; i < n; i++) {
    const wave = Math.sin(i / 3) * 0.4;
    const base = 100 + i * 0.12 + wave;
    const open = base - 0.1 + (i % 2 === 0 ? 0.05 : -0.05);
    const close = base;
    const high = Math.max(open, close) + 0.2;
    const low = Math.min(open, close) - 0.2;
    const vol = i >= 72 ? 7000 : 1000 + (i % 5) * 50;
    const openTime = startTs + i * 60_000;
    out.push({ openTime, open, high, low, close, volume: vol, closeTime: openTime + 59999, takerBuyVolume: vol * 0.55 });
  }
  return out;
}

(function testConfigIsolation() {
  assert.strictEqual(ENGINE_VERSION, 'futures-scalper-v1.0');
  assert.strictEqual(GATE_VERSION, 'scalper-statistical-gate-1');
  assert.ok(CONFIG.cooldownMs <= 5 * 60 * 1000);
  assert.ok(CONFIG.maxSignalsPerDay >= 20);
  assert.ok(CONFIG.atrSlMult <= 1.5);
  assert.ok(CONFIG.minRr <= 2.0);
  assert.ok(CONFIG.riskPerTradePct <= 0.6);
})();

(function testEmaCrossDetection() {
  const up = makeKlines(80);
  const res = analyze1m(up, { symbol: 'BTCUSDT', skipSanitize: true, now: up.at(-1).closeTime + 1 });
  assert.ok(res.signal, `expected signal, got reason=${res.reason}`);
  assert.strictEqual(res.signal.dir, 'LONG');
  assert.ok(Number.isFinite(res.signal.atr));
  assert.ok(Number.isFinite(res.signal.rsi));
  assert.strictEqual(res.signal.volSpike, true);
})();

(function testLevelsRr() {
  const fake = { dir: 'LONG', price: 100, atr: 1.0, rsi: 45, volSpike: true, recentCross: true };
  const leveled = levelsFromSignal(fake);
  assert.ok(leveled);
  assert.ok(leveled.sl < leveled.price);
  assert.ok(leveled.tp1 > leveled.price);
  assert.ok(leveled.rr >= CONFIG.minRr * 0.95);
})();

(function testCooldown() {
  const now = Date.now();
  const tracked = [{ symbol: 'ETHUSDT', dir: 'LONG', ts: now - 60_000, closed: true }];
  assert.strictEqual(canEmit(tracked, { symbol: 'ETHUSDT', dir: 'LONG' }).ok, false);
  assert.strictEqual(canEmit([{ symbol: 'ETHUSDT', dir: 'LONG', ts: now - 10 * 60_000, closed: true }], { symbol: 'ETHUSDT', dir: 'LONG' }).ok, true);
})();

(function testMaxOpen() {
  const tracked = [];
  for (let i = 0; i < CONFIG.maxOpenTrades; i++) {
    tracked.push({ symbol: `S${i}USDT`, dir: 'LONG', ts: Date.now(), closed: false });
  }
  assert.strictEqual(canEmit(tracked, { symbol: 'BTCUSDT', dir: 'SHORT' }).ok, false);
})();

(function testFillPrices() {
  assert.ok(entryFillPrice(100, 'LONG') > 100);
  assert.ok(entryFillPrice(100, 'SHORT') < 100);
  assert.ok(exitFillPrice(110, 'LONG') < 110);
})();

(function testSummarizeAndMc() {
  const trades = [
    { netPct: 1.2, symbol: 'BTCUSDT' }, { netPct: -0.5, symbol: 'ETHUSDT' },
    { netPct: 0.8, symbol: 'SOLUSDT' }, { netPct: -0.3, symbol: 'BNBUSDT' },
    { netPct: 0.6, symbol: 'XRPUSDT' }
  ];
  const s = summarize(trades);
  assert.strictEqual(s.trades, 5);
  assert.ok(s.profitFactor > 1);
  const mc = monteCarloSequence(trades.map(t => t.netPct), 100);
  assert.strictEqual(mc.runs, 100);
  assert.ok(Number.isFinite(mc.zScore));
})();

(function testConcentration() {
  const heavy = [
    { netPct: 10, symbol: 'BTCUSDT' }, { netPct: 0.1, symbol: 'ETHUSDT' }, { netPct: 0.1, symbol: 'SOLUSDT' }
  ];
  assert.strictEqual(concentrationCheck(heavy).ok, false);
  const balanced = [
    { netPct: 1.0, symbol: 'BTCUSDT' }, { netPct: 1.0, symbol: 'ETHUSDT' },
    { netPct: 1.0, symbol: 'SOLUSDT' }, { netPct: 1.0, symbol: 'BNBUSDT' },
    { netPct: 1.0, symbol: 'XRPUSDT' }, { netPct: 1.0, symbol: 'ADAUSDT' },
    { netPct: 0.9, symbol: 'DOGEUSDT' }
  ];
  assert.strictEqual(concentrationCheck(balanced).ok, true);
})();

(function testParentIndicatorsStillWork() {
  const parent = require('../../engine/scan.js');
  const ema = parent.Indicators.ema([1, 2, 3, 4, 5, 6, 7, 8, 9, 10], 3);
  assert.ok(ema.at(-1) != null);
})();

(function testIsoosSplit() {
  const trades = Array.from({ length: 20 }, (_, i) => ({ entryTime: 1000 + i * 1000, netPct: i % 2 === 0 ? 0.5 : -0.2 }));
  const { is, oos } = splitIsoos(trades);
  assert.ok(is.length >= oos.length);
  assert.strictEqual(is.length + oos.length, 20);
})();

console.log('✓ test/scalper: all Futures Scalper v1 unit tests passed');
