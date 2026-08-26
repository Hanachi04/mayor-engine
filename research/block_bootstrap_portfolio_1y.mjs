import fs from 'node:fs/promises';
import path from 'node:path';

const ROOT = '/home/ubuntu/mayor-history-1y-expansion';
const INPUT_PATH = path.join(ROOT, 'research', 'portfolio_daily_returns_output_1y_calendar365.json');
const OUTPUT_PATH = path.join(ROOT, 'research', 'block_bootstrap_output_1y.json');
const BLOCK_LENGTHS = [5, 14, 21];
const ITERATIONS = 5000;
const SEED = 20260824;
const EXPECTED_CALENDAR_DAYS = 365;
const EXPECTED_OBSERVED_NET_PCT = -9.50841;
const TOLERANCE_PCT = 1e-8;

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function createMulberry32(seed) {
  let state = seed >>> 0;
  return () => {
    state += 0x6D2B79F5;
    let value = state;
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  };
}

function mean(values) {
  return values.reduce((total, value) => total + value, 0) / values.length;
}

function populationStd(values, average) {
  const variance = values.reduce((total, value) => total + ((value - average) ** 2), 0) / values.length;
  return Math.sqrt(variance);
}

function round(value) {
  return Number(value.toFixed(12));
}

function sampleMovingBlocks(dailyNetPcts, blockLength, rng) {
  const targetLength = dailyNetPcts.length;
  const lastStartIndex = targetLength - blockLength;
  const resampledDailyReturns = [];

  while (resampledDailyReturns.length < targetLength) {
    const startIndex = Math.floor(rng() * (lastStartIndex + 1));
    const block = dailyNetPcts.slice(startIndex, startIndex + blockLength);
    const remaining = targetLength - resampledDailyReturns.length;
    resampledDailyReturns.push(...block.slice(0, remaining));
  }

  return resampledDailyReturns;
}

function runMovingBlockBootstrap(dailyNetPcts, observedNetPct, blockLength) {
  assert(blockLength <= dailyNetPcts.length, `blockLength ${blockLength} exceeds daily return count ${dailyNetPcts.length}`);

  const rng = createMulberry32(SEED);
  const distribution = [];
  for (let iteration = 0; iteration < ITERATIONS; iteration += 1) {
    const resampledDailyReturns = sampleMovingBlocks(dailyNetPcts, blockLength, rng);
    distribution.push(resampledDailyReturns.reduce((total, value) => total + value, 0));
  }

  const distributionMean = mean(distribution);
  const distributionStd = populationStd(distribution, distributionMean);
  const zScore = distributionStd === 0 ? null : (observedNetPct - distributionMean) / distributionStd;
  const observedAtOrAboveCount = distribution.filter((netPct) => netPct >= observedNetPct).length;

  return {
    blockLength,
    availableBlockStartPositions: dailyNetPcts.length - blockLength + 1,
    iterations: ITERATIONS,
    seed: SEED,
    distributionMean: round(distributionMean),
    distributionStd: round(distributionStd),
    observedNetPct: round(observedNetPct),
    zScore: zScore === null ? null : round(zScore),
    observedAtOrAbovePct: round((observedAtOrAboveCount / ITERATIONS) * 100),
  };
}

const input = JSON.parse(await fs.readFile(INPUT_PATH, 'utf8'));
const dailyReturns = input?.dailyReturns;
assert(Array.isArray(dailyReturns) && dailyReturns.length === EXPECTED_CALENDAR_DAYS, `expected ${EXPECTED_CALENDAR_DAYS} daily returns`);
assert(input?.calendarWindowUtc?.calendarDays === EXPECTED_CALENDAR_DAYS, 'input calendar length mismatch');
assert(input?.sumCheck?.withinTolerance === true, 'input daily return sum has not passed integrity verification');

const dailyNetPcts = dailyReturns.map((day, index) => {
  assert(typeof day?.date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(day.date), `invalid date at dailyReturns[${index}]`);
  assert(Number.isFinite(day?.netPct), `invalid netPct at dailyReturns[${index}]`);
  assert(Number.isInteger(day?.tradeCount) && day.tradeCount >= 0, `invalid tradeCount at dailyReturns[${index}]`);
  return day.netPct;
});

const observedNetPct = input.sumCheck.observedSumNetPct;
const reconstructedObservedNetPct = dailyNetPcts.reduce((total, netPct) => total + netPct, 0);
assert(Number.isFinite(observedNetPct), 'observedSumNetPct not found in input');
assert(Math.abs(reconstructedObservedNetPct - observedNetPct) <= TOLERANCE_PCT, `daily return integrity mismatch: input ${observedNetPct}, reconstructed ${reconstructedObservedNetPct}`);
assert(Math.abs(observedNetPct - EXPECTED_OBSERVED_NET_PCT) <= TOLERANCE_PCT, `expected observed net ${EXPECTED_OBSERVED_NET_PCT}, found ${observedNetPct}`);

const output = {
  inputPath: INPUT_PATH,
  inputWindow: input.calendarWindowUtc,
  methodology: {
    method: 'moving-block-bootstrap',
    blockLengths: BLOCK_LENGTHS,
    iterations: ITERATIONS,
    seed: SEED,
    statistic: 'arithmetic sum of daily netPct across a resampled 365-day calendar series',
  },
  results: BLOCK_LENGTHS.map((blockLength) => runMovingBlockBootstrap(dailyNetPcts, observedNetPct, blockLength)),
};

await fs.writeFile(OUTPUT_PATH, `${JSON.stringify(output, null, 2)}\n`, 'utf8');
console.log(`Wrote ${OUTPUT_PATH}`);
