'use strict';

class LookaheadViolationError extends Error {
  constructor(candle, asOf) {
    super(`Lookahead violation: candle closeTime ${candle?.closeTime} is not before asOf ${asOf}`);
    this.name = 'LookaheadViolationError';
    this.candle = candle;
    this.asOf = asOf;
  }
}

let successfulChecks = 0;

function asEpoch(value) {
  if (value instanceof Date) return value.getTime();
  const n = Number(value);
  return Number.isFinite(n) ? n : NaN;
}

function assertNoLookahead(candles, asOf) {
  const reference = asEpoch(asOf);
  if (!Number.isFinite(reference)) throw new TypeError('asOf must be an explicit finite timestamp');
  if (!Array.isArray(candles)) throw new TypeError('candles must be an array');
  for (const candle of candles) {
    const closeTime = asEpoch(candle?.closeTime);
    if (!Number.isFinite(closeTime) || closeTime >= reference) {
      throw new LookaheadViolationError(candle, reference);
    }
  }
  successfulChecks += 1;
  return true;
}

function sliceWindowUntil(candles, asOf, warmup = 1500) {
  const reference = asEpoch(asOf);
  if (!Number.isFinite(reference)) throw new TypeError('asOf must be an explicit finite timestamp');
  if (!Array.isArray(candles)) throw new TypeError('candles must be an array');
  let lo = 0;
  let hi = candles.length;
  while (lo < hi) {
    const mid = Math.floor((lo + hi) / 2);
    if (asEpoch(candles[mid]?.closeTime) < reference) lo = mid + 1;
    else hi = mid;
  }
  const start = Math.max(0, lo - Math.max(0, Number(warmup) || 0));
  const window = candles.slice(start, lo);
  assertNoLookahead(window, reference);
  return window;
}

function wrapDataSource(fetchFn) {
  if (typeof fetchFn !== 'function') throw new TypeError('fetchFn must be a function');
  return async function wrappedDataSource(params, asOf) {
    if (arguments.length < 2 || asOf === undefined || asOf === null) {
      throw new TypeError('wrapped data source requires an explicit asOf');
    }
    const result = await fetchFn(params, asOf);
    return result;
  };
}

function getSuccessfulCheckCount() { return successfulChecks; }
function resetAudit() { successfulChecks = 0; }

module.exports = {
  LookaheadViolationError,
  assertNoLookahead,
  sliceWindowUntil,
  wrapDataSource,
  getSuccessfulCheckCount,
  resetAudit
};
