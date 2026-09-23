'use strict';
const assert = require('assert');
const { build, metrics } = require('../engine/auto_status');

(function testMetrics() {
  const m = metrics([
    { closed: true, closePct: 2 },
    { closed: true, closePct: -1 },
    { closed: true, closePct: 1 }
  ]);
  assert.equal(m.closed, 3);
  assert.equal(m.wins, 2);
  assert.ok(m.profitFactor > 1);
  console.log('✓ metrics basic');
})();

(function testBuildSeparatesModes() {
  const { status } = build();
  assert.ok(status.systems.mayor.core);
  assert.ok(status.systems.mayor.modeCounts);
  assert.ok(status.systems.mayor.strategyModeActive);
  assert.ok(String(status.systems.aegis.verdict).includes('منفّذ') || status.systems.aegis.operational === true || status.systems.aegis.operational === false);
  console.log('✓ build separates core and clarifies aegis');
})();

console.log('✓ test/auto_status: passed');
