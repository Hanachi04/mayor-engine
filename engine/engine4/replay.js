'use strict';

/**
 * Historical replay for Engine #4 correctness (not strategy validation).
 * Loads JSON bars from forward-test/candles or stdin path.
 */

const fs = require('fs');
const path = require('path');
const config = require('./config');
const data = require('./data');
const worker = require('./worker');
const journal = require('./journal');
const metrics = require('./metrics');

function loadFromJsonFile(filePath) {
  const raw = JSON.parse(fs.readFileSync(filePath, 'utf8'));
  // Accept array of [ot,o,h,l,c,v] or objects
  return data.loadBarsFromArray(
    raw.map((r) =>
      Array.isArray(r)
        ? { ot: r[0], o: r[1], h: r[2], l: r[3], c: r[4], v: r[5] || 0, data_source: 'replay_file' }
        : { ...r, data_source: r.data_source || 'replay_file' }
    )
  );
}

async function main() {
  const args = process.argv.slice(2);
  const dataDir = args[0] || path.join(config.PATHS.candles);
  const barsBySymbol = {};

  for (const sym of config.SYMBOLS) {
    const jsonPath = path.join(dataDir, `${sym}_1d.json`);
    const jsonlPath = path.join(dataDir, `${sym}.jsonl`);
    if (fs.existsSync(jsonPath)) {
      barsBySymbol[sym] = loadFromJsonFile(jsonPath);
      data.persistBars(sym, barsBySymbol[sym]);
    } else if (fs.existsSync(jsonlPath)) {
      barsBySymbol[sym] = data.loadBars(sym);
    } else {
      barsBySymbol[sym] = [];
    }
    console.log(`[replay] ${sym}: ${barsBySymbol[sym].length} bars`);
  }

  // Wipe engine4 state/journals for deterministic replay test only when ENGINE4_FRESH=1
  if (process.env.ENGINE4_FRESH === '1') {
    const { execSync } = require('child_process');
    for (const sub of ['signals', 'trades', 'equity', 'state', 'audit']) {
      const dir = config.PATHS[sub];
      if (fs.existsSync(dir)) {
        for (const f of fs.readdirSync(dir)) {
          fs.unlinkSync(path.join(dir, f));
        }
      }
    }
    journal.ensureDirs();
  }

  const state = await worker.runReplay(barsBySymbol, {
    fresh: process.env.ENGINE4_FRESH === '1',
    notify: process.env.ENGINE4_NOTIFY === '1',
  });

  const closed = journal.closedTrades();
  const sum = metrics.summarizeClosed(closed);
  console.log('[replay] equity', state.equity.toFixed(2));
  console.log('[replay] max_dd', (state.max_drawdown * 100).toFixed(2) + '%');
  console.log('[replay] closed trades', sum.trades, 'WR', sum.win_rate.toFixed(1) + '%', 'PF', sum.profit_factor.toFixed(2));
  console.log('[replay] net_pnl', sum.net_pnl.toFixed(2));
}

if (require.main === module) {
  main().catch((e) => {
    console.error(e);
    process.exit(1);
  });
}

module.exports = { loadFromJsonFile, main };
