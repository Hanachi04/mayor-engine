/**
 * MaYor Cloud Pro MTF — Historical Backtest
 * بحثي فقط؛ لا ينفّذ أوامر تداول ولا يرسل Telegram.
 *
 * الاستخدام:
 *   node engine/backtest.js
 *
 * البيانات المحلية المتوقعة:
 *   data/historical/BTCUSDT_5m.json
 *   data/historical/BTCUSDT_15m.json
 *   data/historical/BTCUSDT_1h.json
 *   data/historical/BTCUSDT_4h.json
 *
 * إذا لم توجد ملفات محلية، يمكن جلب آخر البيانات العامة عبر:
 *   BACKTEST_FETCH=1 BACKTEST_SYMBOLS=BTCUSDT node engine/backtest.js
 */

'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const {
  CONFIG, Indicators, normalizeKlines, analyzeLatest, levelsFromSignal,
  netPnl
} = require('./scan.js');

const ROOT = path.join(__dirname, '..');
const DATA_DIR = path.join(ROOT, 'data');
const HIST_DIR = process.env.BACKTEST_HIST_DIR || path.join(DATA_DIR, 'historical');
// المخرجات الافتراضية تبقى كما هي؛ المسارات البديلة تستخدم فقط في التشغيل البحثي المتوازي.
const REPORT_FILE = process.env.BACKTEST_REPORT_FILE || path.join(DATA_DIR, 'backtest_report.json');
const VERIFICATION_FILE = process.env.BACKTEST_VERIFICATION_FILE || path.join(DATA_DIR, 'verification.json');
const ENDPOINTS = ['https://api.binance.com', 'https://data-api.binance.vision'];
const INTERVALS = ['5m', '15m', '1h', '4h'];
const FRAME_WEIGHTS = CONFIG.frameWeights;
const MC_RUNS = Math.max(200, Number(process.env.MONTE_CARLO_RUNS || 1000));
const MIN_SAMPLE = Number(process.env.MIN_BACKTEST_TRADES || CONFIG.minBacktestTrades || 30);
const MIN_OOS = Number(process.env.MIN_OOS_TRADES || CONFIG.minOosTrades || 10);
const SYMBOLS = (process.env.BACKTEST_SYMBOLS || 'BTCUSDT').split(',').map(s => s.trim().toUpperCase()).filter(Boolean);
// حد Binance هو 1000 شمعة للطلب الواحد فقط. BACKTEST_LIMIT يعني إجمالي الشموع المطلوبة،
// بينما كل صفحة تبقى ضمن الحد. لا يغيّر ذلك شروط الاستراتيجية أو بوابة التحقق.
const BINANCE_PAGE_LIMIT = 1000;
const FETCH_LIMIT = Math.max(200, Number(process.env.BACKTEST_LIMIT || 1000));
const PAGE_DELAY_MS = Math.max(0, Number(process.env.BACKTEST_PAGE_DELAY_MS || 300));
const MAX_FETCH_PAGES = Math.max(1, Number(process.env.BACKTEST_MAX_PAGES || 10000));
const SAVE_FETCHED_HISTORY = /^(1|true|yes)$/i.test(process.env.BACKTEST_SAVE_HISTORY || '');
const BACKTEST_END_MS = process.env.BACKTEST_END ? new Date(process.env.BACKTEST_END).getTime() : Date.now();
// بحثي فقط: لا يتصل بالشبكة ولا يغير scan.js. وضع off يحافظ على baseline الحالي حرفيًا.
const SENTIMENT_MODE = String(process.env.BACKTEST_SENTIMENT_MODE || 'off').toLowerCase();
const SENTIMENT_FILE = process.env.BACKTEST_SENTIMENT_FILE || '';
const DAY_MS = 24 * 60 * 60 * 1000;
const VERBOSE_FETCH_PAGES = /^(1|true|yes)$/i.test(process.env.BACKTEST_VERBOSE_PAGES || '');
// يظل 1500 هو الافتراضي؛ المتغير يسمح باختبار حساسية الإحماء على البيانات المجمّدة فقط.
const WARMUP_CANDLES = Math.max(1, Number(process.env.BACKTEST_WARMUP_CANDLES || 1500));
// يُفعّل في اختبارات الحساسية فقط لتوثيق قرار كل شمعة دون تغيير مسار الإشارة أو التقرير الافتراضي.
const DECISION_FINGERPRINT = /^(1|true|yes)$/i.test(process.env.BACKTEST_DECISION_FINGERPRINT || '');
// تصدير بحثي اختياري فقط لصفقات OOS؛ يبقى التقرير الافتراضي دون هذا الحقل.
const EXPORT_TRADES = /^(1|true|yes)$/i.test(process.env.BACKTEST_EXPORT_TRADES || '');
// تصدير تشخيصي بحثي منفصل لـ IS وOOS؛ لا يغير شروط الإشارة أو حساب الصفقة أو التقرير الافتراضي.
const EXPORT_TRADE_DIAGNOSTICS = /^(1|true|yes)$/i.test(process.env.BACKTEST_EXPORT_TRADE_DIAGNOSTICS || '');
// تجربة بحثية معزولة: لا يُفعّل الفلتر إلا بقيمة رقمية صريحة، ويبقى المسار القياسي بلا تغيير.
const EXPERIMENT_MIN_ADX = (() => {
  const value = Number(process.env.BACKTEST_EXPERIMENT_MIN_ADX);
  return Number.isFinite(value) && value >= 0 ? value : null;
})();
let lastHistoricalRequestAt = 0;

function finite(v, fallback = NaN) {
  if (v === null || v === undefined || v === '') return fallback;
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
}
function round(v, digits = 4) { return Number(Number(v).toFixed(digits)); }
function sleep(ms) { return new Promise(resolve => setTimeout(resolve, ms)); }
function mean(a) { return a.length ? a.reduce((x, y) => x + y, 0) / a.length : 0; }
function quantile(a, q) { if (!a.length) return 0; const s = [...a].sort((x, y) => x - y), pos = (s.length - 1) * q, lo = Math.floor(pos), hi = Math.ceil(pos); return s[lo] + (s[hi] - s[lo]) * (pos - lo); }
function stddev(a) { const m = mean(a); return a.length > 1 ? Math.sqrt(a.reduce((s, x) => s + (x - m) ** 2, 0) / (a.length - 1)) : 0; }
function clamp(v, lo, hi) { return Math.max(lo, Math.min(hi, v)); }
function normalCdf(z) { return 0.5 * (1 + erf(z / Math.SQRT2)); }
function erf(x) { const sign = x < 0 ? -1 : 1; const ax = Math.abs(x), t = 1 / (1 + 0.3275911 * ax); const y = 1 - (((((1.061405429 * t - 1.453152027) * t) + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t * Math.exp(-ax * ax); return sign * y; }
function escapeCsv(v) { return String(v ?? '').replace(/,/g, ''); }

function parseHistoricalSentiment(raw) {
  const entries = Array.isArray(raw) ? raw : raw?.data;
  if (!Array.isArray(entries)) throw new Error('historical-sentiment-invalid-format');
  const unique = new Map();
  for (const row of entries) {
    const timestampMs = Number(row?.timestamp) * 1000, value = Number(row?.value);
    if (!Number.isFinite(timestampMs) || !Number.isFinite(value) || value < 0 || value > 100) continue;
    unique.set(timestampMs, { timestampMs, value, classification: String(row?.value_classification || '') || null });
  }
  const observations = [...unique.values()].sort((a, b) => a.timestampMs - b.timestampMs);
  if (!observations.length) throw new Error('historical-sentiment-no-valid-observations');
  return observations;
}

// سياسة محافظة: قراءة يوم UTC لا تُستخدم في يوم timestamp نفسه؛ تبدأ فقط في اليوم التالي.
// هذا يتجنب افتراض ساعة نشر Alternative.me، ولو كان أبطأ من توافر المصدر الحقيقي.
function createHistoricalSentimentProvider(observations, metadata = {}) {
  const sorted = [...observations].sort((a, b) => a.timestampMs - b.timestampMs);
  if (!sorted.length) throw new Error('historical-sentiment-no-observations');
  return {
    mode: 'historical_previous_utc_day',
    policy: 'Use the newest observation with timestamp strictly before the current UTC day; never use same-day data.',
    metadata,
    resolve(evaluationTime) {
      const dayStart = Math.floor(evaluationTime / DAY_MS) * DAY_MS;
      let lo = 0, hi = sorted.length, index = -1;
      while (lo < hi) {
        const mid = (lo + hi) >> 1;
        if (sorted[mid].timestampMs < dayStart) { index = mid; lo = mid + 1; } else hi = mid;
      }
      if (index < 0) return { value: null, sourceTimestampMs: null, ageMs: null };
      const item = sorted[index];
      return { value: item.value, sourceTimestampMs: item.timestampMs, ageMs: evaluationTime - item.timestampMs, classification: item.classification };
    },
    describe() {
      return {
        mode: this.mode, policy: this.policy, observations: sorted.length,
        firstTimestampMs: sorted[0].timestampMs, lastTimestampMs: sorted.at(-1).timestampMs,
        ...metadata
      };
    }
  };
}

function loadHistoricalSentimentProvider() {
  if (SENTIMENT_MODE === 'off') return null;
  if (SENTIMENT_MODE !== 'historical_previous_utc_day') throw new Error(`unsupported-backtest-sentiment-mode:${SENTIMENT_MODE}`);
  if (!SENTIMENT_FILE) throw new Error('backtest-sentiment-file-required');
  const rawText = fs.readFileSync(SENTIMENT_FILE, 'utf8');
  const observations = parseHistoricalSentiment(JSON.parse(rawText));
  return createHistoricalSentimentProvider(observations, {
    sourceFile: path.resolve(SENTIMENT_FILE),
    sourceSha256: crypto.createHash('sha256').update(rawText).digest('hex')
  });
}

function createSentimentAudit(provider) {
  return { mode: provider?.mode || 'off', policy: provider?.policy || null, evaluations: 0, unavailable: 0,
    longVoteEligible: 0, shortVoteEligible: 0, neutral: 0, minValue: null, maxValue: null, maxAgeMs: null, _sources: new Set() };
}
function observeSentiment(audit, resolved) {
  audit.evaluations++;
  if (!Number.isFinite(resolved?.value)) { audit.unavailable++; return; }
  const value = resolved.value;
  audit.minValue = audit.minValue === null ? value : Math.min(audit.minValue, value);
  audit.maxValue = audit.maxValue === null ? value : Math.max(audit.maxValue, value);
  audit.maxAgeMs = audit.maxAgeMs === null ? resolved.ageMs : Math.max(audit.maxAgeMs, resolved.ageMs);
  if (Number.isFinite(resolved.sourceTimestampMs)) audit._sources.add(resolved.sourceTimestampMs);
  if (value <= CONFIG.sentimentExtremeLow) audit.longVoteEligible++;
  else if (value >= CONFIG.sentimentExtremeHigh) audit.shortVoteEligible++;
  else audit.neutral++;
}
function finalizeSentimentAudit(audit) {
  return { ...audit, sourceObservationsUsed: audit._sources.size, _sources: undefined };
}
function createDecisionAudit() {
  return { evaluations: 0, baseCoreSignals: 0, mtfPassed: 0, reasons: {}, _hash: DECISION_FINGERPRINT ? crypto.createHash('sha256') : null };
}
function observeDecision(audit, mtf, evaluationTime) {
  audit.evaluations++;
  if (mtf?.frames?.[CONFIG.baseInterval]?.signal) audit.baseCoreSignals++;
  if (mtf?.ok && mtf?.signal) audit.mtfPassed++;
  const reason = mtf?.ok ? 'passed-mtf' : (mtf?.reason || 'unknown');
  audit.reasons[reason] = (audit.reasons[reason] || 0) + 1;
  if (audit._hash) {
    const frameSignals = Object.fromEntries(INTERVALS.map(tf => [tf, mtf?.frames?.[tf]?.signal || null]));
    audit._hash.update(JSON.stringify({ evaluationTime, ok: Boolean(mtf?.ok), reason, valid: mtf?.valid || [], mtfPct: mtf?.mtfPct ?? null, signal: mtf?.signal || null, frameSignals }) + '\n');
  }
}
function finalizeDecisionAudit(audit) {
  const result = { ...audit, _hash: undefined };
  if (audit._hash) result.fingerprintSha256 = audit._hash.digest('hex');
  return result;
}

function loadSeriesFromFile(file, interval) {
  const raw = JSON.parse(fs.readFileSync(file, 'utf8'));
  const arr = Array.isArray(raw) ? raw : raw.klines || raw.data || [];
  return validateHistoricalSeries(arr, interval, path.basename(file)).klines;
}

async function fetchJson(url, params, onDiagnostic = null) {
  let last;
  for (const base of ENDPOINTS) {
    for (let attempt = 0; attempt < 4; attempt++) {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 15000);
      try {
        const waitMs = PAGE_DELAY_MS - (Date.now() - lastHistoricalRequestAt);
        if (waitMs > 0) await sleep(waitMs);
        lastHistoricalRequestAt = Date.now();
        const u = new URL(`${base}${url}`); Object.entries(params).forEach(([k, v]) => u.searchParams.set(k, String(v)));
        const res = await fetch(u, { signal: controller.signal, headers: { 'user-agent': 'MaYor-Backtest/1.0' } });
        onDiagnostic?.({ event: 'http-response', attempt: attempt + 1, endpoint: base, httpStatus: res.status });
        if (!res.ok) { const e = new Error(`HTTP ${res.status}`); e.status = res.status; throw e; }
        const data = await res.json();
        onDiagnostic?.({ event: 'payload', attempt: attempt + 1, endpoint: base, httpStatus: res.status, receivedCandles: Array.isArray(data) ? data.length : null });
        return data;
      } catch (e) {
        onDiagnostic?.({ event: 'exception', attempt: attempt + 1, endpoint: base, httpStatus: e.status || null, error: e.message || String(e) });
        last = e; const delay = [418, 429].includes(e.status) ? 1500 * 2 ** attempt : 500 * 2 ** attempt;
        if (attempt < 3) await sleep(Math.min(30000, delay));
      } finally { clearTimeout(timer); }
    }
  }
  throw last || new Error('historical-data-fetch-failed');
}

function atomicWriteJson(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const temp = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(temp, JSON.stringify(value));
  fs.renameSync(temp, file);
}

function validateHistoricalSeries(raw, interval, label = interval) {
  const cadence = intervalMs(interval);
  const unique = new Map();
  let duplicates = 0;
  for (const candle of normalizeKlines(raw)) {
    if (!Number.isFinite(candle.openTime) || !Number.isFinite(candle.closeTime) || candle.closeTime >= Date.now()) continue;
    if (unique.has(candle.openTime)) { duplicates++; continue; }
    unique.set(candle.openTime, candle);
  }
  const klines = [...unique.values()].sort((a, b) => a.openTime - b.openTime);
  const gaps = [];
  for (let i = 1; i < klines.length; i++) {
    const actual = klines[i].openTime - klines[i - 1].openTime;
    if (actual !== cadence) gaps.push({ previousOpenTime: klines[i - 1].openTime, nextOpenTime: klines[i].openTime, expectedMs: cadence, actualMs: actual });
  }
  if (gaps.length) {
    const first = gaps[0];
    throw new Error(`historical-series-gap:${label}: count=${gaps.length}, expected=${first.expectedMs}, actual=${first.actualMs}, at=${new Date(first.previousOpenTime).toISOString()}`);
  }
  return { klines, duplicates, cadenceMs: cadence, gaps };
}

function validateHistoricalCoverage(klines, cadence, requestedStart, endTime, label) {
  const expectedFirstOpen = Math.ceil(requestedStart / cadence) * cadence;
  const firstOpen = klines[0]?.openTime;
  const lastClose = klines.at(-1)?.closeTime;
  if (firstOpen !== expectedFirstOpen || lastClose !== endTime) {
    throw new Error(`historical-coverage-incomplete:${label}: expected=${new Date(expectedFirstOpen).toISOString()}..${new Date(endTime).toISOString()}, actual=${firstOpen ? new Date(firstOpen).toISOString() : 'none'}..${lastClose ? new Date(lastClose).toISOString() : 'none'}`);
  }
}

async function fetchHistorical(symbol, interval) {
  const cadence = intervalMs(interval);
  // نهاية النطاق هي آخر شمعة مكتملة وفق الإطار، لا وقتًا وسط الشمعة الحالية.
  const endTime = Math.floor(BACKTEST_END_MS / cadence) * cadence - 1;
  if (!Number.isFinite(endTime)) throw new Error(`invalid-backtest-end:${process.env.BACKTEST_END || BACKTEST_END_MS}`);
  const requestedStart = process.env.BACKTEST_START ? new Date(process.env.BACKTEST_START).getTime() : endTime - cadence * FETCH_LIMIT;
  if (!Number.isFinite(requestedStart) || requestedStart >= endTime) throw new Error(`invalid-backtest-start:${process.env.BACKTEST_START || requestedStart}`);
  const rawCandles = [];
  let cursor = requestedStart, page = 0;
  while (cursor < endTime && page < MAX_FETCH_PAGES) {
    const remaining = Math.max(1, Math.ceil((endTime - cursor) / cadence));
    const pageNumber = page + 1;
    const pageParams = { symbol, interval, limit: Math.min(BINANCE_PAGE_LIMIT, remaining), startTime: cursor, endTime: endTime - 1 };
    if (VERBOSE_FETCH_PAGES) console.error(JSON.stringify({ event: 'page-request', page: pageNumber, ...pageParams }));
    const raw = await fetchJson('/api/v3/klines', pageParams, detail => {
      if (VERBOSE_FETCH_PAGES) console.error(JSON.stringify({ page: pageNumber, startTime: cursor, ...detail }));
    });
    if (!Array.isArray(raw)) throw new Error(`historical-page-invalid:${symbol}:${interval}:page=${page + 1}`);
    if (!raw.length) {
      if (VERBOSE_FETCH_PAGES) console.error(JSON.stringify({ event: 'page-empty-stop', page: pageNumber, startTime: cursor }));
      break;
    }
    rawCandles.push(...raw);
    const lastOpenTime = Number(raw.at(-1)?.[0]);
    const nextCursor = lastOpenTime + cadence;
    if (VERBOSE_FETCH_PAGES) console.error(JSON.stringify({ event: 'page-accepted', page: pageNumber, startTime: cursor, receivedCandles: raw.length, nextCursor }));
    if (!Number.isFinite(lastOpenTime) || nextCursor <= cursor) throw new Error(`historical-pagination-stalled:${symbol}:${interval}:page=${page + 1}`);
    cursor = nextCursor;
    page++;
  }
  if (page >= MAX_FETCH_PAGES && cursor < endTime) throw new Error(`historical-pagination-page-limit:${symbol}:${interval}:${MAX_FETCH_PAGES}`);
  if (!rawCandles.length) throw new Error(`historical-series-empty:${symbol}:${interval}`);
  const validated = validateHistoricalSeries(rawCandles, interval, `${symbol}_${interval}`);
  if (!validated.klines.length) throw new Error(`historical-series-empty-after-validation:${symbol}:${interval}`);
  validateHistoricalCoverage(validated.klines, cadence, requestedStart, endTime, `${symbol}:${interval}`);
  const rawByOpen = new Map();
  for (const candle of rawCandles) rawByOpen.set(Number(candle?.[0]), candle);
  const frozenRaw = validated.klines.map(candle => rawByOpen.get(candle.openTime));
  const metadata = {
    symbol, interval, requestedStart, requestedEnd: endTime, fetchedAt: new Date().toISOString(),
    pages: page, rawCandles: rawCandles.length, savedCandles: frozenRaw.length,
    duplicatesRemoved: validated.duplicates, cadenceMs: validated.cadenceMs,
    firstOpenTime: validated.klines[0]?.openTime || null, lastCloseTime: validated.klines.at(-1)?.closeTime || null
  };
  if (SAVE_FETCHED_HISTORY) {
    const file = path.join(HIST_DIR, `${symbol}_${interval}.json`);
    atomicWriteJson(file, frozenRaw);
    atomicWriteJson(path.join(HIST_DIR, `${symbol}_${interval}.meta.json`), metadata);
  }
  console.log(`historical ${symbol} ${interval}: pages=${page}, candles=${frozenRaw.length}, duplicatesRemoved=${validated.duplicates}, saved=${SAVE_FETCHED_HISTORY ? 'yes' : 'no'}`);
  return { klines: validated.klines, metadata };
}

function intervalMs(interval) { return ({ '5m': 5, '15m': 15, '1h': 60, '4h': 240 }[interval] || 15) * 60 * 1000; }

async function loadDataset(symbol) {
  const data = {};
  for (const interval of INTERVALS) {
    const file = path.join(HIST_DIR, `${symbol}_${interval}.json`);
    if (fs.existsSync(file)) data[interval] = loadSeriesFromFile(file, interval);
    else if (/^(1|true|yes)$/i.test(process.env.BACKTEST_FETCH || '')) data[interval] = (await fetchHistorical(symbol, interval)).klines;
    else data[interval] = [];
  }
  return { symbol, data };
}

function sliceUntil(series, endTime) { let lo = 0, hi = series.length; while (lo < hi) { const m = Math.floor((lo + hi) / 2); if (series[m].closeTime < endTime) lo = m + 1; else hi = m; } return series.slice(0, lo); }
function sliceWindowUntil(series, endTime, warmup = WARMUP_CANDLES) {
  let lo = 0, hi = series.length;
  while (lo < hi) {
    const m = Math.floor((lo + hi) / 2);
    if (series[m].closeTime < endTime) lo = m + 1;
    else hi = m;
  }
  return series.slice(Math.max(0, lo - warmup), lo);
}
function lastClosedIndex(series, endTime) { let i = -1; for (let n = 0; n < series.length; n++) { if (series[n].closeTime < endTime) i = n; else break; } return i; }

function volume24h(series, endIndex) {
  const end = Math.max(0, endIndex), startTime = series[end]?.closeTime - 24 * 3600 * 1000;
  let total = 0;
  for (let i = end; i >= 0 && series[i].closeTime >= startTime; i--) total += series[i].close * series[i].volume;
  return total;
}

function extractFeatures(result) {
  const ind = result?.indicators;
  if (!ind) return null;
  const price = finite(ind.price), atr = finite(ind.atr);
  return {
    emaSpreadPct: price ? (ind.ema20 - ind.ema50) / price * 100 : null,
    macdHistPct: price ? (ind.macd.macd - ind.macd.signal) / price * 100 : null,
    rsi: finite(ind.rsi), adx: finite(ind.adx), atrPct: price ? atr / price * 100 : null,
    volumeRatio: finite(ind.volume), stochRsi: finite(ind.stoch?.current), structure: finite(ind.structure),
    takerFlow: finite(ind.takerFlow), obImbalance: finite(ind.obImbalance)
  };
}

function exportTradeDiagnostics(trades) {
  return trades.map(t => ({
    symbol: t.symbol,
    dir: t.dir,
    signalTime: t.signalTime,
    entryTime: t.entryTime,
    exitTime: t.exitTime,
    netPct: t.netPct,
    result: t.result,
    holdingMs: t.exitTime - t.entryTime,
    rr: t.rr,
    mtfPct: t.mtfPct,
    corePct: t.corePct,
    sentiment: t.sentiment,
    entryFeatures: t.entryFeatures || null
  }));
}

function getMtfAt(dataset, evaluationTime, sentiment = null) {
  // أي إشارة صالحة تتطلب تأكيد الإطار الأساسي؛ لذا نفحصه أولًا.
  // عند غياب إشارته لا يمكن للأطر الأخرى تغيير النتيجة، فتجنب حسابها يحافظ
  // على المنطق نفسه ويجعل نافذة الأشهر قابلة للتنفيذ.
  const baseTf = CONFIG.baseInterval;
  const baseRaw = sliceWindowUntil(dataset.data[baseTf] || [], evaluationTime);
  const baseMin = CONFIG.minKlinesByFrame[baseTf] || CONFIG.minKlines;
  if (baseRaw.length < baseMin) return { ok: false, reason: 'base-frame-insufficient-data', frames: {}, valid: [] };
  const baseResult = analyzeLatest(dataset.symbol, baseRaw, { skipSanitize: true, minKlines: baseMin, obImbalance: null, sentiment });
  if (!baseResult.signal) return { ok: false, reason: 'base-frame-no-signal', frames: { [baseTf]: baseResult }, valid: [] };

  const frames = {}, valid = [];
  for (const tf of INTERVALS) {
    const raw = tf === baseTf ? baseRaw : sliceWindowUntil(dataset.data[tf] || [], evaluationTime);
    const min = CONFIG.minKlinesByFrame[tf] || CONFIG.minKlines;
    if (raw.length < min) continue;
    const result = tf === baseTf ? baseResult : analyzeLatest(dataset.symbol, raw, { skipSanitize: true, minKlines: min, obImbalance: null, sentiment });
    frames[tf] = result;
    if (result.signal) valid.push(tf);
  }
  if (valid.length < CONFIG.minFrames) return { ok: false, reason: `mtf-frames:${valid.length}/${CONFIG.minFrames}`, frames, valid };
  const longWeight = valid.filter(tf => frames[tf].signal.dir === 'LONG').reduce((s, tf) => s + FRAME_WEIGHTS[tf], 0);
  const shortWeight = valid.filter(tf => frames[tf].signal.dir === 'SHORT').reduce((s, tf) => s + FRAME_WEIGHTS[tf], 0);
  const total = longWeight + shortWeight, dir = longWeight >= shortWeight ? 'LONG' : 'SHORT';
  const winning = dir === 'LONG' ? longWeight : shortWeight, mtfPct = total ? winning / total * 100 : 0;
  if (mtfPct < CONFIG.minMtfPct) return { ok: false, reason: 'mtf-threshold', frames, valid, mtfPct };
  if (!frames['1h']?.signal || !frames['4h']?.signal || frames['1h'].signal.dir !== dir || frames['4h'].signal.dir !== dir) return { ok: false, reason: 'higher-timeframe-conflict', frames, valid, mtfPct };
  if (!frames[CONFIG.baseInterval]?.signal || frames[CONFIG.baseInterval].signal.dir !== dir) return { ok: false, reason: 'base-frame-conflict', frames, valid, mtfPct };
  const base = frames[CONFIG.baseInterval], levels = levelsFromSignal({
    ...base.signal, mtfPct: round(mtfPct, 2), mtfFrames: valid, rsi4h: frames['4h'].indicators?.rsi ?? null,
    adx4h: frames['4h'].signal.adx, liquidity24h: volume24h(dataset.data[CONFIG.baseInterval], lastClosedIndex(dataset.data[CONFIG.baseInterval], evaluationTime)),
    votesByTf: valid.map(tf => `${tf}→${frames[tf].signal.dir}`)
  });
  return levels ? { ok: true, signal: levels, frames, valid, mtfPct, sentiment, features: extractFeatures(base) } : { ok: false, reason: 'invalid-levels', frames, valid, mtfPct, sentiment };
}

function chooseExit(trade, candle) {
  const long = trade.dir === 'LONG';
  const sl = long ? candle.low <= trade.sl : candle.high >= trade.sl;
  const tp3 = long ? candle.high >= trade.tp3 : candle.low <= trade.tp3;
  const tp2 = long ? candle.high >= trade.tp2 : candle.low <= trade.tp2;
  const tp1 = long ? candle.high >= trade.tp1 : candle.low <= trade.tp1;
  if (sl) return { result: 'SL', rawExit: trade.sl };
  if (tp3) return { result: 'TP3', rawExit: trade.tp3 };
  if (tp2) return { result: 'TP2', rawExit: trade.tp2 };
  if (tp1) return { result: 'TP1', rawExit: trade.tp1 };
  return null;
}

function runWindow(dataset, startTime, endTime, sentimentProvider = null) {
  const base = dataset.data[CONFIG.baseInterval] || [], trades = [], features = [], open = [];
  const sentimentAudit = createSentimentAudit(sentimentProvider);
  const decisionAudit = createDecisionAudit();
  let lastSignalAt = 0;
  for (let i = 0; i < base.length - 1; i++) {
    const signalClose = base[i].closeTime;
    if (signalClose < startTime || signalClose >= endTime) continue;
    for (let oi = open.length - 1; oi >= 0; oi--) {
      const trade = open[oi], age = base[i].closeTime - trade.entryTime;
      const exit = chooseExit(trade, base[i]);
      if (exit || age >= CONFIG.maxTradeAgeMs) {
        const rawExit = exit ? exit.rawExit : base[i].close;
        const result = exit ? exit.result : 'انتهت المدة';
        const pnl = netPnl(trade.entryRaw, rawExit, trade.dir);
        trades.push({ ...trade, result, exitTime: base[i].closeTime, exitRaw: rawExit, ...pnl, netPct: round(pnl.netPct, 5) });
        open.splice(oi, 1);
      }
    }
    const resolvedSentiment = sentimentProvider ? sentimentProvider.resolve(signalClose + 1) : null;
    if (sentimentProvider) observeSentiment(sentimentAudit, resolvedSentiment);
    const mtf = getMtfAt(dataset, signalClose + 1, resolvedSentiment?.value ?? null);
    observeDecision(decisionAudit, mtf, signalClose);
    const feature = mtf.features; if (feature) features.push({ time: signalClose, ...feature });
    if (!mtf.ok || !mtf.signal || open.length) continue;
    // يطبق فقط في تجربة صريحة بعد قرار الإشارة؛ لا يغير المؤشرات أو المستويات أو حساب العائد.
    if (EXPERIMENT_MIN_ADX !== null && finite(mtf.features?.adx, -Infinity) < EXPERIMENT_MIN_ADX) continue;
    if (signalClose - lastSignalAt < CONFIG.signalCooldownMs) continue;
    const entryCandle = base[i + 1];
    if (!entryCandle || entryCandle.openTime < signalClose) continue;
    const trade = { symbol: dataset.symbol, dir: mtf.signal.dir, signalTime: signalClose, entryTime: entryCandle.openTime,
      entryRaw: entryCandle.open, price: entryCandle.open, sl: mtf.signal.sl, tp1: mtf.signal.tp1, tp2: mtf.signal.tp2, tp3: mtf.signal.tp3,
      rr: mtf.signal.rr, mtfPct: mtf.signal.mtfPct, corePct: mtf.signal.corePct, sentiment: mtf.sentiment,
      ...(EXPORT_TRADE_DIAGNOSTICS ? { entryFeatures: mtf.features || null } : {}) };
    open.push(trade); lastSignalAt = signalClose;
  }
  for (const trade of open) {
    const last = base.filter(c => c.closeTime >= trade.entryTime && c.closeTime < endTime).at(-1);
    if (last) { const pnl = netPnl(trade.entryRaw, last.close, trade.dir); trades.push({ ...trade, result: 'انتهت المدة', exitTime: last.closeTime, exitRaw: last.close, ...pnl, netPct: round(pnl.netPct, 5) }); }
  }
  return { trades: trades.filter(t => t.exitTime >= startTime && t.exitTime < endTime), features, sentimentAudit: finalizeSentimentAudit(sentimentAudit), decisionAudit: finalizeDecisionAudit(decisionAudit) };
}

function metrics(trades) {
  const returns = trades.map(t => finite(t.netPct, 0)), wins = returns.filter(x => x > 0), losses = returns.filter(x => x < 0);
  let equity = 0, peak = 0, maxDrawdown = 0;
  for (const r of returns) { equity += r; peak = Math.max(peak, equity); maxDrawdown = Math.max(maxDrawdown, peak - equity); }
  const grossWin = wins.reduce((a, b) => a + b, 0), grossLoss = Math.abs(losses.reduce((a, b) => a + b, 0));
  return { trades: trades.length, wins: wins.length, losses: losses.length, winRatePct: trades.length ? wins.length / trades.length * 100 : 0,
    netPct: returns.reduce((a, b) => a + b, 0), avgNetPct: mean(returns), profitFactor: grossLoss ? grossWin / grossLoss : wins.length ? Infinity : 0,
    maxDrawdownPct: maxDrawdown, medianNetPct: quantile(returns, 0.5), returns };
}

function deterministicShuffle(input, seed) {
  const a = [...input]; let x = seed >>> 0;
  for (let i = a.length - 1; i > 0; i--) { x = (1664525 * x + 1013904223) >>> 0; const j = x % (i + 1); [a[i], a[j]] = [a[j], a[i]]; }
  return a;
}

function pathStats(returns) {
  let equity = 0, peak = 0, maxDrawdown = 0;
  for (const r of returns) {
    equity += r;
    peak = Math.max(peak, equity);
    maxDrawdown = Math.max(maxDrawdown, peak - equity);
  }
  return { finalNetPct: equity, maxDrawdownPct: maxDrawdown, score: equity - maxDrawdown };
}

function monteCarlo(returns, runs = MC_RUNS) {
  if (!returns.length) return { runs, method: 'permutation_paths', observedNetPct: 0, observedMaxDrawdownPct: 0, observedScore: 0, p05: 0, p50: 0, p95: 0, mean: 0, stddev: 0, zScore: 0, observedAtOrAbovePct: 0 };
  const observedStats = pathStats(returns), scores = [], drawdowns = [];
  for (let i = 0; i < runs; i++) {
    const stats = pathStats(deterministicShuffle(returns, i + 17));
    scores.push(stats.score); drawdowns.push(stats.maxDrawdownPct);
  }
  const m = mean(scores), sd = stddev(scores), z = sd ? (observedStats.score - m) / sd : 0;
  return {
    runs, method: 'permutation_paths', observedNetPct: round(observedStats.finalNetPct, 5),
    observedMaxDrawdownPct: round(observedStats.maxDrawdownPct, 5), observedScore: round(observedStats.score, 5),
    p05: round(quantile(scores, 0.05), 5), p50: round(quantile(scores, 0.5), 5), p95: round(quantile(scores, 0.95), 5),
    maxDrawdownP05: round(quantile(drawdowns, 0.05), 5), maxDrawdownP50: round(quantile(drawdowns, 0.5), 5), maxDrawdownP95: round(quantile(drawdowns, 0.95), 5),
    mean: round(m, 5), stddev: round(sd, 5), zScore: round(z, 4),
    observedAtOrAbovePct: scores.length ? scores.filter(x => x <= observedStats.score).length / scores.length * 100 : 0
  };
}

function pearson(a, b) {
  const pairs = []; for (let i = 0; i < Math.min(a.length, b.length); i++) if (Number.isFinite(a[i]) && Number.isFinite(b[i])) pairs.push([a[i], b[i]]);
  if (pairs.length < 4) return null; const ax = mean(pairs.map(p => p[0])), bx = mean(pairs.map(p => p[1]));
  const num = pairs.reduce((s, p) => s + (p[0] - ax) * (p[1] - bx), 0), da = Math.sqrt(pairs.reduce((s, p) => s + (p[0] - ax) ** 2, 0)), db = Math.sqrt(pairs.reduce((s, p) => s + (p[1] - bx) ** 2, 0));
  return da && db ? { r: num / (da * db), n: pairs.length } : null;
}
function fisherPValue(r, n) { if (n < 4 || !Number.isFinite(r)) return 1; const z = Math.abs(0.5 * Math.log((1 + clamp(r, -0.999999, 0.999999)) / (1 - clamp(r, -0.999999, 0.999999)))) * Math.sqrt(Math.max(1, n - 3)); return 2 * (1 - normalCdf(z)); }
function correlationMatrix(rows) {
  const keys = [...new Set(rows.flatMap(r => Object.keys(r).filter(k => k !== 'time')))].sort(), matrix = {}, pairs = [], m = keys.length * (keys.length - 1) / 2, alpha = 0.05 / Math.max(1, m);
  for (const a of keys) { matrix[a] = {}; for (const b of keys) { const p = pearson(rows.map(r => r[a]), rows.map(r => r[b])); matrix[a][b] = p ? round(p.r, 4) : null; } }
  for (let i = 0; i < keys.length; i++) for (let j = i + 1; j < keys.length; j++) { const p = pearson(rows.map(r => r[keys[i]]), rows.map(r => r[keys[j]])); if (!p) continue; const pv = fisherPValue(p.r, p.n); if (Math.abs(p.r) > 0.7) pairs.push({ a: keys[i], b: keys[j], r: round(p.r, 4), pValueApprox: round(pv, 6), significantAfterBonferroni: pv < alpha, n: p.n }); }
  return { keys, matrix, highCorrelationPairs: pairs, bonferroniAlpha: alpha, method: 'Pearson; p-value uses Fisher-z normal approximation; Bonferroni alpha=0.05/m' };
}

function buildGate(is, oos, mc) {
  const warnings = [];
  if (is.trades < MIN_SAMPLE) warnings.push(`IS sample small: ${is.trades}/${MIN_SAMPLE}`);
  if (oos.trades < MIN_OOS) warnings.push(`OOS sample small: ${oos.trades}/${MIN_OOS}`);
  const pass = is.trades >= MIN_SAMPLE && oos.trades >= MIN_OOS && oos.netPct > 0 && oos.profitFactor > 1 && mc.zScore >= 1 && mc.observedAtOrAbovePct >= 95;
  if (!pass) warnings.push('Statistical gate not passed; live broadcast remains blocked');
  return { gateVersion: 'cloud-pro-statistical-gate-1', status: pass ? 'PASS' : 'BLOCKED', passed: pass, warnings };
}

async function main() {
  if (!fs.existsSync(HIST_DIR) && !/^(1|true|yes)$/i.test(process.env.BACKTEST_FETCH || '')) fs.mkdirSync(HIST_DIR, { recursive: true });
  const sentimentProvider = loadHistoricalSentimentProvider();
  const symbolReports = [];
  for (const symbol of SYMBOLS) {
    const dataset = await loadDataset(symbol);
    const all = dataset.data[CONFIG.baseInterval] || [], start = all[0]?.openTime || 0, end = all.at(-1)?.closeTime || 0, split = start + (end - start) * 0.7;
    if (!all.length) { symbolReports.push({ symbol: dataset.symbol, warning: 'No historical data' }); continue; }
    const isRun = runWindow(dataset, start, split, sentimentProvider), oosRun = runWindow(dataset, split, end, sentimentProvider);
    const is = metrics(isRun.trades), oos = metrics(oosRun.trades), mc = monteCarlo(oos.returns), correlation = correlationMatrix([...isRun.features, ...oosRun.features]);
    const gate = buildGate(is, oos, mc);
    const outOfSample = (EXPORT_TRADES || EXPORT_TRADE_DIAGNOSTICS) ? {
      ...oos,
      ...(EXPORT_TRADES ? { tradesDetailed: oosRun.trades.map(t => ({ symbol: t.symbol, entryTime: t.entryTime, exitTime: t.exitTime, netPct: t.netPct })) } : {}),
      ...(EXPORT_TRADE_DIAGNOSTICS ? { tradeDiagnostics: exportTradeDiagnostics(oosRun.trades) } : {})
    } : oos;
    const inSample = EXPORT_TRADE_DIAGNOSTICS ? { ...is, tradeDiagnostics: exportTradeDiagnostics(isRun.trades) } : is;
    symbolReports.push({ symbol: dataset.symbol, period: { start, split, end }, inSample, outOfSample, monteCarlo: mc, correlation, sentimentAudit: { inSample: isRun.sentimentAudit, outOfSample: oosRun.sentimentAudit }, decisionAudit: { inSample: isRun.decisionAudit, outOfSample: oosRun.decisionAudit }, gate, warnings: [...gate.warnings] });
    if (/^(1|true|yes)$/i.test(process.env.BACKTEST_FORCE_GC || '') && typeof global.gc === 'function') global.gc();
  }
  const valid = symbolReports.filter(r => r.gate), passed = valid.length > 0 && valid.every(r => r.gate.passed);
  const report = { generatedAt: new Date().toISOString(), strategy: 'MaYor Cloud Pro MTF', engineVersion: 'cloud-pro-mtf-2.0', assumptions: { entry: 'next base candle open', ambiguousCandle: 'SL first (conservative)', takerFeeRate: CONFIG.takerFeeRate, slippageRate: CONFIG.slippageRate, monteCarloRuns: MC_RUNS, sampleWarning: true, sentiment: sentimentProvider ? sentimentProvider.describe() : { mode: 'off', policy: 'No historical sentiment supplied; preserves the established baseline.' } }, symbols: symbolReports, gate: { gateVersion: 'cloud-pro-statistical-gate-1', status: passed ? 'PASS' : 'BLOCKED', passed, reason: passed ? 'all symbol gates passed' : 'one or more symbol gates blocked' } };
  fs.writeFileSync(REPORT_FILE, JSON.stringify(report, null, 2));
  const verification = { ...report.gate, generatedAt: report.generatedAt, engineVersion: report.engineVersion, monteCarlo: symbolReports.map(r => ({ symbol: r.symbol, ...(r.monteCarlo || {}) })), oos: symbolReports.map(r => { const { tradesDetailed, tradeDiagnostics, ...oos } = r.outOfSample || {}; return { symbol: r.symbol, ...oos }; }), warnings: symbolReports.flatMap(r => r.warnings || []) };
  fs.writeFileSync(VERIFICATION_FILE, JSON.stringify(verification, null, 2));
  console.log(JSON.stringify({ report: REPORT_FILE, verification: VERIFICATION_FILE, gate: report.gate, symbols: symbolReports.map(r => ({ symbol: r.symbol, isTrades: r.inSample?.trades || 0, oosTrades: r.outOfSample?.trades || 0, oosNetPct: r.outOfSample?.netPct || 0, zScore: r.monteCarlo?.zScore || 0 })) }, null, 2));
  return report;
}

if (require.main === module) main().catch(e => { console.error(`Backtest failed: ${e.stack || e.message}`); process.exitCode = 1; });

if (process.env.CLOUD_PRO_TEST === '1') module.exports = { loadDataset, fetchHistorical, validateHistoricalSeries, validateHistoricalCoverage, parseHistoricalSentiment, createHistoricalSentimentProvider, getMtfAt, runWindow, metrics, monteCarlo, correlationMatrix, buildGate };
