/**
 * Research-only diagnostic analysis for MaYor Cloud Pro.
 * Design rule: candidate entry filters are selected exclusively from IS rows;
 * only the single preselected rule is then evaluated on the frozen OOS rows.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const INPUT = process.env.DIAGNOSTIC_REPORT || path.join(ROOT, 'data', 'backtest_report_1y_is_oos_diagnostics.json');
const OUTPUT = process.env.DIAGNOSTIC_ANALYSIS_OUTPUT || path.join(ROOT, 'research', 'trade_diagnostics_1y_analysis.json');
const MIN_IS_TRADES_FOR_CANDIDATE = 20;
const CANDIDATE_FEATURES = ['adx', 'atrPct', 'volumeRatio', 'takerFlow', 'alignedEmaSpreadPct', 'alignedMacdHistPct'];

function finite(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function round(value, digits = 6) {
  return Number.isFinite(value) ? Number(value.toFixed(digits)) : null;
}

function sum(values) { return values.reduce((total, value) => total + value, 0); }
function mean(values) { return values.length ? sum(values) / values.length : null; }
function quantile(values, q) {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const position = (sorted.length - 1) * q;
  const lo = Math.floor(position), hi = Math.ceil(position);
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (position - lo);
}

function metrics(rows) {
  const returns = rows.map(row => row.netPct).filter(Number.isFinite);
  const wins = returns.filter(value => value > 0);
  const losses = returns.filter(value => value < 0);
  const grossWin = sum(wins), grossLoss = Math.abs(sum(losses));
  let equity = 0, peak = 0, maxDrawdown = 0;
  for (const value of returns) {
    equity += value;
    peak = Math.max(peak, equity);
    maxDrawdown = Math.max(maxDrawdown, peak - equity);
  }
  return {
    trades: returns.length,
    wins: wins.length,
    losses: losses.length,
    winRatePct: round(returns.length ? wins.length / returns.length * 100 : 0),
    netPct: round(sum(returns)),
    avgNetPct: round(mean(returns)),
    medianNetPct: round(quantile(returns, 0.5)),
    profitFactor: round(grossLoss ? grossWin / grossLoss : (wins.length ? Infinity : 0)),
    maxDrawdownPct: round(maxDrawdown)
  };
}

function withDerivedFeatures(row) {
  const feature = row.entryFeatures || {};
  const sign = row.dir === 'LONG' ? 1 : -1;
  return {
    symbol: String(row.symbol || ''),
    dir: String(row.dir || ''),
    result: String(row.result || ''),
    entryTime: finite(row.entryTime),
    exitTime: finite(row.exitTime),
    holdingMs: finite(row.holdingMs),
    netPct: finite(row.netPct),
    rr: finite(row.rr),
    mtfPct: finite(row.mtfPct),
    corePct: finite(row.corePct),
    adx: finite(feature.adx),
    atrPct: finite(feature.atrPct),
    volumeRatio: finite(feature.volumeRatio),
    takerFlow: finite(feature.takerFlow),
    alignedEmaSpreadPct: finite(feature.emaSpreadPct) === null ? null : finite(feature.emaSpreadPct) * sign,
    alignedMacdHistPct: finite(feature.macdHistPct) === null ? null : finite(feature.macdHistPct) * sign,
    rsi: finite(feature.rsi),
    stochRsi: finite(feature.stochRsi),
    structure: finite(feature.structure),
    obImbalance: finite(feature.obImbalance)
  };
}

function byGroup(rows, key, minimum = 1) {
  const groups = new Map();
  for (const row of rows) {
    const value = key(row);
    if (value === null || value === undefined || value === '') continue;
    if (!groups.has(value)) groups.set(value, []);
    groups.get(value).push(row);
  }
  return [...groups.entries()]
    .map(([value, items]) => ({ value, ...metrics(items) }))
    .filter(item => item.trades >= minimum)
    .sort((a, b) => b.netPct - a.netPct || b.trades - a.trades);
}

function featureContrast(rows, feature) {
  const usable = rows.filter(row => Number.isFinite(row[feature]) && Number.isFinite(row.netPct));
  const wins = usable.filter(row => row.netPct > 0).map(row => row[feature]);
  const losses = usable.filter(row => row.netPct < 0).map(row => row[feature]);
  return {
    feature,
    observations: usable.length,
    winningTrades: wins.length,
    losingTrades: losses.length,
    winMean: round(mean(wins)),
    lossMean: round(mean(losses)),
    winMedian: round(quantile(wins, 0.5)),
    lossMedian: round(quantile(losses, 0.5)),
    meanDifferenceWinMinusLoss: round((mean(wins) ?? 0) - (mean(losses) ?? 0))
  };
}

function selectCandidateFromIs(isRows) {
  const baseline = metrics(isRows);
  const candidates = [];
  for (const feature of CANDIDATE_FEATURES) {
    const usable = isRows.filter(row => Number.isFinite(row[feature]));
    const threshold = quantile(usable.map(row => row[feature]), 0.5);
    if (!Number.isFinite(threshold)) continue;
    for (const operator of ['gte', 'lt']) {
      const selected = usable.filter(row => operator === 'gte' ? row[feature] >= threshold : row[feature] < threshold);
      const summary = metrics(selected);
      const eligible = summary.trades >= MIN_IS_TRADES_FOR_CANDIDATE
        && summary.netPct > 0
        && summary.avgNetPct > baseline.avgNetPct;
      candidates.push({
        feature,
        operator,
        threshold: round(threshold),
        selectionSample: summary,
        eligible,
        isScore: round((summary.avgNetPct ?? -Infinity) * Math.sqrt(summary.trades || 0))
      });
    }
  }
  const ranked = candidates.sort((a, b) => Number(b.eligible) - Number(a.eligible) || b.isScore - a.isScore || b.selectionSample.trades - a.selectionSample.trades);
  return { baseline, ranked, selected: ranked.find(candidate => candidate.eligible) || null };
}

function applyCandidate(rows, candidate) {
  if (!candidate) return [];
  return rows.filter(row => Number.isFinite(row[candidate.feature]) && (candidate.operator === 'gte'
    ? row[candidate.feature] >= candidate.threshold
    : row[candidate.feature] < candidate.threshold));
}

function main() {
  const report = JSON.parse(fs.readFileSync(INPUT, 'utf8'));
  const isRows = report.symbols.flatMap(symbol => symbol.inSample?.tradeDiagnostics || []).map(withDerivedFeatures);
  const oosRows = report.symbols.flatMap(symbol => symbol.outOfSample?.tradeDiagnostics || []).map(withDerivedFeatures);
  if (!isRows.length || !oosRows.length) throw new Error('diagnostic-trades-missing-for-is-or-oos');

  const selectedFromIs = selectCandidateFromIs(isRows);
  const holdoutRows = applyCandidate(oosRows, selectedFromIs.selected);
  const output = {
    generatedAt: new Date().toISOString(),
    researchOnly: true,
    source: path.resolve(INPUT),
    methodology: {
      causalClaim: 'Observational descriptive analysis only; associations are not proof of causation.',
      selectionDiscipline: 'The entry-filter candidate is selected from IS only. OOS is evaluated exactly once for the selected candidate.',
      candidateFeatures: CANDIDATE_FEATURES,
      thresholdRule: 'IS median per feature; retain either side only when it has >=20 IS trades, positive IS net result, and IS average return above the full IS baseline.',
      oosSuccessCriterion: 'Selected rule must retain at least 10 OOS trades and improve OOS netPct versus the frozen baseline; no live or production use follows from this test alone.'
    },
    samples: { inSample: metrics(isRows), outOfSample: metrics(oosRows) },
    oosObservedPatterns: {
      byExitResult: byGroup(oosRows, row => row.result),
      byDirection: byGroup(oosRows, row => row.dir),
      bySymbolAtLeastTwoTrades: byGroup(oosRows, row => row.symbol, 2),
      byEntryMonth: byGroup(oosRows, row => row.entryTime ? new Date(row.entryTime).toISOString().slice(0, 7) : null),
      featureContrastsWinVsLoss: [...new Set([...CANDIDATE_FEATURES, 'rsi', 'stochRsi', 'structure'])].map(feature => featureContrast(oosRows, feature))
    },
    isOnlyCandidateSelection: {
      fullIsBaseline: selectedFromIs.baseline,
      rankedCandidates: selectedFromIs.ranked,
      selectedRule: selectedFromIs.selected
    },
    selectedRuleSingleOosEvaluation: selectedFromIs.selected ? {
      rule: selectedFromIs.selected,
      frozenOosBaseline: metrics(oosRows),
      filteredOos: metrics(holdoutRows),
      oosNetImprovementPct: round((metrics(holdoutRows).netPct ?? 0) - (metrics(oosRows).netPct ?? 0)),
      oosCriteriaPassed: holdoutRows.length >= 10 && metrics(holdoutRows).netPct > metrics(oosRows).netPct
    } : null
  };
  fs.writeFileSync(OUTPUT, JSON.stringify(output, null, 2));
  console.log(JSON.stringify({ output: OUTPUT, selectedRule: output.isOnlyCandidateSelection.selectedRule, selectedRuleSingleOosEvaluation: output.selectedRuleSingleOosEvaluation }, null, 2));
}

main();
