'use strict';
/**
 * Tests: candle-walk exit logic (live trades) + bootstrap edge gate (Monte Carlo fix).
 * No network, no writes to data/.
 */
process.env.CLOUD_PRO_TEST = '1';
process.env.SCALPER_TEST = '1';

const assert = require('assert');
const { walkExit } = require('../engine/exit_walker');
const { bootstrapEdge, drawdownRisk, edgeGate, mulberry32 } = require('../engine/edge_stats');
const scan = require('../engine/scan.js');
const scalper = require('../engine/scalper/scan.js');
const { monteCarlo, buildGate } = require('../engine/backtest.js');
const { monteCarloSequence } = require('../engine/scalper/backtest.js');

const T0 = 1_700_000_000_000;
const M5 = 5 * 60_000;
function candle(i, o, h, l, c, step = M5, start = T0) {
  const openTime = start + i * step;
  return { openTime, open: o, high: h, low: l, close: c, volume: 1, closeTime: openTime + step - 1 };
}
const LONG = { dir: 'LONG', price: 100, sl: 98, tp1: 102, tp2: 104, tp3: 106, ts: T0 };
const SHORT = { dir: 'SHORT', price: 100, sl: 102, tp1: 98, tp2: 96, tp3: 94, ts: T0 };

// ---------- exit walker ----------
(function slTouchedBetweenRunsIsDetected() {
  // السعر لمس SL في الشمعة 1 ثم ارتد فوق TP1 — اللقطة اللحظية كانت ستسجّل TP
  const ks = [candle(0, 100, 101, 99, 100.5), candle(1, 100.5, 100.6, 97.5, 99), candle(2, 99, 103, 99, 102.8)];
  const exit = walkExit(LONG, ks, { entryTime: T0, maxAgeMs: 48 * 3600e3 });
  assert.strictEqual(exit.result, 'SL');
  assert.strictEqual(exit.rawExit, 98, 'must close at SL level, not later price');
  assert.strictEqual(exit.exitTime, ks[1].closeTime);
  console.log('✓ exit: SL touch between runs detected, closed at SL level');
})();

(function slFirstWhenBothInSameCandle() {
  const ks = [candle(0, 100, 102.5, 97.9, 101)];
  assert.strictEqual(walkExit(LONG, ks, { entryTime: T0 }).result, 'SL', 'LONG ambiguous candle → SL');
  const ks2 = [candle(0, 100, 102.1, 97.5, 99)];
  assert.strictEqual(walkExit(SHORT, ks2, { entryTime: T0 }).result, 'SL', 'SHORT ambiguous candle → SL');
  console.log('✓ exit: SL first when SL and TP share a candle');
})();

(function tpClosesAtLevelPrice() {
  const ks = [candle(0, 100, 101, 99.5, 100.8), candle(1, 100.8, 102.4, 100.5, 102.3)];
  const exit = walkExit(LONG, ks, { entryTime: T0 });
  assert.strictEqual(exit.result, 'TP1');
  assert.strictEqual(exit.rawExit, 102);
  const ksBig = [candle(0, 100, 106.5, 99.5, 106)];
  const big = walkExit(LONG, ksBig, { entryTime: T0 });
  assert.strictEqual(big.result, 'TP3', 'furthest target touched in same candle (backtest parity)');
  assert.strictEqual(big.rawExit, 106);
  console.log('✓ exit: TP closes at TP level');
})();

(function shortMirror() {
  const ks = [candle(0, 100, 100.5, 99, 99.2), candle(1, 99.2, 99.5, 95.8, 96.1)];
  const exit = walkExit(SHORT, ks, { entryTime: T0 });
  assert.strictEqual(exit.result, 'TP2');
  assert.strictEqual(exit.rawExit, 96);
  const ksSl = [candle(0, 100, 102.2, 99.8, 101)];
  assert.strictEqual(walkExit(SHORT, ksSl, { entryTime: T0 }).rawExit, 102);
  console.log('✓ exit: SHORT mirrored');
})();

(function ignoresPreEntryCandlesAndExpires() {
  const pre = candle(-1, 100, 110, 90, 100); // قبل الدخول: يجب تجاهلها
  const ks = [pre, candle(0, 100, 101, 99, 100.2), candle(1, 100.2, 101, 99, 100.4)];
  assert.strictEqual(walkExit(LONG, ks, { entryTime: T0 }), null, 'no exit → stays open');
  const expired = walkExit(LONG, ks, { entryTime: T0, maxAgeMs: M5 * 2 - 1, expiredLabel: 'TIMEOUT' });
  assert.strictEqual(expired.result, 'TIMEOUT');
  assert.strictEqual(expired.rawExit, 100.4, 'expiry closes at that candle close');
  console.log('✓ exit: pre-entry candles ignored, open/expiry handled');
})();

(function getMtfAtIgnoresFutureCandles() {
  const { getMtfAt } = require('../engine/backtest.js');
  const { CONFIG } = require('../engine/scan.js');
  const data = {};
  const frameMs = { '5m': 300_000, '15m': 900_000, '1h': 3_600_000, '4h': 14_400_000 };
  for (const tf of Object.keys(frameMs)) {
    const step = frameMs[tf];
    data[tf] = Array.from({ length: 240 }, (_, i) => {
      const close = 100 + i * 0.05;
      return { openTime: T0 + i * step, closeTime: T0 + (i + 1) * step - 1,
        open: close - 0.02, high: close + 0.2, low: close - 0.2, close, volume: 1000 };
    });
  }
  const at = data[CONFIG.baseInterval][199].closeTime + 1;
  const before = getMtfAt({ symbol: 'BTCUSDT', data }, at);
  const withFuture = Object.fromEntries(Object.entries(data).map(([tf, rows]) => [tf, [...rows,
    { openTime: rows.at(-1).openTime + frameMs[tf], closeTime: rows.at(-1).closeTime + frameMs[tf], open: 900, high: 1000, low: 800, close: 950, volume: 1e9 }
  ]]));
  const after = getMtfAt({ symbol: 'BTCUSDT', data: withFuture }, at);
  assert.strictEqual(before.frames[CONFIG.baseInterval].indicators.price, after.frames[CONFIG.baseInterval].indicators.price);
  assert.strictEqual(before.frames[CONFIG.baseInterval].indicators.price, data[CONFIG.baseInterval][199].close);
  console.log('✓ backtest getMtfAt ignores candles after evaluation timestamp');
})();

(async function checkOpenTradesUsesCandles() {
  // Cloud Pro: SL touched between runs; injected deps → no network/no file writes
  const tracked = [{ ...LONG, symbol: 'BTCUSDT', closed: false, position: { notional: 1000 } }];
  let saved = null; const msgs = [];
  const res = await scan.checkOpenTrades({
    loadTracked: () => tracked, saveTracked: a => { saved = a; }, notify: async m => { msgs.push(m); },
    fetchCandles: async (sym, start) => { assert.strictEqual(start, T0); return [candle(0, 100, 100.4, 97.9, 98.5), candle(1, 98.5, 103, 98.4, 102.9)]; }
  });
  assert.strictEqual(res.closed, 1);
  assert.strictEqual(saved[0].closeResult, 'SL');
  assert.strictEqual(saved[0].closePrice, 98);
  assert.ok(saved[0].closePct < 0);
  assert.strictEqual(saved[0].closeAt, new Date(T0 + M5 - 1).toISOString(), 'closeAt = candle close time');
  assert.strictEqual(msgs.length, 1);

  // Scalper: TP1 on 1m candles
  const M1 = 60_000;
  const st = [{ symbol: 'ETHUSDT', dir: 'SHORT', price: 100, sl: 101, tp1: 98.5, ts: T0, closed: false }];
  const r2 = await scalper.checkOpenTrades({
    loadTracked: () => st, saveTracked: () => {}, notify: async () => {},
    fetchCandles: async () => [candle(0, 100, 100.3, 99.4, 99.5, M1), candle(1, 99.5, 99.6, 98.2, 98.4, M1)]
  });
  assert.strictEqual(r2.closed, 1);
  assert.strictEqual(st[0].closeResult, 'TP1');
  assert.strictEqual(st[0].closePrice, 98.5);
  console.log('✓ exit: checkOpenTrades (Cloud Pro + Scalper) walk candles, not ticker');
})().then(runEdgeTests).catch(e => { console.error(e); process.exit(1); });

// ---------- bootstrap edge gate ----------
function runEdgeTests() {
  const rand = mulberry32(42);
  const gauss = () => { let u = 0, v = 0; while (!u) u = rand(); while (!v) v = rand(); return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v); };

  (function deterministic() {
    const r = [1, -0.5, 0.3, -0.2, 0.8];
    assert.deepStrictEqual(bootstrapEdge(r, { iterations: 500, seed: 7 }), bootstrapEdge(r, { iterations: 500, seed: 7 }), 'seeded → reproducible');
    console.log('✓ edge: bootstrap is reproducible with seed');
  })();

  (function zeroMeanStrategyFails() {
    const raw = Array.from({ length: 300 }, () => gauss());
    const m = raw.reduce((a, b) => a + b, 0) / raw.length;
    const zeroMean = raw.map(x => x - m); // متوسط صفري تمامًا
    const g = edgeGate(zeroMean, { iterations: 2000, seed: 17, alpha: 0.05 });
    assert.strictEqual(g.passed, false, `zero-mean strategy must fail, p=${g.pValue}`);
    assert.ok(g.pValue > 0.2, `p should be ~0.5, got ${g.pValue}`);
    // مقارنة بالسلوك القديم: خلط الترتيب لا يغيّر المجموع
    const mc = monteCarlo(zeroMean, 2000);
    assert.strictEqual(buildGate({ trades: 999 }, { trades: 999, netPct: 1, profitFactor: 1.2 }, mc).passed, false,
      'Cloud Pro gate must block a zero-mean strategy');
    const smc = monteCarloSequence(zeroMean, 2000);
    assert.ok(smc.pValue > 0.05, 'scalper MC must not flag zero-mean as edge');
    console.log('✓ edge: zero-mean random strategy fails the gate');
  })();

  (function randomSignStrategyFails() {
    // استراتيجية عشوائية رابح/خاسر متماثلة بعد الرسوم ≈ سالبة → يجب أن تفشل
    const r = Array.from({ length: 200 }, () => (rand() < 0.5 ? 1 : -1) - 0.1);
    assert.strictEqual(edgeGate(r, { iterations: 2000, seed: 17 }).passed, false);
    console.log('✓ edge: random coin-flip strategy (after fees) fails');
  })();

  (function positiveStrategyPasses() {
    const r = Array.from({ length: 200 }, () => 0.5 + gauss());
    const g = edgeGate(r, { iterations: 2000, seed: 17, alpha: 0.05 });
    assert.strictEqual(g.passed, true, `clearly positive strategy must pass, p=${g.pValue}`);
    assert.ok(g.bootstrap.totalP05 > 0, '5th percentile total return must be > 0');
    const mc = monteCarlo(r, 2000);
    assert.strictEqual(buildGate({ trades: 999 }, { trades: 999, netPct: 1, profitFactor: 1.2 }, mc).passed, true,
      'Cloud Pro gate must pass a clearly positive strategy with enough trades');
    assert.ok(monteCarloSequence(r, 2000).pValue <= 0.05);
    console.log('✓ edge: clearly positive strategy passes the gate');
  })();

  (function drawdownIsSeparateRiskMetric() {
    const r = [1, 1, 1, -2, -2, 1, 1, -1, 2, -1];
    const dd = drawdownRisk(r, { runs: 500, seed: 3 });
    assert.strictEqual(dd.method, 'permutation_drawdown');
    assert.ok(dd.maxDrawdownP05 <= dd.maxDrawdownP50 && dd.maxDrawdownP50 <= dd.maxDrawdownP95);
    const mc = monteCarlo(r, 500);
    assert.ok(Number.isFinite(mc.maxDrawdownP95) && Number.isFinite(mc.pValue));
    console.log('✓ edge: drawdown distribution reported separately');
  })();

  console.log('✓ test/exit_and_edge: passed');
}
