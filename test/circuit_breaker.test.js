'use strict';
process.env.CLOUD_PRO_TEST = '1';
process.env.MAX_LOSS_STREAK = '4';
process.env.MAX_DAILY_LOSS_PCT = '5';
process.env.LOSS_STREAK_WINDOW_HOURS = '48';
process.env.LOSS_STREAK_COOLDOWN_HOURS = '12';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const os = require('os');

// Isolate circuit_breaker.json under the runner's MAYOR_STATE_DIR
// We'll test checkCircuitBreaker by requiring scan with CLOUD_PRO_TEST
const { checkCircuitBreaker, CONFIG } = require('../engine/scan.js');

const DATA_DIR = process.env.MAYOR_STATE_DIR || path.join(__dirname, '..', 'data');
const BREAKER_FILE = path.join(DATA_DIR, 'circuit_breaker.json');
const backup = fs.existsSync(BREAKER_FILE) ? fs.readFileSync(BREAKER_FILE, 'utf8') : null;

function wipe() {
  if (fs.existsSync(BREAKER_FILE)) fs.unlinkSync(BREAKER_FILE);
}

function trade(net, hoursAgo, dayOffset = 0) {
  const d = new Date(Date.now() - hoursAgo * 3600_000 - dayOffset * 86400_000);
  return {
    closed: true,
    closePct: net,
    closeAt: d.toISOString(),
    symbol: 'BTCUSDT'
  };
}

wipe();
const today = new Date().toISOString().slice(0, 10);

(function fourLossesTrip() {
  wipe();
  const tracked = [trade(-1, 1), trade(-1, 2), trade(-1, 3), trade(-1, 4)];
  const r = checkCircuitBreaker(tracked, today, Date.now());
  assert.equal(r.tripped, true, '4 losses should trip');
  assert.ok(r.untilMs > Date.now(), 'must have cooldown untilMs');
  console.log('✓ 4 consecutive losses trip with cooldown');
})();

(function oldLossesOutsideWindow() {
  wipe();
  // losses 100h ago — outside 48h window
  const tracked = [trade(-1, 100), trade(-1, 101), trade(-1, 102), trade(-1, 103)];
  const r = checkCircuitBreaker(tracked, today, Date.now());
  assert.equal(r.tripped, false, 'old losses must not trip');
  console.log('✓ old losses outside window do not trip');
})();

(function winBreaksStreak() {
  wipe();
  const tracked = [trade(2, 1), trade(-1, 2), trade(-1, 3), trade(-1, 4), trade(-1, 5)];
  const r = checkCircuitBreaker(tracked, today, Date.now());
  assert.equal(r.tripped, false, 'win breaks streak');
  console.log('✓ winning trade breaks streak');
})();

(function cooldownPersists() {
  wipe();
  const tracked = [trade(-1, 1), trade(-1, 2), trade(-1, 3), trade(-1, 4)];
  const r1 = checkCircuitBreaker(tracked, today, Date.now());
  assert.equal(r1.tripped, true);
  // empty tracked but state has untilMs
  const r2 = checkCircuitBreaker([], today, Date.now());
  assert.equal(r2.tripped, true, 'cooldown must persist after restart-like call');
  // after cooldown expires
  const r3 = checkCircuitBreaker([], today, Date.now() + 13 * 3600_000);
  assert.equal(r3.tripped, false, 'after cooldown clear');
  console.log('✓ cooldown persistence and expiry');
})();

(function dailyLoss() {
  wipe();
  const tracked = [
    { closed: true, closePct: -3, closeAt: `${today}T10:00:00.000Z` },
    { closed: true, closePct: -3, closeAt: `${today}T12:00:00.000Z` }
  ];
  const r = checkCircuitBreaker(tracked, today, Date.now());
  assert.equal(r.tripped, true, 'daily loss should trip');
  console.log('✓ daily loss trips');
})();

// restore
wipe();
if (backup !== null) fs.writeFileSync(BREAKER_FILE, backup);

console.log('✓ test/circuit_breaker: all passed');
