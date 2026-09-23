'use strict';

const config = require('./config');

/**
 * Apply entry fill at next open with slippage (long buys up).
 */
function entryFill(openPrice) {
  const slip = config.SLIPPAGE_PER_SIDE;
  const price = openPrice * (1 + slip);
  return { price, slippage_pct: slip };
}

/**
 * Apply exit fill: stop uses stop price; channel exit uses close, both worsen for long.
 */
function exitFill(hintPrice, reason) {
  const slip = config.SLIPPAGE_PER_SIDE;
  // Long exit: sell → price after negative slip
  const price = hintPrice * (1 - slip);
  return { price, slippage_pct: slip, reason };
}

/**
 * Fees on notional each side (fraction of capital allocated).
 */
function feeFraction() {
  return config.FEE_PER_SIDE;
}

/**
 * Net return fraction for a long trade given entry/exit fill prices.
 * Fees charged both sides as fraction of entry notional approximation:
 *   gross = (exit - entry) / entry
 *   net = gross - 2 * fee
 */
function netReturnLong(entryPrice, exitPrice) {
  const gross = (exitPrice - entryPrice) / entryPrice;
  const fees = 2 * feeFraction();
  return { gross, fees, net: gross - fees };
}

/**
 * Position size: equal sleeve of current equity (all-in that sleeve).
 */
function sleeveNotional(equity) {
  return equity * config.SLEEVE_FRACTION;
}

module.exports = {
  entryFill,
  exitFill,
  feeFraction,
  netReturnLong,
  sleeveNotional,
};
