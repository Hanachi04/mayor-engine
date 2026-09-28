'use strict';

/**
 * Write a small committed snapshot for forward-test visibility.
 * Does not change strategy rules.
 */

const fs = require('fs');
const path = require('path');
const config = require('./config');
const journal = require('./journal');
const metrics = require('./metrics');

function main() {
  const state = journal.loadState();
  const closed = journal.closedTrades();
  const sum = metrics.summarizeClosed(closed);
  const bySym = metrics.bySymbol(closed);
  const open = Object.keys(state.open_positions || {});
  const pending = Object.keys(state.pending_signals || {});

  const report = {
    generatedAt: new Date().toISOString(),
    engine: config.ENGINE_ID,
    strategy_version: config.STRATEGY_VERSION,
    mode: process.env.ENGINE4_MODE || config.MODE,
    equity: state.equity,
    peak_equity: state.peak_equity,
    max_drawdown: state.max_drawdown,
    initial_capital: config.INITIAL_CAPITAL,
    total_pnl: state.equity - config.INITIAL_CAPITAL,
    open_symbols: open,
    pending_symbols: pending,
    paused: Boolean(state.paused),
    pause_reason: state.pause_reason || null,
    metrics: sum,
    by_symbol: bySym,
    signals_total: journal.allSignals().length,
    trades_total: journal.allTrades().length,
    closed_total: closed.length,
  };

  const outDir = path.join(__dirname, '..', '..', 'data', 'reports');
  fs.mkdirSync(outDir, { recursive: true });
  const outPath = path.join(outDir, 'engine4_forward_status.json');
  fs.writeFileSync(outPath, JSON.stringify(report, null, 2) + '\n', 'utf8');
  console.log('[engine4:status]', outPath);
  console.log(JSON.stringify({
    equity: report.equity,
    closed: report.closed_total,
    open: report.open_symbols,
    pnl: report.total_pnl,
  }));
  return report;
}

if (require.main === module) {
  main();
}

module.exports = { main };
