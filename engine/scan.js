/**
 * MaYor Cloud Pro MTF — نسخة موحّدة (Unified)
 * نظام بحثي/إشعاري فقط؛ لا ينفّذ أوامر تداول. GitHub Actions هو المحرك الوحيد.
 *
 * الخصائص:
 * - شموع مغلقة فقط، تطبيع OHLCV، ومنع lookahead/repainting.
 * - MTF: 5m / 15m / 1h / 4h مع تأكيد 1h و4h.
 * - كل مؤشرات v13 (EMA/MACD/RSI/FVG/Supertrend/Volume/Bollinger/StochRSI/Structure)
 *   + ATR/ADX بطريقة Wilder الصحيحة + Order Book Imbalance + إحساس السوق (Fear&Greed).
 * - 3 أنماط أوزان قابلة للاختيار (balanced/momentum/breakout) عبر STRATEGY_MODE —
 *   الافتراضي "balanced" يطابق تمامًا السلوك التاريخي قبل هذا الدمج.
 * - 37 زوجًا افتراضيًا (قابل للتضييق عبر SYMBOLS)، حارس سيولة وحجم تداول.
 * - إدارة مخاطر نظرية مع حجم متوافق مع LOT_SIZE/MIN_NOTIONAL الفعلية للبورصة، ورسوم/انزلاق.
 * - قواطع أمان اختيارية: حد خسارة يومية وحد سلسلة خسائر متتالية (معطّلة افتراضيًا).
 * - بوابة تحقق إحصائي قابلة للضبط: تمنع أو تحذّر عند عدم اجتياز data/verification.json
 *   (IS/OOS + Monte Carlo + مصفوفة ارتباط بتصحيح Bonferroni بين المؤشرات).
 * - Telegram محفوظ عبر TELEGRAM_TOKEN وTELEGRAM_CHAT كـ GitHub Secrets.
 */

'use strict';

const fs = require('fs');
const path = require('path');

const ENGINE_VERSION = 'cloud-pro-mtf-3.0-unified';
const TOKEN = process.env.TELEGRAM_TOKEN || '';
const CHAT = process.env.TELEGRAM_CHAT || '';
const SHEET_CSV_URL = process.env.SHEET_CSV_URL || '';
const DRY_RUN = /^(1|true|yes)$/i.test(process.env.DRY_RUN || '');
const VERIFICATION_GATE_MODE = (process.env.VERIFICATION_GATE_MODE || 'enforce').toLowerCase();
const BINANCE_ENDPOINTS = ['https://api.binance.com', 'https://data-api.binance.vision'];
// الكون الافتراضي موسّع لمطابقة تغطية v13 (37 زوجًا)؛ يظل قابلاً للتضييق عبر SYMBOLS
const DEFAULT_SYMBOLS = 'BTCUSDT,ETHUSDT,SOLUSDT,BNBUSDT,XRPUSDT,DOGEUSDT,ADAUSDT,AVAXUSDT,LINKUSDT,TONUSDT,' +
  'TRXUSDT,DOTUSDT,LTCUSDT,BCHUSDT,NEARUSDT,APTUSDT,ARBUSDT,OPUSDT,SUIUSDT,INJUSDT,' +
  'FILUSDT,ATOMUSDT,ICPUSDT,ETCUSDT,SEIUSDT,TIAUSDT,PEPEUSDT,WIFUSDT,SHIBUSDT,UNIUSDT,' +
  'AAVEUSDT,MKRUSDT,RUNEUSDT,GALAUSDT,SANDUSDT,AXSUSDT,IMXUSDT';
const SYMS = (process.env.SYMBOLS || DEFAULT_SYMBOLS)
  .split(',').map(s => s.trim().toUpperCase()).filter(Boolean);
const STRATEGY_MODE = (process.env.STRATEGY_MODE || 'balanced').toLowerCase();

const CONFIG = {
  maxSignalsPerDay: Number(process.env.MAX_SIGNALS_PER_DAY || 6),
  // إعداد إرسال فقط: لا يغيّر المؤشرات أو الفلاتر أو انتقاء v3.
  slotHours: Math.floor(Math.max(1, Math.min(24, Number(process.env.SIGNAL_SLOT_HOURS || 4)))),
  baseInterval: '15m',
  intervals: ['5m', '15m', '1h', '4h'],
  limits: { '5m': 300, '15m': 600, '1h': 300, '4h': 250 },
  frameWeights: { '5m': 1, '15m': 1.25, '1h': 1.5, '4h': 2 },
  minFrames: 3,
  minMtfPct: 65,
  minCorePct: 55,
  minAdx: 18,
  minAtrPct: 0.001,
  maxAtrPct: 0.08,
  minKlines: 55,
  minKlinesByFrame: { '5m': 55, '15m': 55, '1h': 120, '4h': 120 },
  volumeMultiplier: Number(process.env.VOLUME_MULTIPLIER || 1.3),
  minQuoteVolume24h: Number(process.env.MIN_QUOTE_VOLUME_24H || 5000000),
  signalCooldownMs: Number(process.env.SIGNAL_COOLDOWN_MINUTES || 60) * 60 * 1000,
  maxTradeAgeMs: 48 * 3600 * 1000,
  requestTimeoutMs: Number(process.env.REQUEST_TIMEOUT_MS || 12000),
  retries: Number(process.env.REQUEST_RETRIES || 3),
  minRequestGapMs: 120,
  maxPriceDecimals: 12,
  takerFeeRate: Number(process.env.TAKER_FEE_RATE || 0.0005),
  slippageRate: Number(process.env.SLIPPAGE_RATE || 0.0002),
  capital: Number(process.env.ACCOUNT_CAPITAL || 1000),
  riskPerTradePct: Number(process.env.RISK_PER_TRADE_PCT || 1),
  leverage: Number(process.env.LEVERAGE || 1),
  maxNotionalMultiple: Number(process.env.MAX_NOTIONAL_MULTIPLE || 1),
  minBacktestTrades: Number(process.env.MIN_BACKTEST_TRADES || 30),
  minOosTrades: Number(process.env.MIN_OOS_TRADES || 10),
  // قواطع الأمان (Circuit Breakers) — معطّلة افتراضيًا (0)؛ فعّلها عبر متغيرات البيئة
  maxDailyLossPct: Number(process.env.MAX_DAILY_LOSS_PCT || 0),
  maxLossStreak: Number(process.env.MAX_LOSS_STREAK || 0),
  // إحساس السوق (Fear & Greed) — مصدر تكميلي اختياري، لا يوقف البث لو فشل الجلب
  sentimentEnabled: !/^(0|false|no)$/i.test(process.env.SENTIMENT_ENABLED ?? '1'),
  sentimentCacheMs: 6 * 3600 * 1000,
  sentimentExtremeLow: 25,  // خوف شديد → ميل شرائي تعاكسي خفيف
  sentimentExtremeHigh: 75  // جشع شديد → ميل بيعي تعاكسي خفيف
};

// أوزان الأصوات — أنماط استراتيجية متعددة (v13) مع إبقاء "balanced" مطابقًا تمامًا
// للسلوك التاريخي الافتراضي حتى لا يُغيَّر أي شيء بدون اختيار صريح عبر STRATEGY_MODE.
// ملاحظة تحفّظية: بوابة التحقق الإحصائي لا تقارن بين الأنماط تلقائيًا؛ اختيار النمط
// قرار بشري واحد وقت النشر، وليس اختيارًا ديناميكيًا لكل صفقة — لتفادي مخاطر Overfitting.
const WEIGHT_PROFILES = {
  balanced: { trend: 1.5, macd: 1.5, rsi: 1.2, smc_fvg: 2, supertrend: 1.5,
    volume: 1.3, bollinger: 1, stochrsi: 1.2, structure: 1.3, taker_flow: 1, sentiment: 0.5 },
  momentum: { trend: 1.4, macd: 1.8, rsi: 1, smc_fvg: 1.6, supertrend: 2,
    volume: 1.8, bollinger: 0.6, stochrsi: 1, structure: 1, taker_flow: 1.4, sentiment: 0.4 },
  breakout: { trend: 1.2, macd: 1.1, rsi: 0.9, smc_fvg: 1.8, supertrend: 1.3,
    volume: 1.6, bollinger: 1.6, stochrsi: 0.8, structure: 2, taker_flow: 1, sentiment: 0.4 }
};
const WEIGHTS = WEIGHT_PROFILES[STRATEGY_MODE] || WEIGHT_PROFILES.balanced;
const TOTAL_VOTE_WEIGHT = Object.values(WEIGHTS).reduce((a, b) => a + b, 0);

const DATA_DIR = path.join(__dirname, '..', 'data');
const TRACKED_FILE = path.join(DATA_DIR, 'tracked.json');
const VERIFICATION_FILE = path.join(DATA_DIR, 'verification.json');
const pricePrecisionCache = new Map();
const lotSizeCache = new Map(); // symbol -> { stepSize, minQty, minNotional }
let nextRequestAt = 0;

if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });

function sleep(ms) { return new Promise(resolve => setTimeout(resolve, ms)); }
function finite(v, fallback = NaN) {
  if (v === null || v === undefined || v === '') return fallback;
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
}
function esc(v) { return String(v ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); }
function fmtDate(d = new Date()) { return d.toISOString().slice(0, 10); }
function fmtTime(d = new Date()) { return d.toLocaleTimeString('en-GB', { hour12: false, timeZone: 'Asia/Riyadh' }); }
function currentSlot(d = new Date()) { return Math.floor(d.getUTCHours() / CONFIG.slotHours); }
function round(v, digits = 3) { return Number(Number(v).toFixed(digits)); }
function clamp(v, lo, hi) { return Math.max(lo, Math.min(hi, v)); }

function loadTracked() {
  try {
    if (!fs.existsSync(TRACKED_FILE)) return [];
    const value = JSON.parse(fs.readFileSync(TRACKED_FILE, 'utf8'));
    return Array.isArray(value) ? value : [];
  } catch (e) {
    console.log(`تعذر قراءة tracked.json: ${e.message}`);
    return [];
  }
}
function saveTracked(arr) { fs.writeFileSync(TRACKED_FILE, JSON.stringify(arr, null, 2)); }

function loadVerification() {
  try {
    if (!fs.existsSync(VERIFICATION_FILE)) return { passed: false, status: 'BLOCKED', reason: 'verification-file-missing' };
    return JSON.parse(fs.readFileSync(VERIFICATION_FILE, 'utf8'));
  } catch (e) {
    return { passed: false, status: 'BLOCKED', reason: `verification-read-error:${e.message}` };
  }
}
function verificationPassed(v = loadVerification()) {
  return v && v.passed === true && v.status === 'PASS' && v.gateVersion === 'cloud-pro-statistical-gate-1';
}

async function requestJson(pathname, params = {}) {
  let lastError = null;
  for (const base of BINANCE_ENDPOINTS) {
    for (let attempt = 0; attempt <= CONFIG.retries; attempt++) {
      let timer;
      try {
        const now = Date.now();
        if (now < nextRequestAt) await sleep(nextRequestAt - now);
        nextRequestAt = Date.now() + CONFIG.minRequestGapMs;
        const url = new URL(`${base}${pathname}`);
        for (const [key, value] of Object.entries(params)) url.searchParams.set(key, String(value));
        const controller = new AbortController();
        timer = setTimeout(() => controller.abort(), CONFIG.requestTimeoutMs);
        const res = await fetch(url, { signal: controller.signal, headers: { 'user-agent': 'MaYor-Cloud-Pro/2.0' } });
        if (!res.ok) {
          const body = await res.text().catch(() => '');
          const error = new Error(`HTTP ${res.status} ${base} ${body.slice(0, 120)}`);
          error.status = res.status;
          throw error;
        }
        return await res.json();
      } catch (e) {
        lastError = e;
        const retryable = e.name === 'AbortError' || [418, 429, 500, 502, 503, 504].includes(e.status);
        if (retryable && attempt < CONFIG.retries) {
          const baseDelay = [418, 429].includes(e.status) ? 1200 : 500;
          const delay = Math.min(30000, baseDelay * (2 ** attempt) + Math.floor(Math.random() * 250));
          console.log(`طلب Binance فشل (${e.status || e.name || e.message})؛ إعادة بعد ${delay}ms`);
          await sleep(delay);
        } else if (attempt < CONFIG.retries) {
          await sleep(400 * (attempt + 1));
        }
      } finally {
        if (timer) clearTimeout(timer);
      }
    }
    console.log(`الانتقال إلى Binance endpoint البديل بعد فشل ${base}`);
  }
  throw lastError || new Error('Binance request failed');
}

function normalizeKlines(raw) {
  if (!Array.isArray(raw)) return [];
  return raw.map((k, i) => Array.isArray(k) ? ({
    openTime: finite(k[0], i), open: finite(k[1]), high: finite(k[2]), low: finite(k[3]),
    close: finite(k[4]), volume: finite(k[5]), closeTime: finite(k[6], i),
    takerBuyVolume: finite(k[9])
  }) : ({
    openTime: finite(k.openTime ?? k.time ?? k.timestamp, i), open: finite(k.open), high: finite(k.high),
    low: finite(k.low), close: finite(k.close), volume: finite(k.volume),
    closeTime: finite(k.closeTime ?? k.close_time, i), takerBuyVolume: finite(k.takerBuyVolume)
  })).sort((a, b) => a.openTime - b.openTime);
}

function prepareKlines(raw, min = CONFIG.minKlines, now = Date.now()) {
  const reasons = {};
  const reject = reason => { reasons[reason] = (reasons[reason] || 0) + 1; };
  const seen = new Set();
  const clean = [];
  for (const k of normalizeKlines(raw)) {
    if (!k || [k.openTime, k.closeTime, k.open, k.high, k.low, k.close, k.volume].some(v => !Number.isFinite(v))) {
      reject('invalid-number'); continue;
    }
    if (k.closeTime >= now) { reject('incomplete-candle'); continue; }
    if (k.open <= 0 || k.high <= 0 || k.low <= 0 || k.close <= 0 || k.volume < 0 ||
        k.high < Math.max(k.open, k.close) || k.low > Math.min(k.open, k.close) || k.low > k.high) {
      reject('invalid-ohlcv'); continue;
    }
    if (seen.has(k.openTime)) { reject('duplicate-candle'); continue; }
    seen.add(k.openTime); clean.push(k);
  }
  const rejected = Object.values(reasons).reduce((a, b) => a + b, 0);
  return { ok: clean.length >= min, klines: clean, accepted: clean.length, rejected, reasons,
    reason: clean.length >= min ? '' : `insufficient-closed-candles:${clean.length}/${min}` };
}

async function getKlines(symbol, interval, limit) {
  const raw = await requestJson('/api/v3/klines', { symbol, interval, limit });
  const prepared = prepareKlines(raw, CONFIG.minKlinesByFrame[interval] || CONFIG.minKlines);
  if (!prepared.ok) throw new Error(`${symbol} ${interval} ${prepared.reason}`);
  return prepared.klines;
}

async function get24hVolumeMap(symbols) {
  const data = await requestJson('/api/v3/ticker/24hr', { symbols: JSON.stringify(symbols) });
  const map = new Map();
  for (const t of Array.isArray(data) ? data : []) {
    map.set(t.symbol, { quoteVolume: finite(t.quoteVolume, 0), price: finite(t.lastPrice), changePct: finite(t.priceChangePercent, 0) });
  }
  return map;
}

async function getOrderBookImbalance(symbol, limit = 100) {
  try {
    const data = await requestJson('/api/v3/depth', { symbol, limit });
    let bidNotional = 0, askNotional = 0;
    for (const [price, qty] of data.bids || []) bidNotional += finite(price, 0) * finite(qty, 0);
    for (const [price, qty] of data.asks || []) askNotional += finite(price, 0) * finite(qty, 0);
    const total = bidNotional + askNotional;
    return total > 0 ? (bidNotional - askNotional) / total : null;
  } catch (e) {
    console.log(`Order Book غير متاح لـ ${symbol}: ${e.message}`);
    return null;
  }
}

let sentimentCache = { value: null, at: 0 };
async function getMarketSentiment() {
  if (!CONFIG.sentimentEnabled) return null;
  if (sentimentCache.value !== null && Date.now() - sentimentCache.at < CONFIG.sentimentCacheMs) return sentimentCache.value;
  try {
    const controller = new AbortController(), timer = setTimeout(() => controller.abort(), CONFIG.requestTimeoutMs);
    const res = await fetch('https://api.alternative.me/fng/?limit=1&format=json', { signal: controller.signal });
    clearTimeout(timer);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    const value = finite(data?.data?.[0]?.value, null);
    sentimentCache = { value: Number.isFinite(value) ? value : null, at: Date.now() };
    return sentimentCache.value;
  } catch (e) {
    console.log(`تعذر جلب مؤشر الخوف والجشع: ${e.message}`);
    return sentimentCache.value; // آخر قيمة معروفة إن وُجدت، وإلا null
  }
}

async function getTicker(symbol) {
  const data = await requestJson('/api/v3/ticker/price', { symbol });
  const price = finite(data?.price);
  if (!Number.isFinite(price)) throw new Error(`ticker-invalid:${symbol}`);
  return price;
}

function emaSeries(arr, period) {
  const out = new Array(arr.length).fill(null);
  const values = arr.map(v => finite(v));
  if (values.length < period || values.slice(0, period).some(v => !Number.isFinite(v))) return out;
  const k = 2 / (period + 1);
  out[period - 1] = values.slice(0, period).reduce((a, b) => a + b, 0) / period;
  for (let i = period; i < values.length; i++) out[i] = Number.isFinite(values[i]) ? values[i] * k + out[i - 1] * (1 - k) : null;
  return out;
}

function wilderSeries(arr, period) {
  const out = new Array(arr.length).fill(null);
  const values = arr.map(v => finite(v));
  const first = values.findIndex(v => Number.isFinite(v));
  if (first < 0) return out;
  const seedEnd = first + period;
  if (seedEnd > values.length || values.slice(first, seedEnd).some(v => !Number.isFinite(v))) return out;
  out[seedEnd - 1] = values.slice(first, seedEnd).reduce((a, b) => a + b, 0) / period;
  for (let i = seedEnd; i < values.length; i++) out[i] = Number.isFinite(values[i]) ? (out[i - 1] * (period - 1) + values[i]) / period : null;
  return out;
}

function alignedEma(values, period) {
  const out = new Array(values.length).fill(null);
  const compact = [], indexes = [];
  values.forEach((v, i) => { if (Number.isFinite(v)) { compact.push(v); indexes.push(i); } });
  const e = emaSeries(compact, period);
  e.forEach((v, i) => { if (v != null) out[indexes[i]] = v; });
  return out;
}

const Indicators = {
  ema(arr, period) { return emaSeries(arr, period); },
  wilder(arr, period) { return wilderSeries(arr, period); },
  rsiSeries(closes, period = 14) {
    const out = new Array(closes.length).fill(null);
    if (closes.length < period + 1) return out;
    const gains = new Array(closes.length).fill(null), losses = new Array(closes.length).fill(null);
    for (let i = 1; i < closes.length; i++) { const d = closes[i] - closes[i - 1]; gains[i] = Math.max(d, 0); losses[i] = Math.max(-d, 0); }
    const ag = wilderSeries(gains, period), al = wilderSeries(losses, period);
    for (let i = 0; i < closes.length; i++) {
      if (ag[i] == null || al[i] == null) continue;
      if (al[i] === 0) out[i] = 100; else out[i] = 100 - 100 / (1 + ag[i] / al[i]);
    }
    return out;
  },
  rsi(closes, period = 14) { const s = this.rsiSeries(closes, period); return s.at(-1) ?? 50; },
  macd(closes, fastPeriod = 12, slowPeriod = 26, signalPeriod = 9) {
    const fast = emaSeries(closes, fastPeriod), slow = emaSeries(closes, slowPeriod);
    const line = closes.map((_, i) => fast[i] != null && slow[i] != null ? fast[i] - slow[i] : null);
    const signalSeries = alignedEma(line, signalPeriod);
    const macdValue = line.at(-1) ?? 0, signalValue = signalSeries.at(-1) ?? 0;
    return { macd: macdValue, signal: signalValue, line, signalSeries, previousMacd: line.at(-2) ?? 0, previousSignal: signalSeries.at(-2) ?? 0 };
  },
  trueRange(h, l, c) {
    const tr = new Array(c.length).fill(null);
    for (let i = 1; i < c.length; i++) tr[i] = Math.max(h[i] - l[i], Math.abs(h[i] - c[i - 1]), Math.abs(l[i] - c[i - 1]));
    return tr;
  },
  atrSeries(h, l, c, period = 14) { return wilderSeries(this.trueRange(h, l, c), period); },
  atr(h, l, c, period = 14) { return this.atrSeries(h, l, c, period).at(-1) ?? NaN; },
  adx(h, l, c, period = 14) {
    const n = c.length;
    if (n < period * 2 + 1) return { adx: 0, pdi: 0, mdi: 0, adxSeries: [], pdiSeries: [], mdiSeries: [] };
    const tr = this.trueRange(h, l, c), plus = new Array(n).fill(null), minus = new Array(n).fill(null);
    for (let i = 1; i < n; i++) {
      const up = h[i] - h[i - 1], down = l[i - 1] - l[i];
      plus[i] = up > down && up > 0 ? up : 0; minus[i] = down > up && down > 0 ? down : 0;
    }
    const trSm = wilderSeries(tr, period), plusSm = wilderSeries(plus, period), minusSm = wilderSeries(minus, period);
    const pdiSeries = new Array(n).fill(null), mdiSeries = new Array(n).fill(null), dx = new Array(n).fill(null);
    for (let i = 0; i < n; i++) {
      if (!Number.isFinite(trSm[i]) || trSm[i] === 0) continue;
      pdiSeries[i] = 100 * plusSm[i] / trSm[i]; mdiSeries[i] = 100 * minusSm[i] / trSm[i];
      const den = pdiSeries[i] + mdiSeries[i]; dx[i] = den ? 100 * Math.abs(pdiSeries[i] - mdiSeries[i]) / den : 0;
    }
    const adxSeries = wilderSeries(dx, period);
    return { adx: adxSeries.at(-1) ?? 0, pdi: pdiSeries.at(-1) ?? 0, mdi: mdiSeries.at(-1) ?? 0, adxSeries, pdiSeries, mdiSeries };
  },
  supertrend(h, l, c, period = 10, multiplier = 3) {
    const atr = this.atrSeries(h, l, c, period), n = c.length;
    const upper = new Array(n).fill(null), lower = new Array(n).fill(null), direction = new Array(n).fill(null), line = new Array(n).fill(null);
    let start = atr.findIndex(v => Number.isFinite(v));
    if (start < 0) return { direction: 0, value: null, upper, lower, directions: direction, line };
    for (let i = start; i < n; i++) {
      const mid = (h[i] + l[i]) / 2, basicUpper = mid + multiplier * atr[i], basicLower = mid - multiplier * atr[i];
      if (i === start) { upper[i] = basicUpper; lower[i] = basicLower; direction[i] = 1; }
      else {
        upper[i] = basicUpper < upper[i - 1] || c[i - 1] > upper[i - 1] ? basicUpper : upper[i - 1];
        lower[i] = basicLower > lower[i - 1] || c[i - 1] < lower[i - 1] ? basicLower : lower[i - 1];
        if (direction[i - 1] === -1 && c[i] > upper[i - 1]) direction[i] = 1;
        else if (direction[i - 1] === 1 && c[i] < lower[i - 1]) direction[i] = -1;
        else direction[i] = direction[i - 1];
      }
      line[i] = direction[i] === 1 ? lower[i] : upper[i];
    }
    return { direction: direction.at(-1) ?? 0, value: line.at(-1) ?? null, upper, lower, directions: direction, line };
  },
  bollinger(c, period = 20, multiplier = 2) {
    if (c.length < period) return null;
    const sample = c.slice(-period), mid = sample.reduce((a, b) => a + b, 0) / period;
    const std = Math.sqrt(sample.reduce((a, b) => a + (b - mid) ** 2, 0) / period);
    return { upper: mid + multiplier * std, mid, lower: mid - multiplier * std };
  },
  stochRsi(c, period = 14, smooth = 3) {
    const rs = this.rsiSeries(c, period).filter(v => v !== null);
    if (rs.length < period + smooth) return { current: 50, prev: 50 };
    const ks = [];
    for (let i = period - 1; i < rs.length; i++) {
      const segment = rs.slice(i - period + 1, i + 1), min = Math.min(...segment), max = Math.max(...segment);
      ks.push(max === min ? 50 : (segment.at(-1) - min) / (max - min) * 100);
    }
    const cur = ks.slice(-smooth), prev = ks.slice(-smooth - 1, -1);
    return { current: cur.reduce((a, b) => a + b, 0) / cur.length, prev: prev.length ? prev.reduce((a, b) => a + b, 0) / prev.length : cur.at(-1) };
  },
  structure(h, l, c) {
    const period = 20;
    if (c.length < period + 1) return 0;
    const hi = Math.max(...h.slice(-period - 1, -1)), lo = Math.min(...l.slice(-period - 1, -1)), price = c.at(-1);
    return price >= hi * 0.999 ? 1 : price <= lo * 1.001 ? -1 : 0;
  },
  fvg(ks) {
    if (ks.length < 3) return null;
    const a = ks.at(-3), b = ks.at(-2), c = ks.at(-1);
    if (c.low > a.high && b.close > b.open) return 'bullish';
    if (c.high < a.low && b.close < b.open) return 'bearish';
    return null;
  }
};

const VOTE_PLUGINS = [
  { key: 'trend', vote: ind => ind.ema20 > ind.ema50 ? 1 : -1 },
  { key: 'macd', vote: ind => ind.macd.macd > ind.macd.signal ? 1 : -1 },
  { key: 'rsi', vote: ind => ind.rsi <= 40 ? 1 : ind.rsi >= 60 ? -1 : 0 },
  { key: 'smc_fvg', vote: ind => ind.fvg === 'bullish' ? 1 : ind.fvg === 'bearish' ? -1 : 0 },
  { key: 'supertrend', vote: ind => ind.supertrend.direction },
  { key: 'volume', vote: ind => ind.volume > CONFIG.volumeMultiplier ? (ind.ema20 > ind.ema50 ? 1 : -1) : 0 },
  { key: 'bollinger', vote: ind => ind.bb ? (ind.price >= ind.bb.upper ? 1 : ind.price <= ind.bb.lower ? -1 : 0) : 0 },
  { key: 'stochrsi', vote: ind => ind.stoch.current < 25 && ind.stoch.current > ind.stoch.prev ? 1 : ind.stoch.current > 75 && ind.stoch.current < ind.stoch.prev ? -1 : 0 },
  { key: 'structure', vote: ind => ind.structure },
  { key: 'taker_flow', vote: ind => ind.takerFlow == null ? 0 : ind.takerFlow > 0.55 ? 1 : ind.takerFlow < 0.45 ? -1 : 0 },
  // إحساس السوق (Fear & Greed): إشارة تعاكسية خفيفة عند التطرف فقط؛ محايدة فيما عداه
  { key: 'sentiment', vote: ind => !Number.isFinite(ind.sentiment) ? 0 :
      ind.sentiment <= CONFIG.sentimentExtremeLow ? 1 : ind.sentiment >= CONFIG.sentimentExtremeHigh ? -1 : 0 }
];

function analyzeLatest(symbol, ks, extra = {}) {
  const prepared = extra.skipSanitize ? { ok: true, klines: normalizeKlines(ks) } : prepareKlines(ks, extra.minKlines || CONFIG.minKlines, extra.now || Date.now());
  const a = prepared.klines;
  if (!prepared.ok || a.length < (extra.minKlines || CONFIG.minKlines)) return { signal: null, indicators: null, reason: prepared.reason || 'insufficient-candles' };
  const c = a.map(k => k.close), h = a.map(k => k.high), l = a.map(k => k.low), v = a.map(k => k.volume);
  const price = c.at(-1), ema20 = Indicators.ema(c, 20).at(-1), ema50 = Indicators.ema(c, 50).at(-1);
  const adx = Indicators.adx(h, l, c), avgVolume = v.slice(-20).reduce((x, y) => x + y, 0) / Math.min(20, v.length);
  const win = Math.min(10, a.length); let buySum = 0, volumeSum = 0;
  for (let i = a.length - win; i < a.length; i++) if (Number.isFinite(a[i].takerBuyVolume) && a[i].volume > 0) { buySum += a[i].takerBuyVolume; volumeSum += a[i].volume; }
  const ind = {
    price, ema20, ema50, macd: Indicators.macd(c), rsi: Indicators.rsi(c), atr: Indicators.atr(h, l, c),
    adx: adx.adx, pdi: adx.pdi, mdi: adx.mdi, fvg: Indicators.fvg(a), supertrend: Indicators.supertrend(h, l, c),
    volume: avgVolume ? v.at(-1) / avgVolume : 0, bb: Indicators.bollinger(c), stoch: Indicators.stochRsi(c),
    structure: Indicators.structure(h, l, c), takerFlow: volumeSum > 0 ? buySum / volumeSum : null,
    obImbalance: extra.obImbalance ?? null, sentiment: Number.isFinite(extra.sentiment) ? extra.sentiment : null
  };
  const atrPct = price > 0 ? ind.atr / price : 0;
  if (!Number.isFinite(ind.atr) || atrPct < CONFIG.minAtrPct || atrPct > CONFIG.maxAtrPct) return { signal: null, indicators: ind, reason: 'atr-guard' };
  if (!Number.isFinite(ind.adx) || ind.adx < CONFIG.minAdx) return { signal: null, indicators: ind, reason: 'adx-guard' };
  const votes = Object.fromEntries(VOTE_PLUGINS.map(p => [p.key, p.vote(ind)]));
  let sum = 0;
  for (const p of VOTE_PLUGINS) sum += votes[p.key] * (WEIGHTS[p.key] || 1);
  if (!sum) return { signal: null, indicators: ind, votes, reason: 'no-consensus' };
  const dir = sum > 0 ? 'LONG' : 'SHORT';
  const diOk = dir === 'LONG' ? ind.pdi > ind.mdi : ind.mdi > ind.pdi;
  const corePct = Math.abs(sum) / TOTAL_VOTE_WEIGHT * 100;
  if (!diOk) return { signal: null, indicators: ind, votes, corePct, reason: 'di-guard' };
  if (corePct < CONFIG.minCorePct) return { signal: null, indicators: ind, votes, corePct, reason: 'core-threshold' };
  const filters = [`ADX ${ind.adx.toFixed(1)}`, `DI ${dir === 'LONG' ? '+DI' : '-DI'}`, `CORE ${corePct.toFixed(1)}%`];
  for (const p of VOTE_PLUGINS) if (votes[p.key] && Math.sign(votes[p.key]) === Math.sign(sum)) filters.push(p.key.toUpperCase());
  if (Number.isFinite(ind.obImbalance)) {
    const obDir = ind.obImbalance > 0.15 ? 'LONG' : ind.obImbalance < -0.15 ? 'SHORT' : null;
    if (obDir === dir) filters.push('ORDERBOOK ✓');
  }
  return {
    signal: { symbol, dir, price, atr: ind.atr, atrPct, adx: ind.adx, pdi: ind.pdi, mdi: ind.mdi,
      corePct: round(corePct, 1), filters, closedCandle: a.at(-1).openTime },
    indicators: ind, votes, corePct
  };
}

function levelsFromSignal(s) {
  const distance = s.atr * 1.5;
  const sl = s.dir === 'LONG' ? s.price - distance : s.price + distance;
  const tp1 = s.dir === 'LONG' ? s.price + distance : s.price - distance;
  const tp2 = s.dir === 'LONG' ? s.price + distance * 2 : s.price - distance * 2;
  const tp3 = s.dir === 'LONG' ? s.price + distance * 3 : s.price - distance * 3;
  const risk = Math.abs(s.price - sl), reward = Math.abs(tp3 - s.price);
  if ([s.price, s.atr, sl, tp1, tp2, tp3].some(v => !Number.isFinite(v) || v <= 0) || !risk || reward / risk < 2.5) return null;
  return { ...s, sl, tp1, tp2, tp3, rr: round(reward / risk, 2) };
}

function calculatePositionSize(signal, cfg = CONFIG) {
  const entry = finite(signal.price), stopDistance = Math.abs(entry - finite(signal.sl));
  if (!(entry > 0 && stopDistance > 0 && cfg.capital > 0 && cfg.riskPerTradePct > 0 && cfg.leverage > 0)) return null;
  const riskCapital = cfg.capital * cfg.riskPerTradePct / 100;
  const riskFraction = stopDistance / entry;
  const notionalByRisk = riskCapital / riskFraction;
  const maxNotional = cfg.capital * cfg.leverage * cfg.maxNotionalMultiple;
  const positionNotional = Math.min(notionalByRisk, maxNotional);
  const quantity = positionNotional / entry;
  return {
    capital: round(cfg.capital, 2), riskPct: cfg.riskPerTradePct, riskCapital: round(riskCapital, 2),
    leverage: cfg.leverage, stopDistancePct: round(riskFraction * 100, 4),
    notional: round(positionNotional, 2), margin: round(positionNotional / cfg.leverage, 2), quantity: round(quantity, 8),
    maxLossBeforeCosts: round(positionNotional * riskFraction, 2)
  };
}

async function getMTFAnalysis(symbol, liquidity24h, sentiment = null) {
  const frames = {};
  const fetched = await Promise.all(CONFIG.intervals.map(async interval => {
    try {
      const klines = await getKlines(symbol, interval, CONFIG.limits[interval]);
      const depth = interval === CONFIG.baseInterval ? await getOrderBookImbalance(symbol) : null;
      return [interval, { klines, ...analyzeLatest(symbol, klines, { obImbalance: depth, sentiment, minKlines: CONFIG.minKlinesByFrame[interval] }) }];
    } catch (e) {
      console.log(`${symbol} ${interval}: ${e.message}`); return [interval, null];
    }
  }));
  for (const [interval, result] of fetched) if (result) frames[interval] = result;
  const valid = CONFIG.intervals.filter(tf => frames[tf]?.signal);
  if (valid.length < CONFIG.minFrames) return { ok: false, reason: `mtf-frames:${valid.length}/${CONFIG.minFrames}`, frames };
  const longWeight = valid.filter(tf => frames[tf].signal.dir === 'LONG').reduce((s, tf) => s + CONFIG.frameWeights[tf], 0);
  const shortWeight = valid.filter(tf => frames[tf].signal.dir === 'SHORT').reduce((s, tf) => s + CONFIG.frameWeights[tf], 0);
  const totalWeight = longWeight + shortWeight, dir = longWeight >= shortWeight ? 'LONG' : 'SHORT';
  const winningWeight = dir === 'LONG' ? longWeight : shortWeight, mtfPct = totalWeight ? winningWeight / totalWeight * 100 : 0;
  if (mtfPct < CONFIG.minMtfPct) return { ok: false, reason: `mtf-threshold:${mtfPct.toFixed(1)}%`, frames, valid, mtfPct };
  if (!frames['1h']?.signal || !frames['4h']?.signal || frames['1h'].signal.dir !== dir || frames['4h'].signal.dir !== dir)
    return { ok: false, reason: 'higher-timeframe-conflict', frames, valid, mtfPct };
  if (!frames[CONFIG.baseInterval]?.signal || frames[CONFIG.baseInterval].signal.dir !== dir)
    return { ok: false, reason: 'base-frame-conflict', frames, valid, mtfPct };
  const base = frames[CONFIG.baseInterval];
  const finalSignal = levelsFromSignal({ ...base.signal, liquidity24h, mtfPct: round(mtfPct, 1), mtfFrames: valid,
    votesByTf: valid.map(tf => `${tf}→${frames[tf].signal.dir}`), rsi4h: frames['4h'].indicators?.rsi ?? null,
    adx4h: frames['4h'].signal.adx, sentiment: Number.isFinite(sentiment) ? sentiment : null,
    filters: [...base.signal.filters, `MTF ${mtfPct.toFixed(1)}%`] });
  if (!finalSignal) return { ok: false, reason: 'invalid-levels', frames, valid, mtfPct };
  finalSignal.position = calculatePositionSize(finalSignal);
  return { ok: true, signal: finalSignal, frames, valid, mtfPct };
}

function fallbackPriceDecimals(price) {
  const p = Math.abs(Number(price));
  if (!Number.isFinite(p) || p === 0) return 6;
  if (p >= 1000) return 2; if (p >= 100) return 3; if (p >= 1) return 4;
  if (p >= 0.1) return 5; if (p >= 0.01) return 6; return 8;
}
function formatPrice(price, symbol) {
  const n = finite(price); if (!Number.isFinite(n)) return '—';
  return n.toFixed(Math.min(CONFIG.maxPriceDecimals, pricePrecisionCache.get(symbol) ?? fallbackPriceDecimals(n)));
}
async function loadPricePrecision(symbol) {
  if (pricePrecisionCache.has(symbol)) return pricePrecisionCache.get(symbol);
  try {
    const data = await requestJson('/api/v3/exchangeInfo', { symbol });
    const filters = data.symbols?.[0]?.filters || [];
    const priceFilter = filters.find(f => f.filterType === 'PRICE_FILTER');
    const tick = String(priceFilter?.tickSize || '');
    const decimals = tick.includes('.') ? tick.split('.')[1].replace(/0+$/, '').length : 0;
    pricePrecisionCache.set(symbol, decimals);
    const lotFilter = filters.find(f => f.filterType === 'LOT_SIZE');
    const notionalFilter = filters.find(f => f.filterType === 'MIN_NOTIONAL' || f.filterType === 'NOTIONAL');
    lotSizeCache.set(symbol, {
      stepSize: finite(lotFilter?.stepSize, null), minQty: finite(lotFilter?.minQty, null),
      minNotional: finite(notionalFilter?.minNotional ?? notionalFilter?.minNotionalValue, null)
    });
    return decimals;
  } catch (e) { console.log(`تعذر دقة السعر ${symbol}: ${e.message}`); return null; }
}
function roundDownToStep(qty, step) {
  if (!(step > 0)) return qty;
  const decimals = String(step).includes('.') ? String(step).split('.')[1].replace(/0+$/, '').length : 0;
  return Number((Math.floor(qty / step) * step).toFixed(decimals));
}
// يُعيد تطبيق حدود البورصة الحقيقية (LOT_SIZE / MIN_NOTIONAL) على حجم نظري محسوب سلفًا،
// بدون أي تنفيذ فعلي — فقط ليعكس رقمًا واقعيًا أقرب للتطبيق في السجل والرسالة.
function applyExchangeLotSizing(position, symbol, entryPrice) {
  const lot = lotSizeCache.get(symbol);
  if (!position || !lot || !(entryPrice > 0)) return position;
  const adjusted = { ...position, quantity: position.quantity };
  if (lot.stepSize > 0) adjusted.quantity = roundDownToStep(adjusted.quantity, lot.stepSize);
  if (lot.minQty > 0 && adjusted.quantity < lot.minQty) adjusted.quantity = lot.minQty;
  adjusted.notional = round(adjusted.quantity * entryPrice, 2);
  adjusted.margin = round(adjusted.notional / (position.leverage || 1), 2);
  adjusted.belowExchangeMinNotional = lot.minNotional > 0 ? adjusted.notional < lot.minNotional : false;
  adjusted.exchangeMinNotional = lot.minNotional > 0 ? lot.minNotional : null;
  return adjusted;
}

function entryFillPrice(raw, dir, cfg = CONFIG) { return raw * (dir === 'LONG' ? 1 + cfg.slippageRate : 1 - cfg.slippageRate); }
function exitFillPrice(raw, dir, cfg = CONFIG) { return raw * (dir === 'LONG' ? 1 - cfg.slippageRate : 1 + cfg.slippageRate); }
function netPnl(rawEntry, rawExit, dir, cfg = CONFIG) {
  const entryFill = entryFillPrice(rawEntry, dir, cfg), exitFill = exitFillPrice(rawExit, dir, cfg);
  const sign = dir === 'LONG' ? 1 : -1;
  const grossPct = sign * (exitFill - entryFill) / entryFill * 100;
  const feesPct = cfg.takerFeeRate * 2 * 100;
  return { entryFill, exitFill, grossPct, feesPct, netPct: grossPct - feesPct };
}

async function send(message) {
  if (!TOKEN) { console.log('Telegram غير مفعل: TELEGRAM_TOKEN مفقود'); return false; }
  try {
    const controller = new AbortController(), timer = setTimeout(() => controller.abort(), CONFIG.requestTimeoutMs);
    const res = await fetch(`https://api.telegram.org/bot${TOKEN}/sendMessage`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, signal: controller.signal,
      body: JSON.stringify({ chat_id: CHAT, text: message, parse_mode: 'HTML' })
    });
    clearTimeout(timer);
    if (!res.ok) { console.log(`Telegram HTTP ${res.status}: ${await res.text()}`); return false; }
    console.log('✓ أُرسلت رسالة Telegram'); return true;
  } catch (e) { console.log(`Telegram error: ${e.message}`); return false; }
}

async function checkOpenTrades() {
  const tracked = loadTracked(), open = tracked.filter(t => !t.closed);
  if (!open.length) { console.log('لا صفقات مفتوحة للمتابعة'); return; }
  const prices = new Map();
  for (const trade of open) { try { prices.set(trade.symbol, await getTicker(trade.symbol)); } catch (e) { console.log(`تعذر سعر ${trade.symbol}: ${e.message}`); } }
  let closedCount = 0;
  for (const trade of open) {
    const price = prices.get(trade.symbol); if (!Number.isFinite(price)) continue;
    const sign = trade.dir === 'LONG' ? 1 : -1;
    const slHit = sign === 1 ? price <= trade.sl : price >= trade.sl;
    const tp1Hit = sign === 1 ? price >= trade.tp1 : price <= trade.tp1;
    const tp2Hit = sign === 1 ? price >= trade.tp2 : price <= trade.tp2;
    const tp3Hit = sign === 1 ? price >= trade.tp3 : price <= trade.tp3;
    const expired = Date.now() - Number(trade.ts || 0) > CONFIG.maxTradeAgeMs;
    let result = null;
    if (slHit) result = 'SL'; else if (tp3Hit) result = 'TP3'; else if (tp2Hit) result = 'TP2'; else if (tp1Hit) result = 'TP1'; else if (expired) result = 'انتهت المدة';
    if (!result) continue;
    const calc = netPnl(trade.price, price, trade.dir);
    trade.closed = true; trade.closePrice = price; trade.closeResult = result;
    trade.entryFillPrice = trade.entryFillPrice || calc.entryFill; trade.exitFillPrice = calc.exitFill;
    trade.grossPnlPct = round(calc.grossPct, 4); trade.feesPct = round(calc.feesPct, 4); trade.slippagePct = round(CONFIG.slippageRate * 2 * 100, 4);
    trade.closePct = round(calc.netPct, 4); trade.netPnlUsd = trade.position?.notional ? round(trade.position.notional * calc.netPct / 100, 4) : null;
    trade.closeAt = new Date().toISOString(); closedCount++;
    const outcome = result === 'SL' ? '⛔ ضرب وقف الخسارة' : result.startsWith('TP') ? `✅ أصابت ${result}` : '⏱️ انتهت مدة الإشارة (48 ساعة)';
    const msg = `🚨 <b>إغلاق صفقة — ${esc(trade.symbol)}</b> 🚨\n\n` +
      `📈 الاتجاه: ${trade.dir === 'LONG' ? 'شراء 🟢' : 'بيع 🔴'}\n${outcome}\n\n` +
      `💰 سعر الدخول: <code>${formatPrice(trade.price, trade.symbol)}</code>\n` +
      `🏁 سعر الإغلاق: <code>${formatPrice(price, trade.symbol)}</code>\n\n` +
      `📊 الإجمالي: <b>${trade.grossPnlPct >= 0 ? '+' : ''}${trade.grossPnlPct}%</b>\n` +
      `💳 الرسوم والانزلاق: <b>-${trade.feesPct + trade.slippagePct}%</b>\n` +
      `✅ الصافي: <b>${trade.closePct >= 0 ? '+' : ''}${trade.closePct}%</b>\n⏰ ${fmtTime()}`;
    await send(msg); console.log(`إغلاق ${trade.symbol}: ${result} net=${trade.closePct}%`);
  }
  if (closedCount) saveTracked(tracked);
  console.log(`متابعة الصفقات: أُغلق ${closedCount} | مفتوحة ${tracked.filter(t => !t.closed).length}`);
}

const BREAKER_FILE = path.join(DATA_DIR, 'circuit_breaker.json');
function loadBreakerState() {
  try { return fs.existsSync(BREAKER_FILE) ? JSON.parse(fs.readFileSync(BREAKER_FILE, 'utf8')) : {}; }
  catch { return {}; }
}
function saveBreakerState(state) { fs.writeFileSync(BREAKER_FILE, JSON.stringify(state, null, 2)); }

// قاطع أمان يوقف بث إشارات جديدة (لا يوقف متابعة الصفقات المفتوحة) عند تجاوز حدود
// الخسارة اليومية أو سلسلة خسائر متتالية. معطّل افتراضيًا (القيم = 0 في CONFIG).
function checkCircuitBreaker(tracked, today) {
  const state = loadBreakerState();
  const closedToday = tracked.filter(t => t.closed && t.closeAt && t.closeAt.slice(0, 10) === today);
  const dailyPnl = closedToday.reduce((s, t) => s + (typeof t.closePct === 'number' ? t.closePct : 0), 0);
  if (CONFIG.maxDailyLossPct > 0 && dailyPnl <= -Math.abs(CONFIG.maxDailyLossPct)) {
    const reason = `خسارة يومية ${dailyPnl.toFixed(2)}% تجاوزت الحد ${CONFIG.maxDailyLossPct}%`;
    const already = state.lastReason === reason && state.lastDate === today;
    if (!already) saveBreakerState({ lastReason: reason, lastDate: today });
    return { tripped: true, reason, alreadyNotified: already };
  }
  if (CONFIG.maxLossStreak > 0) {
    const closedSorted = tracked.filter(t => t.closed && t.closeAt).sort((a, b) => b.closeAt.localeCompare(a.closeAt));
    let streak = 0;
    for (const t of closedSorted) { if (typeof t.closePct === 'number' && t.closePct < 0) streak++; else break; }
    if (streak >= CONFIG.maxLossStreak) {
      const reason = `سلسلة ${streak} خسائر متتالية بلغت الحد ${CONFIG.maxLossStreak}`;
      const already = state.lastReason === reason && state.lastDate === today;
      if (!already) saveBreakerState({ lastReason: reason, lastDate: today });
      return { tripped: true, reason, alreadyNotified: already };
    }
  }
  if (state.lastReason) saveBreakerState({}); // تعافى القاطع — امسح الحالة
  return { tripped: false };
}
function buildBreakerMessage(breaker) {
  return `🛑 <b>قاطع الأمان فعّال</b> 🛑\n\nتم إيقاف بث إشارات جديدة مؤقتًا.\nالسبب: ${esc(breaker.reason)}\n\n` +
    `الصفقات المفتوحة تظل تحت المتابعة والإغلاق التلقائي كالمعتاد.\n⏰ ${fmtTime()}`;
}

function canEmit(tracked, signal) {
  const last = tracked.filter(t => t.symbol === signal.symbol && t.dir === signal.dir).sort((a, b) => Number(b.ts || 0) - Number(a.ts || 0))[0];
  if (last && Date.now() - Number(last.ts || 0) < CONFIG.signalCooldownMs)
    return { ok: false, reason: `cooldown-${Math.ceil((CONFIG.signalCooldownMs - (Date.now() - Number(last.ts))) / 60000)}m` };
  return { ok: true };
}

function buildSignalMessage(s) {
  const direction = s.dir === 'LONG' ? 'شراء 🟢' : 'بيع 🔴';
  const frames = s.votesByTf?.join(' | ') || '—';
  const pos = s.position;
  return `🚨 <b>إشارة ${s.dir === 'LONG' ? 'Long' : 'Short'}</b> 🚨\n\n` +
    `الزوج: <b>${esc(s.symbol)}</b>\n🏷️ النوع: كريبتو 🪙\n📈 الاتجاه: ${direction}\n` +
    `💰 سعر الدخول: <code>${formatPrice(s.price, s.symbol)}</code>\n\n` +
    `🛑 وقف الخسارة (SL): <code>${formatPrice(s.sl, s.symbol)}</code>\n` +
    `🎯 الهدف الأول (TP1): <code>${formatPrice(s.tp1, s.symbol)}</code>\n` +
    `🎯 الهدف الثاني (TP2): <code>${formatPrice(s.tp2, s.symbol)}</code>\n` +
    `🎯 الهدف الثالث (TP3): <code>${formatPrice(s.tp3, s.symbol)}</code>\n` +
    `⚖️ المخاطرة/العائد: <b>1 : ${s.rr.toFixed(1)}</b>\n\n` +
    `🔥 قوة الإطار الأساسي: <b>${s.corePct.toFixed(1)}%</b>\n🧭 إجماع MTF: <b>${s.mtfPct.toFixed(1)}%</b>\n` +
    `💧 حجم 24h: <b>$${Math.round(s.liquidity24h).toLocaleString('en-US')}</b>\n📌 الأطر: ${frames}\n` +
    `📊 RSI 4H: <b>${Number.isFinite(s.rsi4h) ? s.rsi4h.toFixed(1) : '—'}</b>\n` +
    (pos ? `📐 حجم نظري: <b>${pos.quantity}</b> | هامش: <b>$${pos.margin}</b> | مخاطرة: <b>$${pos.riskCapital}</b>` +
      (pos.belowExchangeMinNotional ? ' ⚠️ أقل من حد المنصة الأدنى' : '') + `\n` : '') +
    (Number.isFinite(s.sentiment) ? `🌡️ الخوف والجشع: <b>${s.sentiment}</b>\n` : '') +
    `🎛️ النمط: <code>${esc(STRATEGY_MODE)}</code>\n` +
    `🔍 ${s.filters.join(' | ')}\n⏰ ${fmtTime()}`;
}

async function appendToSheet(values) {
  if (!SHEET_CSV_URL) return;
  try {
    const controller = new AbortController(), timer = setTimeout(() => controller.abort(), CONFIG.requestTimeoutMs);
    const res = await fetch(SHEET_CSV_URL, { method: 'POST', headers: { 'Content-Type': 'text/csv' }, signal: controller.signal, body: `${values.join(',')}\n` });
    clearTimeout(timer); console.log(res.ok ? '✓ أُضيف الصف إلى Sheet' : `Sheet HTTP ${res.status}`);
  } catch (e) { console.log(`تعذر Sheet: ${e.message}`); }
}

async function evaluate(symbol, liquidity24h, sentiment) {
  if (!Number.isFinite(liquidity24h) || liquidity24h < CONFIG.minQuoteVolume24h) return { ok: false, reason: 'liquidity-guard' };
  return getMTFAnalysis(symbol, liquidity24h, sentiment);
}

async function scan() {
  const today = fmtDate();
  await checkOpenTrades();
  const verification = loadVerification();
  if (!verificationPassed(verification)) {
    const reason = verification.reason || verification.status || 'not-passed';
    if (VERIFICATION_GATE_MODE === 'warn') {
      console.warn(`تحذير بوابة التحقق: ${reason} — يستمر المسح وفق وضع warn`);
    } else {
      console.log(`البث الحي محجوب ببوابة التحقق: ${reason}`);
      return;
    }
  }
  let tracked = loadTracked();
  const breaker = checkCircuitBreaker(tracked, today);
  if (breaker.tripped) {
    console.log(`قاطع الأمان فعّال: ${breaker.reason} — لا إشارات جديدة اليوم`);
    if (!breaker.alreadyNotified) await send(buildBreakerMessage(breaker));
    return;
  }
  const todayCount = tracked.filter(t => t.date === today).length;
  const slotUsed = tracked.some(t => t.date === today && t.slot === currentSlot());
  if (slotUsed) { console.log(`النافذة ${currentSlot()} مستخدمة — لا إشارة جديدة`); return; }
  if (todayCount >= CONFIG.maxSignalsPerDay) { console.log('تم بلوغ حد الإشارات اليومية'); return; }
  console.log(`بدء ${ENGINE_VERSION} [${STRATEGY_MODE}] — ${SYMS.length} أزواج — ${new Date().toISOString()}`);
  let volumeMap;
  try { volumeMap = await get24hVolumeMap(SYMS); } catch (e) { console.log(`فشل حارس السيولة: ${e.message}`); return; }
  const eligible = SYMS.filter(symbol => finite(volumeMap.get(symbol)?.quoteVolume, 0) >= CONFIG.minQuoteVolume24h);
  console.log(`السيولة: ${eligible.length}/${SYMS.length} أزواج مؤهلة بحد $${CONFIG.minQuoteVolume24h.toLocaleString('en-US')}`);
  const sentiment = await getMarketSentiment();
  if (sentiment !== null) console.log(`مؤشر الخوف والجشع: ${sentiment}`);
  const results = await Promise.all(eligible.map(async symbol => {
    try { return { symbol, ...(await evaluate(symbol, volumeMap.get(symbol).quoteVolume, sentiment)) }; }
    catch (e) { console.log(`فشل تقييم ${symbol}: ${e.message}`); return { symbol, ok: false, reason: 'evaluation-error' }; }
  }));
  const candidates = results.filter(r => r.ok && r.signal).map(r => r.signal)
    .filter(s => !tracked.some(t => t.date === today && t.symbol === s.symbol))
    .sort((a, b) => b.mtfPct - a.mtfPct || b.corePct - a.corePct || b.liquidity24h - a.liquidity24h);
  const chosen = candidates[0];
  if (!chosen) { console.log('لا توجد إشارة تستوفي قواعد Cloud Pro MTF في هذه الدورة'); return; }
  const cd = canEmit(tracked, chosen);
  if (!cd.ok) { console.log(`مرفوض ${chosen.symbol}: ${cd.reason}`); return; }
  await loadPricePrecision(chosen.symbol);
  const rawPosition = chosen.position || calculatePositionSize(chosen);
  const position = applyExchangeLotSizing(rawPosition, chosen.symbol, chosen.price);
  const record = { ...chosen, position, engineVersion: ENGINE_VERSION, strategyMode: STRATEGY_MODE,
    feeRate: CONFIG.takerFeeRate, slippageRate: CONFIG.slippageRate,
    date: today, ts: Date.now(), slot: currentSlot(), closed: false, entryFillPrice: entryFillPrice(chosen.price, chosen.dir) };
  if (DRY_RUN) { console.log(`DRY_RUN: مرشح ${record.dir} ${record.symbol} | MTF ${record.mtfPct}% | Core ${record.corePct}% | RR 1:${record.rr}`); console.log(buildSignalMessage(record)); return; }
  tracked.push(record); saveTracked(tracked); await send(buildSignalMessage(record));
  await appendToSheet([tracked.filter(t => t.date === today).length, today, fmtTime(), record.symbol, record.dir, record.price, record.sl, record.tp1, record.tp2, record.tp3, '', 'مفتوحة', '', 'مفتوحة', record.position?.quantity || '', record.position?.notional || '', record.engineVersion]);
  console.log(`✓ إشارة ${record.dir} ${record.symbol} | MTF ${record.mtfPct}% | Core ${record.corePct}% | RR 1:${record.rr}`);
}

if (process.env.CLOUD_PRO_TEST === '1' || require.main !== module) {
  module.exports = {
    CONFIG, WEIGHTS, WEIGHT_PROFILES, STRATEGY_MODE, TOTAL_VOTE_WEIGHT, Indicators, VOTE_PLUGINS, normalizeKlines, prepareKlines,
    getKlines, get24hVolumeMap, getOrderBookImbalance, getMarketSentiment, analyzeLatest, levelsFromSignal, calculatePositionSize,
    applyExchangeLotSizing, roundDownToStep, checkCircuitBreaker, entryFillPrice, exitFillPrice, netPnl,
    getMTFAnalysis, canEmit, buildSignalMessage, loadVerification, verificationPassed
  };
} else {
  scan().catch(e => { console.error(`خطأ فادح: ${e.stack || e.message}`); process.exitCode = 1; });
}
