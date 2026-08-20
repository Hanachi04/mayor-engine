'use strict';

process.env.CLOUD_PRO_TEST = '1';
const assert = require('assert');
const { Indicators, prepareKlines, netPnl, calculatePositionSize, WEIGHTS, WEIGHT_PROFILES,
  VOTE_PLUGINS, roundDownToStep, applyExchangeLotSizing, checkCircuitBreaker } = require('../engine/scan.js');
const { monteCarlo, correlationMatrix } = require('../engine/backtest.js');

function approx(actual, expected, tolerance = 1e-8, label = '') {
  assert.ok(Math.abs(actual - expected) <= tolerance, `${label} expected ${expected}, got ${actual}`);
}

(function testEmaReference() {
  const out = Indicators.ema([1, 2, 3, 4, 5], 3);
  assert.deepStrictEqual(out.slice(0, 2), [null, null]);
  approx(out[2], 2, 1e-12, 'EMA seed');
  approx(out[3], 3, 1e-12, 'EMA next');
  approx(out[4], 4, 1e-12, 'EMA next 2');
})();

(function testMacdAlignment() {
  const closes = Array.from({ length: 60 }, (_, i) => 100 + i);
  const m = Indicators.macd(closes);
  assert.strictEqual(m.line.slice(0, 25).every(v => v === null), true, 'MACD must wait for slow EMA');
  assert.strictEqual(m.signalSeries[25], null, 'signal must not be backfilled');
  assert.ok(Number.isFinite(m.signalSeries[33]), 'signal starts after 9 complete MACD values');
  assert.strictEqual(m.line.length, closes.length, 'MACD line length alignment');
  assert.strictEqual(m.signalSeries.length, closes.length, 'signal length alignment');
})();

(function testWilderAtr() {
  const h = [], l = [], c = [];
  for (let i = 0; i < 40; i++) { h.push(12); l.push(10); c.push(11); }
  const series = Indicators.atrSeries(h, l, c, 14);
  assert.ok(Number.isFinite(series.at(-1)), 'Wilder ATR should produce a value');
  approx(series.at(-1), 2, 1e-12, 'Wilder ATR constant range');
})();

(function testWilderAdxAndDi() {
  const h = [], l = [], c = [];
  for (let i = 0; i < 80; i++) { const p = 100 + i; h.push(p + 2); l.push(p - 1); c.push(p + 1); }
  const a = Indicators.adx(h, l, c, 14);
  assert.ok(a.adx > 90, `ADX should recognize a persistent trend, got ${a.adx}`);
  assert.ok(a.pdi > a.mdi, '+DI should exceed -DI in an upward trend');
})();

(function testSupertrendTracksBothBands() {
  const h = [], l = [], c = [];
  for (let i = 0; i < 30; i++) { const p = i < 15 ? 100 - i * 2 : 70 + (i - 15) * 3; h.push(p + 2); l.push(p - 2); c.push(p); }
  const s = Indicators.supertrend(h, l, c, 7, 2);
  assert.ok(s.upper.some(Number.isFinite), 'upper band must be tracked');
  assert.ok(s.lower.some(Number.isFinite), 'lower band must be tracked');
  assert.ok(s.line.some(Number.isFinite), 'active Supertrend line must exist');
  assert.ok(s.directions.some(v => v === 1) && s.directions.some(v => v === -1), 'trend should be able to reverse');
})();

(function testClosedCandleGate() {
  const now = 2_000_000;
  const raw = [[1, 100, 102, 99, 101, 10, 1_999_000, 0, 0, 5]];
  const result = prepareKlines(raw, 1, now);
  assert.strictEqual(result.ok, true);
  const incomplete = [[2, 100, 102, 99, 101, 10, 2_000_000, 0, 0, 5]];
  assert.strictEqual(prepareKlines(incomplete, 1, now).ok, false, 'open candle must be rejected');
})();

(function testCostsAndPositionSizing() {
  const cfg = { takerFeeRate: 0.0005, slippageRate: 0.0002, capital: 1000, riskPerTradePct: 1, leverage: 1, maxNotionalMultiple: 1 };
  const p = netPnl(100, 110, 'LONG', cfg);
  assert.ok(p.grossPct < 10 && p.netPct < p.grossPct, 'costs must reduce net PnL');
  const pos = calculatePositionSize({ price: 100, sl: 98 }, cfg);
  assert.strictEqual(pos.riskCapital, 10);
  assert.ok(pos.quantity > 0 && pos.notional <= 1000);
})();

(function testStatisticalValidation() {
  const returns = [1.2, -0.6, 0.8, -0.4, 1.1, -0.3, 0.5, -0.2, 0.7, -0.1];
  const mc = monteCarlo(returns, 200);
  assert.strictEqual(mc.runs, 200, 'Monte Carlo must run at least 200 paths');
  assert.strictEqual(mc.method, 'permutation_paths');
  assert.ok(Number.isFinite(mc.zScore), 'Monte Carlo Z-score must be finite');
  assert.ok(mc.p05 <= mc.p50 && mc.p50 <= mc.p95, 'Monte Carlo percentiles must be ordered');
  const corr = correlationMatrix(returns.map((value, i) => ({ a: value, b: value * 2, c: i })));
  assert.ok(corr.highCorrelationPairs.some(p => p.a === 'a' && p.b === 'b'), 'high correlation pair must be detected');
  assert.ok(corr.bonferroniAlpha < 0.05, 'Bonferroni correction must be applied');
})();

(function testDefaultStrategyModeUnchanged() {
  // النمط الافتراضي "balanced" يجب أن يطابق تمامًا سلوك الإصدار السابق للدمج
  assert.deepStrictEqual(WEIGHTS, WEIGHT_PROFILES.balanced, 'default STRATEGY_MODE must equal legacy WEIGHTS exactly');
  assert.ok(VOTE_PLUGINS.some(p => p.key === 'sentiment'), 'sentiment vote plugin must be registered');
})();

(function testSentimentVoteContrarian() {
  const sentimentPlugin = VOTE_PLUGINS.find(p => p.key === 'sentiment');
  assert.strictEqual(sentimentPlugin.vote({ sentiment: 15 }), 1, 'extreme fear must tilt bullish');
  assert.strictEqual(sentimentPlugin.vote({ sentiment: 85 }), -1, 'extreme greed must tilt bearish');
  assert.strictEqual(sentimentPlugin.vote({ sentiment: 50 }), 0, 'neutral sentiment must not vote');
  assert.strictEqual(sentimentPlugin.vote({ sentiment: null }), 0, 'missing sentiment must not vote');
})();

(function testLotSizeRounding() {
  approx(roundDownToStep(1.23456, 0.001), 1.234, 1e-9, 'step rounding must floor to step precision');
  approx(roundDownToStep(0.0037, 0.0001), 0.0037, 1e-9, 'already-aligned quantity must be unchanged');
  const pos = { quantity: 3.0191602, notional: 1000, margin: 1000, leverage: 1 };
  // بدون كاش LOT_SIZE محمّل، يجب أن تُعاد الكمية كما هي دون كسر
  const untouched = applyExchangeLotSizing(pos, 'UNCACHEDUSDT', 331.2);
  assert.strictEqual(untouched.quantity, pos.quantity, 'position must pass through unchanged when no exchange filters are cached');
})();

(function testCircuitBreakerDisabledByDefault() {
  const tracked = [{ closed: true, closeAt: '2026-01-01T00:00:00Z', closePct: -50 }];
  const res = checkCircuitBreaker(tracked, '2026-01-01'); // CONFIG defaults: maxDailyLossPct=0, maxLossStreak=0
  assert.strictEqual(res.tripped, false, 'circuit breaker must stay inert when thresholds are 0 (disabled)');
})();

console.log('✓ npm test: all Cloud Pro unit tests passed');
