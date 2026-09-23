'use strict';

/**
 * Frozen Turtle / Donchian Candidate #3 strategy pure functions.
 * READ-ONLY rules: 20 entry / 10 exit / 2N stop / long-only.
 * No optimization hooks.
 */

const config = require('./config');

/**
 * True Range series + Turtle N (Wilder-style recursive ATR).
 * @param {{h:number,l:number,c:number}[]} bars chronological
 * @returns {number[]} N aligned with bars (NaN until warm)
 */
function computeN(bars, period = config.ATR_PERIOD) {
  const n = bars.length;
  const tr = new Array(n);
  tr[0] = bars[0].h - bars[0].l;
  for (let i = 1; i < n; i++) {
    const prevC = bars[i - 1].c;
    tr[i] = Math.max(
      bars[i].h - bars[i].l,
      Math.abs(bars[i].h - prevC),
      Math.abs(bars[i].l - prevC)
    );
  }
  const N = new Array(n).fill(NaN);
  if (n < period) return N;
  let sum = 0;
  for (let i = 0; i < period; i++) sum += tr[i];
  N[period - 1] = sum / period;
  for (let i = period; i < n; i++) {
    N[i] = (N[i - 1] * (period - 1) + tr[i]) / period;
  }
  return N;
}

/**
 * Donchian upper from PRIOR bars only: max high of [i-period, i-1]
 */
function donchianUpper(bars, i, period = config.ENTRY_PERIOD) {
  if (i < period) return NaN;
  let m = -Infinity;
  for (let j = i - period; j < i; j++) m = Math.max(m, bars[j].h);
  return m;
}

/**
 * Donchian lower from PRIOR bars only: min low of [i-period, i-1]
 */
function donchianLower(bars, i, period = config.EXIT_PERIOD) {
  if (i < period) return NaN;
  let m = Infinity;
  for (let j = i - period; j < i; j++) m = Math.min(m, bars[j].l);
  return m;
}

/**
 * Evaluate signal at closed bar index i (bar i is fully known).
 * Entry is NOT taken on this bar — next open only.
 * @returns {null|{side:'LONG', donchianLevel:number, N:number, stopDistance:number}}
 */
function evaluateSignalAtClose(bars, i) {
  const need = Math.max(config.ENTRY_PERIOD, config.ATR_PERIOD) + 1;
  if (i < need || i >= bars.length) return null;
  const Nseries = computeN(bars.slice(0, i + 1));
  const N = Nseries[i];
  if (!Number.isFinite(N) || N <= 0) return null;
  const upper = donchianUpper(bars, i, config.ENTRY_PERIOD);
  if (!Number.isFinite(upper)) return null;
  if (bars[i].c > upper) {
    return {
      side: 'LONG',
      donchianLevel: upper,
      N,
      stopDistance: config.STOP_MULT * N,
    };
  }
  return null;
}

/**
 * Check exit on bar i for an open long.
 * Conservative same-candle: if stop and channel exit both possible → STOP.
 * @returns {null|{reason:'stop'|'donchian_exit', exitPriceHint:number, resolution?:string}}
 */
function evaluateExit(bars, i, entryPrice, stopPrice) {
  if (i < 0 || i >= bars.length) return null;
  const bar = bars[i];
  const lower = donchianLower(bars, i, config.EXIT_PERIOD);
  const hitStop = bar.l <= stopPrice;
  const hitExit = Number.isFinite(lower) && bar.c < lower;

  if (hitStop && hitExit) {
    return {
      reason: 'stop',
      exitPriceHint: stopPrice,
      resolution: config.SAME_CANDLE_CONFLICT,
    };
  }
  if (hitStop) {
    return { reason: 'stop', exitPriceHint: stopPrice };
  }
  if (hitExit) {
    return { reason: 'donchian_exit', exitPriceHint: bar.c };
  }
  return null;
}

module.exports = {
  computeN,
  donchianUpper,
  donchianLower,
  evaluateSignalAtClose,
  evaluateExit,
};
