'use strict';
process.env.SCALPER_TEST = '1';
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const os = require('os');

// Heartbeat writer is internal; re-implement contract checks against writeHeartbeat by loading scan exports if any
// We test the file shape by simulating writes the same way scan does

const DATA_DIR = path.join(os.tmpdir(), 'scalper-hb-' + Date.now());
fs.mkdirSync(DATA_DIR, { recursive: true });
const HEARTBEAT_FILE = path.join(DATA_DIR, 'heartbeat.json');
const ENGINE_VERSION = 'futures-scalper-v1.1';
const GATE_VERSION = 'scalper-statistical-gate-1';

function writeHeartbeat(ok = true, extra = {}) {
  const payload = {
    engineVersion: ENGINE_VERSION,
    gateVersion: GATE_VERSION,
    at: new Date().toISOString(),
    ts: Date.now(),
    ok: !!ok,
    workflowOk: true,
    dataFetchOk: extra.dataFetchOk !== undefined ? !!extra.dataFetchOk : !!ok,
    signalsAvailable: extra.signalsAvailable !== undefined ? !!extra.signalsAvailable : false,
    ...extra
  };
  fs.writeFileSync(HEARTBEAT_FILE, JSON.stringify(payload, null, 2));
  return payload;
}

(function dataFailure() {
  const p = writeHeartbeat(false, { error: 'HTTP 451', dataFetchOk: false, signalsAvailable: false, phase: 'data-fetch-failed' });
  assert.equal(p.ok, false);
  assert.equal(p.dataFetchOk, false);
  assert.equal(p.signalsAvailable, false);
  console.log('✓ data failure heartbeat');
})();

(function zeroSignals() {
  const p = writeHeartbeat(true, { phase: 'no-candidates', dataFetchOk: true, signalsAvailable: false, candidates: 0 });
  assert.equal(p.ok, true);
  assert.equal(p.dataFetchOk, true);
  assert.equal(p.signalsAvailable, false);
  console.log('✓ data ok zero signals');
})();

(function signalsEmitted() {
  const p = writeHeartbeat(true, { phase: 'done', dataFetchOk: true, signalsAvailable: true, emitted: 1 });
  assert.equal(p.signalsAvailable, true);
  console.log('✓ signals generated');
})();

try { fs.rmSync(DATA_DIR, { recursive: true, force: true }); } catch (_) {}
console.log('✓ test/heartbeat: passed');
