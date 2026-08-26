import fs from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const DATA = path.join(ROOT, 'data');
const OUTPUT = path.join(ROOT, 'research', 'warmup_sensitivity_3m_comparison.json');
const WARMUPS = [500, 1000, 1500];

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

function round(value, digits = 5) {
  return Number(Number(value || 0).toFixed(digits));
}

function totals(report) {
  const aggregate = (period) => report.symbols.reduce((acc, item) => {
    const metric = item[period];
    acc.trades += metric.trades || 0;
    acc.wins += metric.wins || 0;
    acc.losses += metric.losses || 0;
    acc.netPct += metric.netPct || 0;
    return acc;
  }, { trades: 0, wins: 0, losses: 0, netPct: 0 });
  return {
    inSample: { ...aggregate('inSample'), netPct: round(aggregate('inSample').netPct) },
    outOfSample: { ...aggregate('outOfSample'), netPct: round(aggregate('outOfSample').netPct) },
    gate: report.gate
  };
}

function comparablePeriod(metric) {
  return {
    trades: metric.trades,
    wins: metric.wins,
    losses: metric.losses,
    netPct: metric.netPct,
    returns: metric.returns
  };
}

function compareReports(left, right, leftWarmup, rightWarmup) {
  const rightBySymbol = new Map(right.symbols.map(item => [item.symbol, item]));
  const fingerprintMismatches = [];
  const tradeMismatches = [];
  const gateMismatches = [];
  for (const current of left.symbols) {
    const other = rightBySymbol.get(current.symbol);
    if (!other) {
      fingerprintMismatches.push({ symbol: current.symbol, period: 'all', issue: 'missing-symbol' });
      continue;
    }
    for (const period of ['inSample', 'outOfSample']) {
      const leftFingerprint = current.decisionAudit?.[period]?.fingerprintSha256 || null;
      const rightFingerprint = other.decisionAudit?.[period]?.fingerprintSha256 || null;
      if (leftFingerprint !== rightFingerprint) {
        fingerprintMismatches.push({ symbol: current.symbol, period, [leftWarmup]: leftFingerprint, [rightWarmup]: rightFingerprint });
      }
      if (JSON.stringify(comparablePeriod(current[period])) !== JSON.stringify(comparablePeriod(other[period]))) {
        tradeMismatches.push({ symbol: current.symbol, period, [leftWarmup]: comparablePeriod(current[period]), [rightWarmup]: comparablePeriod(other[period]) });
      }
    }
    const leftGate = { status: current.gate?.status, reason: current.gate?.reason };
    const rightGate = { status: other.gate?.status, reason: other.gate?.reason };
    if (JSON.stringify(leftGate) !== JSON.stringify(rightGate)) gateMismatches.push({ symbol: current.symbol, [leftWarmup]: leftGate, [rightWarmup]: rightGate });
  }
  return {
    comparedWarmups: [leftWarmup, rightWarmup],
    fingerprintMismatches,
    tradeMismatches,
    gateMismatches,
    exactDecisionMatch: fingerprintMismatches.length === 0,
    exactTradeMatch: tradeMismatches.length === 0,
    exactGateMatch: gateMismatches.length === 0
  };
}

const reports = Object.fromEntries(WARMUPS.map(warmup => [warmup, readJson(path.join(DATA, `backtest_report_3m_sensitivity_w${warmup}.json`))]));
const result = {
  purpose: 'Descriptive warmup sensitivity comparison on frozen three-month data.',
  generatedAt: new Date().toISOString(),
  warmups: Object.fromEntries(WARMUPS.map(warmup => [warmup, totals(reports[warmup])])),
  comparisons: {
    '500_vs_1000': compareReports(reports[500], reports[1000], 500, 1000),
    '1000_vs_1500': compareReports(reports[1000], reports[1500], 1000, 1500)
  }
};

fs.mkdirSync(path.dirname(OUTPUT), { recursive: true });
fs.writeFileSync(OUTPUT, JSON.stringify(result, null, 2) + '\n');
console.log(OUTPUT);
console.log(JSON.stringify({
  totals: result.warmups,
  stability1000vs1500: {
    exactDecisionMatch: result.comparisons['1000_vs_1500'].exactDecisionMatch,
    exactTradeMatch: result.comparisons['1000_vs_1500'].exactTradeMatch,
    exactGateMatch: result.comparisons['1000_vs_1500'].exactGateMatch,
    fingerprintMismatchCount: result.comparisons['1000_vs_1500'].fingerprintMismatches.length
  }
}, null, 2));
