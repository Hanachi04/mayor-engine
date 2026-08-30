'use strict';

const assert = require('assert');
const { CONFIG, normalizeKlines, prepareKlines, analyze1m, calculatePositionSize } = require('../core');
const { concentration, simulateSymbol } = require('../backtest');

function series(count = 80) {
  return Array.from({ length: count }, (_, i) => { const close = 100 + i * 0.15; return { openTime: i * 60000, open: close - 0.03, high: close + 0.08, low: close - 0.08, close, volume: 1000 + i, closeTime: (i + 1) * 60000 - 1 }; });
}
const clean = series();
const incomplete = [...clean, { ...clean.at(-1), openTime: 80 * 60000, closeTime: 81 * 60000 }];
assert.strictEqual(prepareKlines(incomplete, clean.at(-1).closeTime + 1).length, clean.length);
assert.ok(analyze1m(clean, 'TEST') === null || analyze1m(clean, 'TEST').signalTime < incomplete.at(-1).closeTime);
const position = calculatePositionSize({ price: 100, sl: 99 });
assert.strictEqual(position.riskCapital, 3.5);
assert.ok(position.quantity > 0);
assert.strictEqual(concentration([]).passed, true);
const tooConcentrated = concentration([{ symbol: 'BTCUSDT', netPct: 60 }, { symbol: 'ETHUSDT', netPct: 20 }]);
assert.strictEqual(tooConcentrated.passed, false);
assert.strictEqual(CONFIG.maxTradeAgeMs, 20 * 60 * 1000);
assert.strictEqual(CONFIG.cooldownMs, 3 * 60 * 1000);
assert.strictEqual(CONFIG.symbols.length, 5);
for (const trade of simulateSymbol('TEST', clean, 0, clean.at(-1).closeTime + 1)) assert.ok(trade.holdMinutes <= 20.0001);
console.log('✓ scalper-v1 unit and acceptance tests passed');
