'use strict';
/**
 * Tests: engine/binance_http.js — retry/backoff and geo-block failover.
 * Mocked fetch, no-op sleep. No network, no writes to data/.
 */
const assert = require('assert');
const { requestJsonWithRetry, BinanceGeoBlockedError } = require('../engine/binance_http');

function res(status, body = {}, headers = {}) {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: { get: name => headers[name.toLowerCase()] ?? null },
    json: async () => body,
    text: async () => JSON.stringify(body)
  };
}

// Script responses: array of statuses/Response objects consumed in order, or fn(url)->Response.
function mockFetch(script) {
  const calls = [];
  const fn = async url => {
    const u = new URL(String(url));
    calls.push(u.hostname);
    const next = typeof script === 'function' ? script(u, calls.length) : script.shift();
    if (next instanceof Error) throw next;
    return typeof next === 'number' ? res(next) : next;
  };
  fn.calls = calls;
  return fn;
}

function opts(fetch, sleeps = []) {
  return { fetch, sleep: async ms => { sleeps.push(ms); }, log: () => {}, random: () => 0 };
}

const SPOT = 'https://api.binance.com/api/v3/klines?symbol=BTCUSDT&interval=1h';
const FAPI = 'https://fapi.binance.com/fapi/v1/klines?symbol=BTCUSDT&interval=1m';

(async () => {
  {
    const sleeps = [];
    const f = mockFetch([res(429, {}, { 'retry-after': '2' }), res(200, { ok: 1 })]);
    const out = await requestJsonWithRetry(SPOT, opts(f, sleeps));
    assert.deepStrictEqual(out, { ok: 1 });
    assert.strictEqual(f.calls.length, 2);
    assert.deepStrictEqual(sleeps, [2000], 'Retry-After honoured');
    console.log('✓ binance_http: 429 then 200 succeeds (Retry-After honoured)');
  }
  {
    const sleeps = [];
    const f = mockFetch([500, 500, 500, 500, 500]);
    await assert.rejects(requestJsonWithRetry(SPOT, opts(f, sleeps)), e => e.status === 500 && !(e instanceof BinanceGeoBlockedError));
    assert.strictEqual(f.calls.length, 5, '1 attempt + 4 retries');
    assert.ok(f.calls.every(h => h === 'api.binance.com'), '5xx does not switch host');
    assert.deepStrictEqual(sleeps, [500, 1000, 2000, 4000], 'exponential backoff');
    assert.ok(sleeps.every(ms => ms <= 8000));
    console.log('✓ binance_http: 500x5 fails after 4 retries with exponential backoff');
  }
  {
    const f = mockFetch([400]);
    await assert.rejects(requestJsonWithRetry(SPOT, opts(f)), e => e.status === 400);
    assert.strictEqual(f.calls.length, 1);
    console.log('✓ binance_http: 400 is not retried');
  }
  {
    const f = mockFetch([451, res(200, [1, 2])]);
    const out = await requestJsonWithRetry(SPOT, opts(f));
    assert.deepStrictEqual(out, [1, 2]);
    assert.deepStrictEqual(f.calls, ['api.binance.com', 'api1.binance.com']);
    console.log('✓ binance_http: 451 on api.binance.com -> alternate succeeds');
  }
  {
    const f = mockFetch(() => res(451));
    await assert.rejects(requestJsonWithRetry(SPOT, opts(f)), e => {
      assert.ok(e instanceof BinanceGeoBlockedError);
      assert.strictEqual(e.status, 451);
      assert.strictEqual(e.host, 'data-api.binance.vision');
      return true;
    });
    assert.deepStrictEqual(f.calls, ['api.binance.com', 'api1.binance.com', 'api2.binance.com', 'api3.binance.com', 'data-api.binance.vision']);
    console.log('✓ binance_http: 451 on all spot hosts -> BinanceGeoBlockedError');
  }
  {
    const f = mockFetch(() => res(403));
    await assert.rejects(requestJsonWithRetry(FAPI, opts(f)), e => e instanceof BinanceGeoBlockedError && e.status === 403 && e.host === 'fapi.binance.com');
    assert.deepStrictEqual(f.calls, ['fapi.binance.com']);
    console.log('✓ binance_http: fapi 403 -> immediate BinanceGeoBlockedError');
  }
  {
    const f = mockFetch([new TypeError('fetch failed'), res(200, { x: 1 })]);
    assert.deepStrictEqual(await requestJsonWithRetry(SPOT, opts(f)), { x: 1 });
    assert.strictEqual(f.calls.length, 2);
    console.log('✓ binance_http: network error is retried');
  }
  {
    const starts = [];
    let active = 0, maxActive = 0;
    const f = async () => {
      starts.push(Date.now());
      active++;
      maxActive = Math.max(maxActive, active);
      await new Promise(resolve => setTimeout(resolve, 2));
      active--;
      return res(200, { ok: true });
    };
    const jobs = Array.from({ length: 12 }, (_, i) => requestJsonWithRetry(`https://fapi.binance.com/test?n=${i}`, {
      fetch: f, minRequestGapMs: 3, maxRetries: 0, log: () => {}
    }));
    await Promise.all(jobs);
    assert.strictEqual(starts.length, 12);
    assert.strictEqual(maxActive, 1, 'Promise.all callers must still share one outbound request lane');
    console.log('✓ binance_http: concurrent Promise.all requests share the rate-limited queue');
  }
  console.log('✓ test/binance_http: passed');
})().catch(e => { console.error(e); process.exit(1); });
