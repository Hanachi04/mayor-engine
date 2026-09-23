'use strict';

/**
 * FORWARD_PAPER mode: sync public OHLCV, process new closed candles, persist, notify.
 */

const config = require('./config');
const data = require('./data');
const journal = require('./journal');
const worker = require('./worker');
const notifications = require('./notifications');

async function runOnce() {
  journal.ensureDirs();
  let state = journal.loadState();
  journal.audit('SYSTEM_RESTART', { mode: 'FORWARD_PAPER', equity: state.equity });

  const barsBySymbol = {};
  for (const symbol of config.SYMBOLS) {
    try {
      const bars = await data.syncSymbol(symbol);
      barsBySymbol[symbol] = bars;
      console.log(`[forward] ${symbol}: ${bars.length} closed bars`);
    } catch (err) {
      console.error(`[forward] data error ${symbol}:`, err.message);
      state.paused = true;
      state.pause_reason = `DATA_ERROR:${symbol}:${err.message}`;
      journal.audit('DATA_ERROR', { symbol, error: String(err.message) });
      await notifications.notifyDataIssue(symbol, String(err.message), state);
    }
  }

  if (!state.paused) {
    for (const symbol of config.SYMBOLS) {
      state = await worker.processSymbol(symbol, barsBySymbol[symbol] || [], state, { notify: true });
    }
  }

  journal.saveState(state);
  const report = worker.buildDailyReport(state);
  await notifications.notifyDaily(report, state);
  journal.saveState(state);

  console.log('[forward] equity', state.equity.toFixed(2), 'open', Object.keys(state.open_positions).length);
  return state;
}

if (require.main === module) {
  runOnce().catch((e) => {
    console.error(e);
    process.exit(1);
  });
}

module.exports = { runOnce };
