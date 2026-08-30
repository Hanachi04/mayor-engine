'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const {
  LookaheadViolationError,
  assertNoLookahead,
  sliceWindowUntil,
  wrapDataSource,
  resetAudit,
  getSuccessfulCheckCount
} = require('../../engine/shared/data-contract');
const cloud = require('../../engine/scan.js');
const scalper = require('../../engine/scalper/scan.js');

const fixture = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'fixtures', 'klines.sample.json'), 'utf8'));
const asOf = fixture[fixture.length - 1].closeTime + 1;

assert.strictEqual(assertNoLookahead(fixture, asOf), true, 'closed fixture must pass');
assert.ok(getSuccessfulCheckCount() > 0, 'successful contract checks must be auditable');

const futureCandle = { ...fixture[fixture.length - 1], closeTime: asOf };
assert.throws(() => assertNoLookahead([...fixture, futureCandle], asOf), err => {
  return err instanceof LookaheadViolationError && err.name === 'LookaheadViolationError';
}, 'future or equal closeTime must be rejected explicitly');

const wrapped = wrapDataSource(async (_params, ref) => fixture.map(c => ({ ...c, closeTime: Math.min(c.closeTime, ref - 1) })));
assert.rejects(() => wrapped({ endpoint: 'fixture' }), /explicit asOf/);
assert.doesNotReject(() => wrapped({ endpoint: 'fixture' }, asOf));
const tickerRows = [{ symbol: 'BTCUSDT', quoteVolume: '123.45' }];
const wrappedTicker = wrapDataSource(async () => tickerRows);
assert.doesNotReject(() => wrappedTicker({ endpoint: 'ticker-24hr' }, asOf), 'non-candle arrays without closeTime must be accepted');

const window = sliceWindowUntil([...fixture, futureCandle], asOf, 100);
assert.strictEqual(window.length, fixture.length, 'window must exclude incomplete/future candle');
assert.ok(window.every(c => c.closeTime < asOf));

function makeSeries(count, step) {
  return Array.from({ length: count }, (_, i) => {
    const close = 100 + i * 0.1;
    return { openTime: i * step, open: close - 0.02, high: close + 0.05, low: close - 0.05, close, volume: 1000 + i, closeTime: (i + 1) * step - 1 };
  });
}

const cloudSeries = makeSeries(80, 5 * 60 * 1000);
const cloudWithIncomplete = [...cloudSeries, { ...cloudSeries.at(-1), openTime: 80 * 5 * 60 * 1000, closeTime: 81 * 5 * 60 * 1000 }];
const cloudClean = cloud.prepareKlines(cloudWithIncomplete, 55, cloudSeries.at(-1).closeTime + 1);
const cloudExpected = cloud.analyzeLatest('FIXTURE', cloudClean.klines, { skipSanitize: true, minKlines: 55 });
const cloudActual = cloud.analyzeLatest('FIXTURE', cloud.prepareKlines(cloudWithIncomplete, 55, cloudSeries.at(-1).closeTime + 1).klines, { skipSanitize: true, minKlines: 55 });
assert.deepStrictEqual(cloudActual, cloudExpected, 'Cloud Pro result must remain unchanged after rejecting incomplete candle');

const scalperSeries = makeSeries(40, 60 * 1000);
const scalperWithIncomplete = [...scalperSeries, { ...scalperSeries.at(-1), openTime: 40 * 60000, closeTime: 41 * 60000 }];
const scalperClean = scalper.prepareKlines(scalperWithIncomplete, 20, scalperSeries.at(-1).closeTime + 1);
const scalperExpected = scalper.analyze1m(scalperClean.klines, { symbol: 'FIXTURE', skipSanitize: true });
const scalperActual = scalper.analyze1m(scalper.prepareKlines(scalperWithIncomplete, 20, scalperSeries.at(-1).closeTime + 1).klines, { symbol: 'FIXTURE', skipSanitize: true });
assert.deepStrictEqual(scalperActual, scalperExpected, 'Scalper result must remain unchanged after rejecting incomplete candle');

resetAudit();
assert.strictEqual(getSuccessfulCheckCount(), 0);
console.log('✓ shared/data-contract: positive, adversarial, wrapper, slicing, and integration tests passed');
