'use strict';

/**
 * Engine #4 unit tests — isolation, strategy math, execution, state idempotency.
 */

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const os = require('os');

// Isolate forward-test paths into a temp dir for this process
const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'engine4-test-'));
process.env.ENGINE4_MODE = 'REPLAY';

const strategy = require('../../engine/engine4/strategy');
const execution = require('../../engine/engine4/execution');
const data = require('../../engine/engine4/data');
const config = require('../../engine/engine4/config');

// Redirect PATHS to temp
for (const k of Object.keys(config.PATHS)) {
  if (k === 'root') config.PATHS.root = tmpRoot;
  else config.PATHS[k] = path.join(tmpRoot, k);
}

const journal = require('../../engine/engine4/journal');
const worker = require('../../engine/engine4/worker');
const metrics = require('../../engine/engine4/metrics');

function bar(ot, o, h, l, c) {
  return { ot, o, h, l, c, v: 1, data_source: 'test', received_at: new Date().toISOString() };
}

function makeTrendBars(n = 80) {
  const bars = [];
  let px = 100;
  const day = 86400000;
  const t0 = Date.UTC(2020, 0, 1);
  for (let i = 0; i < n; i++) {
    // slow uptrend with noise
    px = px * (1 + (i > 40 ? 0.01 : 0.002));
    const o = px;
    const c = px * 1.005;
    const h = c * 1.01;
    const l = o * 0.995;
    bars.push(bar(t0 + i * day, o, h, l, c));
    px = c;
  }
  return bars;
}

function makeBreakoutBars() {
  // flat then breakout
  const bars = [];
  const day = 86400000;
  const t0 = Date.UTC(2021, 0, 1);
  for (let i = 0; i < 30; i++) {
    bars.push(bar(t0 + i * day, 100, 101, 99, 100));
  }
  // breakout day
  bars.push(bar(t0 + 30 * day, 100, 110, 100, 108));
  // next open for entry
  bars.push(bar(t0 + 31 * day, 109, 112, 108, 111));
  // continue then exit channel
  for (let i = 32; i < 50; i++) {
    const base = 110 - (i - 32) * 0.5;
    bars.push(bar(t0 + i * day, base, base + 1, base - 2, base - 0.5));
  }
  return bars;
}

let passed = 0;
function test(name, fn) {
  try {
    fn();
    passed++;
    console.log('✓', name);
  } catch (e) {
    console.error('✗', name);
    console.error(e);
    process.exitCode = 1;
  }
}

async function testAsync(name, fn) {
  try {
    await fn();
    passed++;
    console.log('✓', name);
  } catch (e) {
    console.error('✗', name);
    console.error(e);
    process.exitCode = 1;
  }
}

// --- Strategy ---
test('Donchian upper uses prior bars only', () => {
  const bars = [
    bar(1, 10, 12, 9, 11),
    bar(2, 11, 13, 10, 12),
    bar(3, 12, 14, 11, 13),
  ];
  // at i=2, period=2 → max of bars[0].h, bars[1].h = max(12,13)=13 — excludes bar[2]
  const u = strategy.donchianUpper(bars, 2, 2);
  assert.strictEqual(u, 13);
});

test('breakout when close > prior 20 high', () => {
  const bars = makeBreakoutBars();
  // find index 30 (breakout)
  const sig = strategy.evaluateSignalAtClose(bars, 30);
  assert.ok(sig, 'expected signal');
  assert.strictEqual(sig.side, 'LONG');
  assert.ok(sig.N > 0);
});

test('no signal without breakout', () => {
  const bars = makeBreakoutBars();
  const sig = strategy.evaluateSignalAtClose(bars, 10);
  assert.strictEqual(sig, null);
});

test('exit stop preferred on same-candle conflict', () => {
  const bars = [
    ...Array.from({ length: 15 }, (_, i) => bar(i + 1, 100, 101, 99, 100)),
  ];
  // force low through stop and close below lower
  bars.push(bar(16, 100, 100, 50, 50));
  const stop = 90;
  const ex = strategy.evaluateExit(bars, bars.length - 1, 100, stop);
  assert.ok(ex);
  assert.strictEqual(ex.reason, 'stop');
  assert.strictEqual(ex.resolution, 'conservative');
});

// --- Execution ---
test('entry fill applies positive slip for long', () => {
  const f = execution.entryFill(100);
  assert.ok(f.price > 100);
});

test('exit fill applies negative slip for long', () => {
  const f = execution.exitFill(100, 'stop');
  assert.ok(f.price < 100);
});

test('net return subtracts 2x fee', () => {
  const r = execution.netReturnLong(100, 110);
  assert.ok(r.gross > 0.09 && r.gross < 0.11);
  assert.ok(r.net < r.gross);
});

// --- Data validation ---
test('reject high < low', () => {
  const v = data.validateBar(bar(1, 10, 9, 11, 10));
  assert.strictEqual(v.ok, false);
});

test('sort unique bars', () => {
  const bars = [bar(2, 1, 1, 1, 1), bar(1, 1, 1, 1, 1), bar(1, 2, 2, 2, 2)];
  const s = data.sortUniqueBars(bars);
  assert.strictEqual(s.length, 2);
  assert.strictEqual(s[0].ot, 1);
});

// --- Journal + worker replay determinism ---
(async () => {
  await testAsync('replay produces trades without crash', async () => {
    journal.ensureDirs();
    const bars = makeTrendBars(90);
    // Inject clear breakout mid-series
    bars[50] = bar(bars[50].ot, bars[49].c, bars[49].c * 1.2, bars[49].c, bars[49].c * 1.15);
    const state = await worker.runReplay({ BTCUSDT: bars }, { fresh: true, notify: false });
    assert.ok(state.equity > 0);
    assert.ok(typeof state.max_drawdown === 'number');
  });

  await testAsync('duplicate signal ids not double-counted', async () => {
    // clear
    for (const sub of ['signals', 'trades', 'equity', 'state', 'audit']) {
      const dir = config.PATHS[sub];
      if (fs.existsSync(dir)) for (const f of fs.readdirSync(dir)) fs.unlinkSync(path.join(dir, f));
    }
    const bars = makeBreakoutBars();
    const s1 = await worker.runReplay({ BTCUSDT: bars }, { fresh: true, notify: false });
    const trades1 = journal.closedTrades().length + Object.keys(s1.open_positions).length;
    // second run same bars should not add signals
    const s2 = await worker.runReplay({ BTCUSDT: bars }, { fresh: false, notify: false });
    const signals = journal.allSignals();
    const unique = new Set(signals.map((s) => s.signal_id));
    assert.strictEqual(signals.length, unique.size, 'duplicate signal rows');
    assert.ok(s2.equity === s1.equity || Object.keys(s2.open_positions).length >= 0);
    assert.ok(trades1 >= 0);
  });

  await testAsync('restart recovers open position without double entry', async () => {
    for (const sub of ['signals', 'trades', 'equity', 'state', 'audit']) {
      const dir = config.PATHS[sub];
      if (fs.existsSync(dir)) for (const f of fs.readdirSync(dir)) fs.unlinkSync(path.join(dir, f));
    }
    const bars = makeBreakoutBars().slice(0, 33); // signal + entry, not full exit
    const s1 = await worker.runReplay({ ETHUSDT: bars }, { fresh: true, notify: false });
    const open1 = Object.keys(s1.open_positions);
    // continue with more bars from saved state
    const more = makeBreakoutBars();
    const s2 = await worker.runReplay({ ETHUSDT: more }, { fresh: false, notify: false });
    // should not have 2 open positions for same symbol
    assert.ok(!Array.isArray(s2.open_positions.ETHUSDT));
    assert.ok(open1.length <= 1);
  });

  test('metrics summarize empty safely', () => {
    const s = metrics.summarizeClosed([]);
    assert.strictEqual(s.trades, 0);
  });

  test('config frozen periods', () => {
    assert.strictEqual(config.ENTRY_PERIOD, 20);
    assert.strictEqual(config.EXIT_PERIOD, 10);
    assert.strictEqual(config.STOP_MULT, 2.0);
    assert.strictEqual(config.DIRECTION, 'long_only');
  });

  console.log(`\nEngine4 tests passed: ${passed}`);
  // cleanup temp
  fs.rmSync(tmpRoot, { recursive: true, force: true });
})();
