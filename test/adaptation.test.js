'use strict';
process.env.CLOUD_PRO_TEST = '1';
process.env.ADAPTATION_ENABLED = '1';
process.env.ADAPT_MIN_TRADES = '4';
process.env.ADAPT_LOOKBACK_TRADES = '6';
process.env.ADAPT_MIN_PF = '0.9';
process.env.ADAPT_MAX_NET_PCT = '-2';
process.env.ADAPT_BAN_HOURS = '24';
process.env.ADAPT_MAX_NEW_BANS = '5';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const os = require('os');

const productionState = path.join(__dirname, '..', 'data', 'adaptation_state.json');
const prodBefore = fs.existsSync(productionState) ? fs.readFileSync(productionState, 'utf8') : null;

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'adapt-test-'));
process.env.ADAPTATION_DATA_DIR = tmp;

// Load after env set
const adaptation = require('../engine/adaptation');
adaptation.setDataDir(tmp);

function makeTrade(symbol, net, i) {
  return {
    symbol,
    closed: true,
    closePct: net,
    closeAt: new Date(Date.now() - i * 3600_000).toISOString(),
    closeResult: net >= 0 ? 'TP1' : 'SL'
  };
}

(function testWeakSymbolBanned() {
  const tracked = [
    makeTrade('AAAUSDT', -1, 1),
    makeTrade('AAAUSDT', -1.2, 2),
    makeTrade('AAAUSDT', -0.5, 3),
    makeTrade('AAAUSDT', -0.8, 4),
    makeTrade('BBBUSDT', 1.0, 1),
    makeTrade('BBBUSDT', 0.8, 2),
    makeTrade('BBBUSDT', 0.5, 3),
    makeTrade('BBBUSDT', 0.4, 4)
  ];
  const { allowed, skipped, activeBans } = adaptation.filterEligible(
    ['AAAUSDT', 'BBBUSDT', 'CCCUSDT'],
    tracked
  );
  assert.ok(activeBans.includes('AAAUSDT') || skipped.some(s => s.symbol === 'AAAUSDT'), 'weak AAA should skip');
  assert.ok(allowed.includes('BBBUSDT'), 'strong BBB allowed');
  assert.ok(allowed.includes('CCCUSDT'), 'unknown CCC allowed');
  console.log('✓ weak symbol banned / strong allowed');
})();

(function testInsufficientSampleNotBanned() {
  const tracked = [
    makeTrade('DDDUSDT', -5, 1),
    makeTrade('DDDUSDT', -5, 2)
  ];
  const state = adaptation.loadState();
  delete state.blacklist.DDDUSDT;
  adaptation.saveState(state);
  const { allowed } = adaptation.filterEligible(['DDDUSDT'], tracked);
  assert.ok(allowed.includes('DDDUSDT'), 'insufficient sample must not ban');
  console.log('✓ insufficient sample not banned');
})();

(function testProductionUntouched() {
  const after = fs.existsSync(productionState) ? fs.readFileSync(productionState, 'utf8') : null;
  assert.strictEqual(after, prodBefore, 'production adaptation_state.json must not change');
  console.log('✓ production adaptation_state untouched');
})();

// cleanup
try { fs.rmSync(tmp, { recursive: true, force: true }); } catch (_) {}

console.log('✓ test/adaptation: Layer A tests passed');
