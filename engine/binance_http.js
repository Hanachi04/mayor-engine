'use strict';
/**
 * Resilient JSON GET for Binance public REST endpoints.
 *
 * - Exponential backoff with jitter (base 500ms, cap 8s, max 4 retries).
 * - Honours Retry-After (seconds or HTTP date).
 * - Retries only on 429, 418, 5xx and network errors (incl. timeouts).
 * - 403/451 (geo-block): spot host api.binance.com falls through
 *   api1 -> api2 -> api3 -> data-api.binance.vision (public market data only),
 *   one host at a time. Futures (fapi.binance.com) and any other host have no
 *   alternate. When every candidate is blocked, BinanceGeoBlockedError is thrown.
 * - opts.fetch / opts.sleep are injectable for tests.
 */

const SPOT_HOST_CHAIN = [
  'api.binance.com',
  'api1.binance.com',
  'api2.binance.com',
  'api3.binance.com',
  'data-api.binance.vision'
];
const GEO_BLOCK_STATUSES = new Set([403, 451]);
const DEFAULTS = { maxRetries: 4, baseDelayMs: 500, maxDelayMs: 8000, maxRetryAfterMs: 60000, timeoutMs: 15000 };

class BinanceGeoBlockedError extends Error {
  constructor(status, host, triedHosts = [host]) {
    super(`Binance geo-blocked (HTTP ${status}) at ${host}; tried: ${triedHosts.join(', ')}`);
    this.name = 'BinanceGeoBlockedError';
    this.status = status;
    this.host = host;
    this.triedHosts = triedHosts;
  }
}

function defaultSleep(ms) { return new Promise(resolve => setTimeout(resolve, ms)); }

function isRetryableStatus(status) {
  return status === 429 || status === 418 || (status >= 500 && status <= 599);
}

function parseRetryAfterMs(value, now = Date.now()) {
  if (value == null || value === '') return null;
  const secs = Number(value);
  if (Number.isFinite(secs)) return Math.max(0, secs * 1000);
  const date = Date.parse(value);
  if (Number.isFinite(date)) return Math.max(0, date - now);
  return null;
}

function backoffDelayMs(attempt, { baseDelayMs, maxDelayMs }, random = Math.random) {
  const exp = Math.min(maxDelayMs, baseDelayMs * (2 ** attempt));
  return Math.min(maxDelayMs, Math.floor(exp + random() * baseDelayMs));
}

function getHeader(res, name) {
  if (!res || !res.headers) return null;
  if (typeof res.headers.get === 'function') return res.headers.get(name);
  return res.headers[name] ?? res.headers[name.toLowerCase()] ?? null;
}

function hostCandidates(url, publicMarketData) {
  const idx = SPOT_HOST_CHAIN.indexOf(url.hostname);
  if (idx === -1) return [url.hostname];
  return SPOT_HOST_CHAIN.slice(idx).filter(h => publicMarketData || h !== 'data-api.binance.vision');
}

// Retries one host. Returns parsed JSON, or throws (geo errors are tagged).
async function requestOneHost(url, o) {
  for (let attempt = 0; ; attempt++) {
    if (o.beforeAttempt) await o.beforeAttempt();
    let res, timer;
    try {
      const controller = typeof AbortController === 'function' ? new AbortController() : null;
      if (controller && o.timeoutMs > 0) timer = setTimeout(() => controller.abort(), o.timeoutMs);
      res = await o.fetch(url, { headers: o.headers, signal: controller ? controller.signal : undefined });
    } catch (e) {
      if (timer) clearTimeout(timer);
      // Network error / timeout: retryable.
      if (attempt >= o.maxRetries) {
        if (e && typeof e === 'object') e.host = e.host || url.hostname;
        throw e;
      }
      const delay = backoffDelayMs(attempt, o, o.random);
      o.log(`Binance ${url.hostname} network error (${e && (e.name || e.message)}); retry ${attempt + 1}/${o.maxRetries} in ${delay}ms`);
      await o.sleep(delay);
      continue;
    }
    if (timer) clearTimeout(timer);

    if (res.ok) return await res.json();

    const status = res.status;
    if (GEO_BLOCK_STATUSES.has(status)) {
      const err = new Error(`HTTP ${status} ${url.hostname}`);
      err.status = status; err.host = url.hostname; err.geoBlocked = true;
      throw err;
    }
    if (isRetryableStatus(status) && attempt < o.maxRetries) {
      const retryAfter = parseRetryAfterMs(getHeader(res, 'retry-after'));
      const delay = retryAfter != null ? Math.min(retryAfter, o.maxRetryAfterMs) : backoffDelayMs(attempt, o, o.random);
      o.log(`Binance ${url.hostname} HTTP ${status}; retry ${attempt + 1}/${o.maxRetries} in ${delay}ms${retryAfter != null ? ' (Retry-After)' : ''}`);
      await o.sleep(delay);
      continue;
    }
    const body = typeof res.text === 'function' ? await res.text().catch(() => '') : '';
    const err = new Error(`HTTP ${status} ${url.hostname} ${String(body).slice(0, 120)}`.trim());
    err.status = status; err.host = url.hostname;
    throw err;
  }
}

/**
 * @param {string|URL} url  full URL (host decides alternates)
 * @param {object} [opts]   fetch, sleep, headers, timeoutMs, maxRetries, baseDelayMs,
 *                          maxDelayMs, maxRetryAfterMs, publicMarketData (default true),
 *                          beforeAttempt (async hook, e.g. rate-limit gap), log, random
 */
async function requestJsonWithRetry(url, opts = {}) {
  const o = {
    ...DEFAULTS,
    ...opts,
    fetch: opts.fetch || globalThis.fetch,
    sleep: opts.sleep || defaultSleep,
    log: opts.log || (msg => console.log(msg)),
    random: opts.random || Math.random,
    publicMarketData: opts.publicMarketData !== false
  };
  if (typeof o.fetch !== 'function') throw new Error('requestJsonWithRetry: no fetch implementation');
  const original = new URL(String(url));
  const hosts = hostCandidates(original, o.publicMarketData);
  const tried = [];
  let lastGeo = null;
  for (const host of hosts) {
    const u = new URL(original.toString());
    u.hostname = host;
    tried.push(host);
    try {
      return await requestOneHost(u, o);
    } catch (e) {
      if (!e || !e.geoBlocked) throw e;
      lastGeo = e;
      if (tried.length < hosts.length) o.log(`Binance ${host} geo-blocked (HTTP ${e.status}); trying ${hosts[tried.length]}`);
    }
  }
  throw new BinanceGeoBlockedError(lastGeo.status, lastGeo.host, tried);
}

module.exports = {
  requestJsonWithRetry,
  BinanceGeoBlockedError,
  SPOT_HOST_CHAIN,
  parseRetryAfterMs,
  backoffDelayMs,
  isRetryableStatus
};
