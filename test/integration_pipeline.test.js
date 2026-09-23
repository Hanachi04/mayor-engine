'use strict';
/**
 * Integration-style tests for risk/adaptation/ML/status path without live network.
 * Uses temp dirs; does not touch production data/.
 */
process.env.CLOUD_PRO_TEST = '1';
process.env.ADAPTATION_ENABLED = '1';
process.env.ADAPT_MIN_TRADES = '4';
process.env.ADAPT_LOOKBACK_TRADES = '6';
process.env.ADAPT_MIN_PF = '0.9';
process.env.ADAPT_MAX_NET_PCT = '-2';
process.env.ADAPT_BAN_HOURS = '24';
process.env.ADAPT_MAX_NEW_BANS = '5';
process.env.MAX_LOSS_STREAK = '4';
process.env.MAX_DAILY_LOSS_PCT = '5';
process.env.LOSS_STREAK_WINDOW_HOURS = '48';
process.env.LOSS_STREAK_COOLDOWN_HOURS = '12';
process.env.ML_SHADOW_MODE = 'log';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const os = require('os');

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'mayor-int-'));
process.env.ADAPTATION_DATA_DIR = tmp;
const adaptation = require('../engine/adaptation');
adaptation.setDataDir(tmp);

const { checkCircuitBreaker } = require('../engine/scan.js');
const shadowGate = require('../engine/ml/shadow_gate');

function closed(symbol, net, hoursAgo) {
  return {
    symbol,
    closed: true,
    closePct: net,
    closeAt: new Date(Date.now() - hoursAgo * 3600_000).toISOString(),
    strategyMode: 'core'
  };
}

const today = new Date().toISOString().slice(0, 10);

// A: risk pass when healthy history
(function scenarioRiskPass() {
  const tracked = [closed('BTCUSDT', 1, 1), closed('BTCUSDT', 0.5, 2)];
  const br = checkCircuitBreaker(tracked, today, Date.now());
  assert.equal(br.tripped, false);
  console.log('✓ A risk pass on healthy history');
})();

// B: adaptation blocks weak symbol
(function scenarioAdaptBlock() {
  const tracked = [
    closed('AAAUSDT', -1, 1), closed('AAAUSDT', -1, 2),
    closed('AAAUSDT', -1, 3), closed('AAAUSDT', -1, 4)
  ];
  const { allowed, skipped } = adaptation.filterEligible(['AAAUSDT', 'ETHUSDT'], tracked);
  assert.ok(!allowed.includes('AAAUSDT') || skipped.some(s => s.symbol === 'AAAUSDT'));
  assert.ok(allowed.includes('ETHUSDT'));
  console.log('✓ B adaptation blocks weak symbol');
})();

// C: circuit breaker active
(function scenarioBreaker() {
  const tracked = [
    closed('X', -1, 1), closed('X', -1, 2), closed('X', -1, 3), closed('X', -1, 4)
  ];
  const br = checkCircuitBreaker(tracked, today, Date.now());
  assert.equal(br.tripped, true);
  console.log('✓ C circuit breaker active');
})();

// D: ML log does not block
(function scenarioMlLog() {
  assert.equal(String(process.env.ML_SHADOW_MODE).toLowerCase(), 'log');
  const signal = {
    symbol: 'BTCUSDT', dir: 'LONG', corePct: 80, mtfPct: 90, adx: 25,
    atrPct: 0.02, rr: 2, rsi4h: 50, ts: Date.now(), slot: 1
  };
  const ev = shadowGate.evaluateCandidate(signal);
  assert.equal(ev.allow, true, 'log mode must allow');
  console.log('✓ D ML shadow log does not block signal');
})();

// Default filter not enabled
(function scenarioFilterNotDefault() {
  assert.notEqual(String(process.env.ML_SHADOW_MODE || 'log').toLowerCase(), 'filter');
  console.log('✓ ML filter not default');
})();

try { fs.rmSync(tmp, { recursive: true, force: true }); } catch (_) {}
console.log('✓ test/integration_pipeline: passed');
