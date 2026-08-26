import fs from 'node:fs/promises';
import path from 'node:path';

const ROOT = '/home/ubuntu/mayor-history-1y-expansion';
const REPORT_PATH = path.join(ROOT, 'data', 'backtest_report_1y_full_baseline_with_trades.json');
const OUTPUT_PATH = path.join(ROOT, 'research', 'portfolio_daily_returns_output_1y_calendar365.json');
const CALENDAR_START_DATE = '2025-08-23';
const CALENDAR_END_DATE = '2026-08-22';
const EXPECTED_CALENDAR_DAYS = 365;
const EXPECTED_OOS_TRADES = 73;
const EXPECTED_OOS_NET_PCT = -9.50841;
const TOLERANCE_PCT = 1e-8;

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function isFiniteNumber(value) {
  return Number.isFinite(value);
}

function utcDateFromMs(timestamp) {
  assert(isFiniteNumber(timestamp), `invalid timestamp: ${timestamp}`);
  return new Date(timestamp).toISOString().slice(0, 10);
}

function datesInclusive(startDate, endDate) {
  const dates = [];
  const cursor = new Date(`${startDate}T00:00:00.000Z`);
  const last = new Date(`${endDate}T00:00:00.000Z`);
  while (cursor <= last) {
    dates.push(cursor.toISOString().slice(0, 10));
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }
  return dates;
}

function exactTradeShape(trade) {
  return trade && typeof trade === 'object'
    && JSON.stringify(Object.keys(trade).sort()) === JSON.stringify(['entryTime', 'exitTime', 'netPct', 'symbol']);
}

const report = JSON.parse(await fs.readFile(REPORT_PATH, 'utf8'));
assert(Array.isArray(report?.symbols) && report.symbols.length === 35, 'expected 35 symbol reports');

const referencePeriod = report.symbols[0]?.period;
assert(referencePeriod && isFiniteNumber(referencePeriod.start) && isFiniteNumber(referencePeriod.split) && isFiniteNumber(referencePeriod.end), 'reference period missing');
const { start, split, end } = referencePeriod;

for (const symbolReport of report.symbols) {
  const period = symbolReport?.period;
  assert(period?.start === start && period?.split === split && period?.end === end, `inconsistent period for ${symbolReport?.symbol}`);
  assert(Array.isArray(symbolReport?.outOfSample?.tradesDetailed), `tradesDetailed missing for ${symbolReport?.symbol}`);
}

const oosStartDate = utcDateFromMs(split + 1);
const oosEndDate = utcDateFromMs(end);
assert(utcDateFromMs(start) === CALENDAR_START_DATE, `unexpected full-calendar start: ${utcDateFromMs(start)}`);
assert(utcDateFromMs(end) === CALENDAR_END_DATE, `unexpected full-calendar end: ${utcDateFromMs(end)}`);
const calendarDates = datesInclusive(CALENDAR_START_DATE, CALENDAR_END_DATE);
assert(calendarDates.length === EXPECTED_CALENDAR_DAYS, `expected ${EXPECTED_CALENDAR_DAYS} calendar days, found ${calendarDates.length}`);

const dailyMap = new Map(calendarDates.map((date) => [date, { netPct: 0, tradeCount: 0 }]));
const detailedTrades = [];
const expectedOosNetPct = report.symbols.reduce((total, symbolReport) => total + symbolReport.outOfSample.netPct, 0);
const expectedOosTrades = report.symbols.reduce((total, symbolReport) => total + symbolReport.outOfSample.trades, 0);
assert(expectedOosTrades === EXPECTED_OOS_TRADES, `expected ${EXPECTED_OOS_TRADES} OOS trades, found ${expectedOosTrades}`);
assert(Math.abs(expectedOosNetPct - EXPECTED_OOS_NET_PCT) <= TOLERANCE_PCT, `expected OOS net ${EXPECTED_OOS_NET_PCT}, found ${expectedOosNetPct}`);

for (const symbolReport of report.symbols) {
  for (const trade of symbolReport.outOfSample.tradesDetailed) {
    assert(exactTradeShape(trade), `unexpected trade shape for ${symbolReport.symbol}`);
    assert(trade.symbol === symbolReport.symbol, `trade symbol mismatch for ${symbolReport.symbol}`);
    assert(isFiniteNumber(trade.entryTime) && isFiniteNumber(trade.exitTime) && isFiniteNumber(trade.netPct), `invalid detailed trade for ${symbolReport.symbol}`);
    assert(trade.entryTime <= trade.exitTime, `entry after exit for ${symbolReport.symbol}`);
    assert(trade.exitTime > split && trade.exitTime <= end, `exitTime outside OOS for ${symbolReport.symbol}`);

    const exitDate = utcDateFromMs(trade.exitTime);
    const daily = dailyMap.get(exitDate);
    assert(daily, `exitTime outside OOS calendar: ${symbolReport.symbol} ${exitDate}`);
    daily.netPct += trade.netPct;
    daily.tradeCount += 1;
    detailedTrades.push(trade);
  }
}

assert(detailedTrades.length === expectedOosTrades, `detailed trade count ${detailedTrades.length} differs from metric ${expectedOosTrades}`);

const detailedNetPct = detailedTrades.reduce((total, trade) => total + trade.netPct, 0);
assert(Math.abs(detailedNetPct - expectedOosNetPct) <= TOLERANCE_PCT, `detailed sum mismatch: ${detailedNetPct} vs ${expectedOosNetPct}`);

const dailyReturns = [...dailyMap.entries()].map(([date, value]) => ({
  date,
  netPct: Number(value.netPct.toFixed(10)),
  tradeCount: value.tradeCount,
}));
const observedSumNetPct = dailyReturns.reduce((total, day) => total + day.netPct, 0);
const differencePct = observedSumNetPct - expectedOosNetPct;
const withinTolerance = Math.abs(differencePct) <= TOLERANCE_PCT;
assert(withinTolerance, `daily return sum mismatch: expected ${expectedOosNetPct}, observed ${observedSumNetPct}, difference ${differencePct}`);

const output = {
  source: {
    reportPath: REPORT_PATH,
    reportGeneratedAt: report.generatedAt,
    exportFlag: 'BACKTEST_EXPORT_TRADES=1',
  },
  calendarWindowUtc: {
    startInclusiveMs: start,
    endInclusiveMs: end,
    startDate: CALENDAR_START_DATE,
    endDate: CALENDAR_END_DATE,
    calendarDays: dailyReturns.length,
  },
  oosWindowUtc: {
    splitExclusiveMs: split,
    endInclusiveMs: end,
    startDate: oosStartDate,
    endDate: oosEndDate,
    calendarDays: dailyReturns.length,
  },
  totalOosTrades: detailedTrades.length,
  dailyReturns,
  sumCheck: {
    expectedOosNetPct: Number(expectedOosNetPct.toFixed(10)),
    detailedTradesNetPct: Number(detailedNetPct.toFixed(10)),
    observedSumNetPct: Number(observedSumNetPct.toFixed(10)),
    differencePct: Number(differencePct.toFixed(10)),
    tolerancePct: TOLERANCE_PCT,
    withinTolerance,
  },
  calendarCheck: {
    expectedCalendarDays: EXPECTED_CALENDAR_DAYS,
    zeroTradeDays: dailyReturns.filter((day) => day.tradeCount === 0).length,
    nonZeroTradeDays: dailyReturns.filter((day) => day.tradeCount > 0).length,
  },
};

await fs.writeFile(OUTPUT_PATH, `${JSON.stringify(output, null, 2)}\n`, 'utf8');
console.log(`Wrote ${OUTPUT_PATH}`);
