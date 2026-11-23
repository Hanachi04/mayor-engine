'use strict';

const assert = require('assert');
const {
  createSignalNotification,
  attemptSignalNotification,
  retryPendingSignalNotifications,
  retryDelayMs
} = require('../engine/telegram_outbox');

const NOW = Date.parse('2026-11-23T12:00:00.000Z');
const record = (overrides = {}) => {
  const r = { symbol: 'BTCUSDT', dir: 'LONG', ts: NOW, ...overrides };
  r.signalNotification = createSignalNotification(r, 'signal payload');
  return r;
};

(async () => {
  {
    const item = record();
    const tracked = [item];
    const snapshots = [];
    let sends = 0;
    const result = await attemptSignalNotification(item, tracked, {
      now: () => NOW,
      save: rows => snapshots.push(JSON.parse(JSON.stringify(rows))),
      send: async () => { sends++; return false; }
    });
    assert.strictEqual(result, false);
    assert.strictEqual(sends, 1);
    assert.strictEqual(item.signalNotification.status, 'pending');
    assert.strictEqual(item.signalNotification.attempts, 1);
    assert.strictEqual(Date.parse(item.signalNotification.nextAttemptAt), NOW + 60_000);
    assert.strictEqual(snapshots.length, 2);
    assert.strictEqual(snapshots[0][0].signalNotification.attempts, 1,
      'attempt and backoff must be persisted before send');
  }
  {
    const item = record();
    const tracked = [item];
    let sends = 0;
    await attemptSignalNotification(item, tracked, {
      now: () => NOW,
      save: () => {},
      send: async () => { sends++; return 1; }
    });
    assert.strictEqual(item.signalNotification.status, 'pending', 'truthy non-true is not delivery');
    assert.strictEqual(item.signalNotification.attempts, 1);
    assert.strictEqual(sends, 1);
  }
  {
    const item = record();
    const tracked = [item];
    let sends = 0;
    await attemptSignalNotification(item, tracked, {
      now: () => NOW,
      save: () => {},
      send: async payload => { assert.strictEqual(payload, 'signal payload'); sends++; return true; }
    });
    assert.strictEqual(item.signalNotification.status, 'sent');
    assert.strictEqual(item.signalNotification.attempts, 1);
    assert.strictEqual(item.signalNotification.sentAt, new Date(NOW).toISOString());
    await retryPendingSignalNotifications(tracked, { now: () => NOW + 10_000, save: () => {}, send: async () => { sends++; return true; } });
    assert.strictEqual(sends, 1, 'sent notification must never be resent');
  }
  {
    const pending = record();
    pending.signalNotification.nextAttemptAt = new Date(NOW + 60_000).toISOString();
    const legacy = { symbol: 'ETHUSDT', dir: 'SHORT', ts: NOW };
    const sent = record({ symbol: 'SOLUSDT' });
    sent.signalNotification.status = 'sent';
    const tracked = [pending, legacy, sent];
    let sends = 0;
    await retryPendingSignalNotifications(tracked, {
      now: () => NOW,
      save: () => {},
      send: async () => { sends++; return true; }
    });
    assert.strictEqual(sends, 0, 'backoff, legacy rows, and sent rows must not be sent');
    await retryPendingSignalNotifications(tracked, {
      now: () => NOW + 60_000,
      save: () => {},
      send: async () => { sends++; return false; }
    });
    assert.strictEqual(sends, 1, 'due pending notification retries on a later run');
    assert.strictEqual(pending.signalNotification.attempts, 1);
  }
  assert.strictEqual(retryDelayMs(1), 60_000);
  assert.strictEqual(retryDelayMs(2), 120_000);
  assert.strictEqual(retryDelayMs(100), 6 * 60 * 60 * 1000, 'retry delay is capped at six hours');
  console.log('✓ telegram outbox: pending, strict success, bounded retry, and legacy/sent deduplication');
})().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
