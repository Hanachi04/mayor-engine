/**
 * تجميع بيانات تاريخية قابلة لإعادة الإنتاج لباكتيست MaYor.
 * بحثي فقط: لا يرسل Telegram ولا يلمس scan.js أو عتبات الاستراتيجية.
 * يعيد استخدام fetchHistorical المرقم، ويحفظ الجلب في مسار مرحلي ثم يدمجه
 * ذرّيًا مع الإطار المحلي المطلوب. لا يشغّل باكتيست.
 */
'use strict';

const fs = require('fs');
const path = require('path');
process.env.CLOUD_PRO_TEST = '1';
const { fetchHistorical, validateHistoricalSeries } = require('../engine/backtest.js');

const SYMBOLS = (process.env.BACKTEST_SYMBOLS || '')
  .split(',').map(symbol => symbol.trim().toUpperCase()).filter(Boolean);
const INTERVAL = (process.env.HISTORY_INTERVAL || '15m').trim();
const CADENCE_BY_INTERVAL = Object.freeze({
  '5m': 5 * 60 * 1000,
  '15m': 15 * 60 * 1000,
  '1h': 60 * 60 * 1000,
  '4h': 4 * 60 * 60 * 1000,
});
const CADENCE_MS = CADENCE_BY_INTERVAL[INTERVAL];
const ROOT = path.join(__dirname, '..');
const EXISTING_HIST_DIR = process.env.BACKTEST_EXISTING_HIST_DIR || path.join(ROOT, 'data', 'historical');
const TARGET_START = new Date(process.env.HISTORY_TARGET_START || '').getTime();
const TARGET_END_EXCLUSIVE = new Date(process.env.HISTORY_TARGET_END || '').getTime();

if (!/^(1|true|yes)$/i.test(process.env.BACKTEST_FETCH || '') || !/^(1|true|yes)$/i.test(process.env.BACKTEST_SAVE_HISTORY || '')) {
  throw new Error('Set BACKTEST_FETCH=1 and BACKTEST_SAVE_HISTORY=1 before collecting history');
}
if (!SYMBOLS.length) throw new Error('Set BACKTEST_SYMBOLS explicitly; this script never chooses a live signal universe itself');
if (!CADENCE_MS) throw new Error(`Unsupported HISTORY_INTERVAL: ${INTERVAL}`);
if (!Number.isFinite(TARGET_START) || !Number.isFinite(TARGET_END_EXCLUSIVE) || TARGET_START >= TARGET_END_EXCLUSIVE) {
  throw new Error('HISTORY_TARGET_START and HISTORY_TARGET_END are required and must define an increasing UTC window');
}

function readRaw(file) {
  if (!fs.existsSync(file)) return [];
  const raw = JSON.parse(fs.readFileSync(file, 'utf8'));
  if (!Array.isArray(raw)) throw new Error(`historical-file-invalid:${file}`);
  return raw;
}

function validateFullCoverage(raw, symbol) {
  if (!raw.length) return { valid: false, reason: 'no-existing-candles' };
  try {
    const checked = validateHistoricalSeries(raw, INTERVAL, `${symbol}_${INTERVAL}`);
    const firstOpen = checked.klines[0]?.openTime;
    const lastClose = checked.klines.at(-1)?.closeTime;
    const expectedCount = Math.floor((TARGET_END_EXCLUSIVE - TARGET_START) / CADENCE_MS);
    const valid = firstOpen === TARGET_START && lastClose === TARGET_END_EXCLUSIVE - 1 && checked.klines.length === expectedCount;
    return { valid, reason: valid ? null : `coverage ${checked.klines.length}/${expectedCount}`, checked };
  } catch (error) {
    return { valid: false, reason: error.message };
  }
}

function describeLocalWindow(raw) {
  let firstOpenTime = Infinity;
  let lastCloseTime = -Infinity;
  for (const row of raw) {
    const openTime = Number(row?.[0]);
    const closeTime = Number(row?.[6]);
    if (!Number.isFinite(openTime) || !Number.isFinite(closeTime)) continue;
    firstOpenTime = Math.min(firstOpenTime, openTime);
    lastCloseTime = Math.max(lastCloseTime, closeTime);
  }
  const hasTimestamps = Number.isFinite(firstOpenTime) && Number.isFinite(lastCloseTime);
  const intersectsTarget = hasTimestamps
    && firstOpenTime < TARGET_END_EXCLUSIVE
    && lastCloseTime >= TARGET_START;
  return { hasTimestamps, firstOpenTime, lastCloseTime, intersectsTarget };
}

function mergeRaw(existingRaw, fetchedRaw, symbol) {
  const byOpenTime = new Map();
  for (const row of [...existingRaw, ...fetchedRaw]) {
    const openTime = Number(row?.[0]);
    if (!Number.isFinite(openTime)) throw new Error(`historical-row-invalid:${symbol}:${INTERVAL}`);
    byOpenTime.set(openTime, row);
  }
  const merged = [...byOpenTime.entries()].sort((a, b) => a[0] - b[0]).map(([, row]) => row);
  const coverage = validateFullCoverage(merged, symbol);
  if (!coverage.valid) throw new Error(`merged-history-invalid:${symbol}:${coverage.reason}`);
  return { merged, coverage };
}

function atomicWriteJson(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const temporary = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(temporary, JSON.stringify(value));
  fs.renameSync(temporary, file);
}

async function main() {
  const collected = [], failed = [];
  for (const symbol of SYMBOLS) {
    try {
      const finalFile = path.join(EXISTING_HIST_DIR, `${symbol}_${INTERVAL}.json`);
      const existingRaw = readRaw(finalFile);
      const priorCoverage = validateFullCoverage(existingRaw, symbol);
      if (priorCoverage.valid) {
        collected.push({ symbol, status: 'already-complete', candles: existingRaw.length });
        console.log(`frozen-history ${symbol}: already-complete candles=${existingRaw.length}`);
        continue;
      }

      const fetched = await fetchHistorical(symbol, INTERVAL);
      const stagedFile = path.join(process.env.BACKTEST_HIST_DIR, `${symbol}_${INTERVAL}.json`);
      const stagedRaw = readRaw(stagedFile);
      const localWindow = describeLocalWindow(existingRaw);
      // إذا لم يوجد ملف أو كانت بياناته خارج النافذة الهدف بالكامل، لا تدمجه مع الجلب.
      // جلب fetchHistorical هنا يغطي BACKTEST_START..BACKTEST_END، أي النافذة الكاملة المطلوبة.
      const fetchedCoverage = validateFullCoverage(stagedRaw, symbol);
      const replaceWithFullFetch = !localWindow.intersectsTarget;
      if (replaceWithFullFetch && !fetchedCoverage.valid) {
        throw new Error(`full-fetch-invalid:${symbol}:${fetchedCoverage.reason}`);
      }
      const { merged, coverage } = replaceWithFullFetch
        ? { merged: stagedRaw, coverage: fetchedCoverage }
        : mergeRaw(existingRaw, stagedRaw, symbol);
      const meta = {
        symbol,
        interval: INTERVAL,
        requestedStart: TARGET_START,
        requestedEnd: TARGET_END_EXCLUSIVE - 1,
        fetchedAt: new Date().toISOString(),
        savedCandles: merged.length,
        firstOpenTime: coverage.checked.klines[0].openTime,
        lastCloseTime: coverage.checked.klines.at(-1).closeTime,
        duplicatesRemoved: replaceWithFullFetch ? 0 : existingRaw.length + stagedRaw.length - merged.length,
        pages: fetched.metadata.pages,
        source: replaceWithFullFetch
          ? 'full-paginated-fetch-after-non-overlapping-local-window'
          : 'existing-window-plus-paginated-extension',
      };
      atomicWriteJson(finalFile, merged);
      atomicWriteJson(path.join(EXISTING_HIST_DIR, `${symbol}_${INTERVAL}.meta.json`), meta);
      const status = replaceWithFullFetch ? 'full-fetch' : 'extended';
      collected.push({ symbol, status, candles: merged.length, pages: fetched.metadata.pages, duplicatesRemoved: meta.duplicatesRemoved });
      console.log(`frozen-history ${symbol}: ${status} candles=${merged.length} pages=${fetched.metadata.pages}`);
    } catch (error) {
      failed.push({ symbol, error: error.message });
      console.error(`frozen-history-failed ${symbol}: ${error.message}`);
    }
  }
  const summary = { symbolsRequested: SYMBOLS.length, collected, failed };
  console.log(JSON.stringify(summary, null, 2));
  if (failed.length) process.exitCode = 1;
}

main().catch(error => { console.error(`historical-collection-failed: ${error.stack || error.message}`); process.exitCode = 1; });
