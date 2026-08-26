import fs from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const BASELINE = '/home/ubuntu/mayor_backtest_expanded_3m_baseline.json';
const REGRESSION = path.join(ROOT, 'data', 'backtest_report_3m_regression_w1500.json');
const OUTPUT = path.join(ROOT, 'research', 'warmup_regression_3m_result.json');
const EXPECTED = { inSampleTrades: 9, outOfSampleTrades: 39, outOfSampleNetPct: -15.19294 };

function read(file) { return JSON.parse(fs.readFileSync(file, 'utf8')); }
function aggregate(report, period) {
  return report.symbols.reduce((total, symbol) => ({
    trades: total.trades + (symbol[period]?.trades || 0),
    wins: total.wins + (symbol[period]?.wins || 0),
    losses: total.losses + (symbol[period]?.losses || 0),
    netPct: Number((total.netPct + (symbol[period]?.netPct || 0)).toFixed(5))
  }), { trades: 0, wins: 0, losses: 0, netPct: 0 });
}
function comparable(period) {
  return {
    trades: period?.trades || 0,
    wins: period?.wins || 0,
    losses: period?.losses || 0,
    netPct: period?.netPct || 0,
    returns: period?.returns || []
  };
}

const baseline = read(BASELINE);
const regression = read(REGRESSION);
const baselineBySymbol = new Map(baseline.symbols.map(symbol => [symbol.symbol, symbol]));
const symbolMismatches = [];
for (const current of regression.symbols) {
  const reference = baselineBySymbol.get(current.symbol);
  if (!reference) {
    symbolMismatches.push({ symbol: current.symbol, issue: 'missing-in-reference' });
    continue;
  }
  for (const period of ['inSample', 'outOfSample']) {
    if (JSON.stringify(comparable(current[period])) !== JSON.stringify(comparable(reference[period]))) {
      symbolMismatches.push({
        symbol: current.symbol,
        period,
        reference: comparable(reference[period]),
        regression: comparable(current[period])
      });
    }
  }
}

const baselineTotals = { inSample: aggregate(baseline, 'inSample'), outOfSample: aggregate(baseline, 'outOfSample') };
const regressionTotals = { inSample: aggregate(regression, 'inSample'), outOfSample: aggregate(regression, 'outOfSample') };
const expectedMatch = regressionTotals.inSample.trades === EXPECTED.inSampleTrades
  && regressionTotals.outOfSample.trades === EXPECTED.outOfSampleTrades
  && regressionTotals.outOfSample.netPct === EXPECTED.outOfSampleNetPct;
const result = {
  purpose: 'Literal three-month regression comparison after warmup-window optimization.',
  referenceFile: BASELINE,
  regressionFile: REGRESSION,
  expectedReference: EXPECTED,
  baselineTotals,
  regressionTotals,
  expectedMatch,
  perSymbolTradeAndReturnMatch: symbolMismatches.length === 0,
  symbolMismatches,
  generatedAt: new Date().toISOString()
};
fs.mkdirSync(path.dirname(OUTPUT), { recursive: true });
fs.writeFileSync(OUTPUT, JSON.stringify(result, null, 2) + '\n');
console.log(OUTPUT);
console.log(JSON.stringify({ expectedMatch, perSymbolTradeAndReturnMatch: result.perSymbolTradeAndReturnMatch, baselineTotals, regressionTotals, mismatchCount: symbolMismatches.length }, null, 2));
