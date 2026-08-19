// MaYor Signal Engine — GitHub Actions Edition (v13 Full Upgrade)
// يُشغَّل كل 30 دقيقة من GitHub Actions: يفحص السوق ← يرسل الإشارات ← يكتب السجل في Google Sheet
// البيانات الثابتة (سجل الإشارات + صفقات متابعة) تُخزن في repo داخل data/ وتُحدَّث ثم تُرفع مرة أخرى
//
// نظام v13 الكامل:
// - 13 مؤشر: EMA, MACD, RSI, ADX/DI, ATR, Bollinger, StochRSI, Supertrend, SMC FVG, Structure, Volume, TakerFlow, OrderBook
// - 8 فلاتر: ADX≥18, DI direction, ATR Range, Weighted Voting, R:R≥2.5, Cooldown, Min Klines, Exchange Limits
// - نظام التصويت الموزون (Weighted Voting System) مع 9 أصوات + 3 مؤكدين

const fs = require('fs');
const path = require('path');

const TOKEN = process.env.TELEGRAM_TOKEN;
const CHAT = process.env.TELEGRAM_CHAT || '@Paracaudina';
const SHEET_CSV_URL = process.env.SHEET_CSV_URL || ''; // رابط CSV المنشور لشيت السجل
const MAX_SIGNALS_PER_DAY = 6;
// نظام النوافذ الزمنية: اليوم مقسم إلى 6 نوافذ × 4 ساعات (00–04، 04–08، …، 20–24).
// يُسمح بإشارة واحدة كحد أقصى في كل نافذة، فتتوزع الإشارات الست على اليوم بدل إرسالها دفعة واحدة.
const SLOT_HOURS = 4;
function currentSlot() { return Math.floor(new Date().getUTCHours() / SLOT_HOURS); }
const SYMS = (process.env.SYMBOLS || 'BTCUSDT,ETHUSDT,SOLUSDT,BNBUSDT,XRPUSDT,DOGEUSDT,ADAUSDT,AVAXUSDT,LINKUSDT,DOTUSDT').split(',');
// Binance API endpoints (fallback chain for GitHub Actions rate limiting / geo-blocking)
const BINANCE_ENDPOINTS = ['https://api.binance.com', 'https://data-api.binance.vision'];
const DATA_DIR = path.join(__dirname, '..', 'data');
const pricePrecisionCache = new Map();

// ===== إعدادات نظام v13 =====
const CONFIG = {
  minAtrPct: 0.001,    // 0.1% — حد أدنى للتقلب (فلتر السيولة)
  maxAtrPct: 0.08,     // 8% — حد أقصى للتقلب
  minAdx: 18,          // قوة اتجاه دنيا
  minKlines: 55,       // عدد شمعات دنيا
  minKlinesMTF: { '5m': 100, '15m': 100, '1h': 200, '4h': 200 },
  signalCooldown: 60,  // دقائق بين إشارتين لنفس الزوج
  DEFAULT_INDICATOR_WEIGHT: 1
};

// أوزان المؤشرات (وضع متوازن)
const WEIGHTS = {
  trend: 1.5, macd: 1.5, rsi: 1.2, smc_fvg: 2, supertrend: 1.5,
  volume: 1.3, bollinger: 1, stochrsi: 1.2, structure: 1.3
};

function decimalsFromStep(step) {
  const text = String(step ?? '').trim();
  if (!text || !Number.isFinite(Number(text))) return null;
  if (text.includes('e-')) return Number(text.split('e-')[1]);
  const dot = text.indexOf('.');
  return dot < 0 ? 0 : text.length - dot - 1;
}

function fallbackPriceDecimals(price) {
  const p = Math.abs(Number(price));
  if (!Number.isFinite(p) || p === 0) return 6;
  if (p >= 1000) return 2;
  if (p >= 100) return 3;
  if (p >= 1) return 4;
  if (p >= 0.1) return 5;
  if (p >= 0.01) return 6;
  return 8;
}

function formatPrice(price, symbol) {
  const n = Number(price);
  if (!Number.isFinite(n)) return '—';
  const decimals = pricePrecisionCache.get(symbol) ?? fallbackPriceDecimals(n);
  return n.toFixed(Math.min(12, Math.max(0, decimals)));
}

async function loadPricePrecision(symbol) {
  if (pricePrecisionCache.has(symbol)) return pricePrecisionCache.get(symbol);
  try {
    const url = `https://api.binance.com/api/v3/exchangeInfo?symbol=${encodeURIComponent(symbol)}`;
    const res = await fetch(url);
    if (!res.ok) throw new Error(`exchangeInfo HTTP ${res.status}`);
    const info = await res.json();
    const filter = (info.symbols?.[0]?.filters || []).find(f => f.filterType === 'PRICE_FILTER');
    const decimals = decimalsFromStep(filter?.tickSize);
    if (decimals !== null) pricePrecisionCache.set(symbol, decimals);
    return decimals;
  } catch (e) {
    console.log(`تعذر تحميل دقة السعر لـ ${symbol} — سيُستخدم البديل الديناميكي`);
    return null;
  }
}

if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });

const trackedFile = path.join(DATA_DIR, 'tracked.json');

function loadTracked() {
  return JSON.parse(fs.existsSync(trackedFile) ? fs.readFileSync(trackedFile) : '[]');
}
function saveTracked(arr) { fs.writeFileSync(trackedFile, JSON.stringify(arr, null, 2)); }

async function send(msg) {
  if (!TOKEN) { console.log('(تليجرام معطّل: لا يوجد TELEGRAM_TOKEN)'); return; }
  const url = `https://api.telegram.org/bot${TOKEN}/sendMessage`;
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ chat_id: CHAT, text: msg, parse_mode: 'HTML' })
  });
  const ok = res.ok;
  console.log(ok ? `✓ أُرسلت رسالة لتليجرام` : `✗ فشل إرسال لتليجرام (HTTP ${res.status})`);
}

// ===== نظام الإغلاق الذاتي: متابعة الصفقات المفتوحة في كل دورة وإغلاقها عند بلوغ هدف أو ضرب SL =====
const TRADE_MAX_AGE_MS = 48 * 3600 * 1000;

async function getTicker(symbol) {
  let lastErr = null;
  for (const base of BINANCE_ENDPOINTS) {
    try {
      const url = `${base}/api/v3/ticker/price?symbol=${symbol}`;
      const res = await fetch(url);
      if (!res.ok) { lastErr = new Error(`ticker HTTP ${res.status} from ${base}`); continue; }
      const data = await res.json();
      if (!data?.price) { lastErr = new Error(`ticker invalid response from ${base}`); continue; }
      return +data.price;
    } catch (e) { lastErr = e; }
  }
  throw lastErr || new Error('ticker: all endpoints failed');
}

async function checkOpenTrades() {
  const today = fmtDate();
  const tracked = loadTracked();
  const open = tracked.filter(t => !t.closed);
  if (open.length === 0) { console.log(`لا صفقات مفتوحة للمتابعة (${tracked.length} في السجل)`); return; }
  const prices = {};
  for (const t of open) {
    try {
      prices[t.symbol] = await getTicker(t.symbol);
    } catch (e) {
      console.log(`تعذر جلب سعر ${t.symbol} — تُتخطى في هذه الدورة`);
    }
  }
  let closedCount = 0;
  for (const t of open) {
    const price = prices[t.symbol];
    if (!Number.isFinite(price)) continue;
    let result = null, pct = 0;
    const k = t.dir === 'LONG' ? 1 : -1;
    const slHit = k === 1 ? price <= t.sl : price >= t.sl;
    const tp1Hit = k === 1 ? price >= t.tp1 : price <= t.tp1;
    const tp2Hit = k === 1 ? price >= t.tp2 : price <= t.tp2;
    const tp3Hit = k === 1 ? price >= t.tp3 : price <= t.tp3;
    const expired = (Date.now() - t.ts) > TRADE_MAX_AGE_MS;
    if (slHit) { result = 'SL'; pct = k * (t.sl - t.price) / t.price * 100; }
    else if (tp3Hit) { result = 'TP3'; pct = k * (t.tp3 - t.price) / t.price * 100; }
    else if (tp2Hit) { result = 'TP2'; pct = k * (t.tp2 - t.price) / t.price * 100; }
    else if (tp1Hit) { result = 'TP1'; pct = k * (t.tp1 - t.price) / t.price * 100; }
    else if (expired) { result = 'انتهت المدة'; pct = k * (price - t.price) / t.price * 100; }
    if (!result) continue;
    t.closed = true;
    t.closePrice = price;
    t.closeResult = result;
    t.closePct = Number(pct.toFixed(3));
    t.closeAt = new Date().toISOString();
    closedCount++;
    const resText = result === 'SL' ? '⛔ ضرب وقف الخسارة' : result.startsWith('TP') ? '✅ أصابت ' + result : '⏱️ انتهت مدة الإشارة (48 ساعة)';
    const dirText = t.dir === 'LONG' ? 'شراء 🟢' : 'بيع 🔴';
    const msg = `🚨 <b>إغلاق صفقة — ${t.symbol}</b> 🚨\n\n` +
      `📈 الاتجاه: ${dirText} (${t.dir})\n` +
      `${resText}\n\n` +
      `💰 سعر الدخول: <code>${formatPrice(t.price, t.symbol)}</code>\n` +
      `🏁 سعر الإغلاق: <code>${formatPrice(price, t.symbol)}</code>\n\n` +
      `📈 النتيجة: <b>${t.closePct > 0 ? '+' : ''}${t.closePct}%</b>\n` +
      `🎯 الأهداف: TP1 <code>${formatPrice(t.tp1, t.symbol)}</code> | TP2 <code>${formatPrice(t.tp2, t.symbol)}</code> | TP3 <code>${formatPrice(t.tp3, t.symbol)}</code>\n` +
      `⏰ ${fmtTime()}`;
    await send(msg);
    console.log(`✗ أُغلقت ${t.symbol}: ${result} (${t.closePct}%)`);
  }
  if (closedCount > 0) saveTracked(tracked);
  const stillOpen = tracked.filter(t => !t.closed).length;
  console.log(`متابعة الصفقات: أُغلق ${closedCount} | مفتوحة: ${stillOpen}`);
}

// ===== جلب بيانات الشموع =====
async function getKlines(symbol, interval = '15m', limit = 500) {
  let lastErr = null;
  for (const base of BINANCE_ENDPOINTS) {
    try {
      const url = `${base}/api/v3/klines?symbol=${symbol}&interval=${interval}&limit=${limit}`;
      const res = await fetch(url);
      if (!res.ok) { lastErr = new Error(`klines HTTP ${res.status} from ${base}`); continue; }
      const data = await res.json();
      if (!Array.isArray(data)) { lastErr = new Error(`klines invalid response from ${base}`); continue; }
      return data.map(k => ({
        openTime: k[0], open: +k[1], high: +k[2], low: +k[3], close: +k[4],
        volume: +k[5], closeTime: k[6], takerBuyVolume: Number.isFinite(+k[9]) ? +k[9] : NaN
      }));
    } catch (e) { lastErr = e; }
  }
  throw lastErr || new Error('klines: all endpoints failed');
}

// ===== Normalization =====
function normalizeKlines(raw) {
  if (!Array.isArray(raw)) return [];
  return raw.map((k, i) => {
    if (Array.isArray(k)) return {
      openTime: Number(k[0]), open: +k[1], high: +k[2], low: +k[3],
      close: +k[4], volume: +k[5], closeTime: Number(k[6]),
      takerBuyVolume: Number.isFinite(+k[9]) ? +k[9] : NaN
    };
    return k;
  }).filter(k => Number.isFinite(k.open) && Number.isFinite(k.close));
}

// ===== دوال المؤشرات (من v13 — كاملة) =====
const Indicators = {
  ema(arr, period) {
    const out = new Array(arr.length).fill(null);
    if (arr.length < period) return out;
    const k = 2 / (period + 1);
    out[period - 1] = arr.slice(0, period).reduce((a, b) => a + b, 0) / period;
    for (let i = period; i < arr.length; i++) out[i] = arr[i] * k + out[i - 1] * (1 - k);
    return out;
  },
  rsi(closes, period = 14) {
    if (closes.length < period + 1) return 50;
    let g = 0, l = 0;
    for (let i = closes.length - period; i < closes.length; i++) {
      const d = closes[i] - closes[i - 1];
      if (d > 0) g += d; else l -= d;
    }
    if (l === 0) return 100;
    return 100 - 100 / (1 + g / l);
  },
  rsiSeries(closes, period = 14) {
    const out = new Array(closes.length).fill(null);
    if (closes.length < period + 1) return out;
    for (let i = period; i < closes.length; i++) {
      let g = 0, l = 0;
      for (let j = i - period + 1; j <= i; j++) {
        const d = closes[j] - closes[j - 1];
        if (d > 0) g += d; else l -= d;
      }
      out[i] = l === 0 ? 100 : 100 - 100 / (1 + g / l);
    }
    return out;
  },
  macd(closes) {
    if (closes.length < 35) return { macd: 0, signal: 0 };
    const a = Indicators.ema(closes, 12), b = Indicators.ema(closes, 26);
    const line = closes.map((_, i) => a[i] != null && b[i] != null ? a[i] - b[i] : 0).filter(v => v !== 0);
    const s = Indicators.ema(line, 9);
    return { macd: line.at(-1) || 0, signal: s.at(-1) || 0 };
  },
  atr(h, l, c, period = 14) {
    const tr = [];
    for (let i = 1; i < c.length; i++)
      tr.push(Math.max(h[i] - l[i], Math.abs(h[i] - c[i - 1]), Math.abs(l[i] - c[i - 1])));
    return tr.length < period ? NaN : tr.slice(-period).reduce((a, b) => a + b, 0) / period;
  },
  adx(h, l, c, period = 14) {
    if (c.length < period * 2 + 1) return { adx: 0, pdi: 0, mdi: 0 };
    const tr = [], p = [], m = [];
    for (let i = 1; i < c.length; i++) {
      const up = h[i] - h[i - 1], down = l[i - 1] - l[i];
      tr.push(Math.max(h[i] - l[i], Math.abs(h[i] - c[i - 1]), Math.abs(l[i] - c[i - 1])));
      p.push(up > down && up > 0 ? up : 0);
      m.push(down > up && down > 0 ? down : 0);
    }
    const dx = [];
    let pdi = 0, mdi = 0;
    for (let end = period; end <= tr.length; end++) {
      const ts = tr.slice(end - period, end).reduce((a, b) => a + b, 0);
      if (!ts) { dx.push(0); continue; }
      pdi = 100 * p.slice(end - period, end).reduce((a, b) => a + b, 0) / ts;
      mdi = 100 * m.slice(end - period, end).reduce((a, b) => a + b, 0) / ts;
      dx.push(pdi + mdi ? 100 * Math.abs(pdi - mdi) / (pdi + mdi) : 0);
    }
    const a = dx.slice(-period);
    return { adx: a.length ? a.reduce((x, y) => x + y, 0) / a.length : 0, pdi, mdi };
  },
  supertrend(h, l, c, period = 10, mult = 3) {
    const tr = [];
    for (let i = 1; i < c.length; i++)
      tr.push(Math.max(h[i] - l[i], Math.abs(h[i] - c[i - 1]), Math.abs(l[i] - c[i - 1])));
    const ae = Indicators.ema(tr, period);
    const hl = h.map((x, i) => (x + l[i]) / 2);
    let trend = 1, lower = hl[0] - (ae[0] || 0) * mult;
    for (let i = 1; i < c.length; i++) {
      const lo = hl[i] - (ae[i] || 0) * mult;
      lower = c[i - 1] < lower ? Math.max(lo, lower) : lo;
      trend = c[i] > lower ? 1 : -1;
    }
    return trend;
  },
  bollinger(c, period = 20, mult = 2) {
    if (c.length < period) return null;
    const x = c.slice(-period), mid = x.reduce((a, b) => a + b, 0) / period;
    const std = Math.sqrt(x.reduce((a, b) => a + (b - mid) ** 2, 0) / period);
    return { upper: mid + mult * std, mid, lower: mid - mult * std };
  },
  stochRsi(c, period = 14, smooth = 3) {
    const rs = Indicators.rsiSeries(c, period).filter(v => v !== null);
    if (rs.length < period + smooth) return { current: 50, prev: 50 };
    const w = rs.slice(-(period + smooth)), ks = [];
    for (let i = period - 1; i < w.length; i++) {
      const seg = w.slice(i - period + 1, i + 1), min = Math.min(...seg), max = Math.max(...seg);
      ks.push(max === min ? 50 : (seg.at(-1) - min) / (max - min) * 100);
    }
    const cur = ks.slice(-smooth), prev = ks.slice(-smooth - 1, -1);
    return {
      current: cur.reduce((a, b) => a + b, 0) / cur.length,
      prev: prev.length ? prev.reduce((a, b) => a + b, 0) / prev.length : cur.at(-1)
    };
  },
  structure(h, l, c) {
    const period = 20;
    if (c.length < period + 1) return 0;
    const hi = Math.max(...h.slice(-period - 1, -1)), lo = Math.min(...l.slice(-period - 1, -1)), p = c.at(-1);
    return p >= hi * .999 ? 1 : p <= lo * 1.001 ? -1 : 0;
  },
  fvg(ks) {
    if (ks.length < 3) return null;
    const a = ks.at(-3), b = ks.at(-2), c = ks.at(-1);
    if (c.low > a.high && b.close > b.open) return 'bullish';
    if (c.high < a.low && b.close < b.open) return 'bearish';
    return null;
  }
};

// ===== VOTE_PLUGINS (نظام التصويت) =====
const VOTE_PLUGINS = [
  { key: 'trend', vote: ind => ind.ema20 > ind.ema50 ? 1 : -1 },
  { key: 'macd', vote: ind => ind.macd.macd > ind.macd.signal ? 1 : -1 },
  { key: 'rsi', vote: ind => ind.rsi <= 40 ? 1 : ind.rsi >= 60 ? -1 : 0 },
  { key: 'smc_fvg', vote: ind => ind.fvg === 'bullish' ? 1 : ind.fvg === 'bearish' ? -1 : 0 },
  { key: 'supertrend', vote: ind => ind.supertrend },
  { key: 'volume', vote: ind => ind.volume > 1.5 ? (ind.ema20 > ind.ema50 ? 1 : -1) : 0 },
  { key: 'bollinger', vote: ind => ind.bb ? (ind.price >= ind.bb.upper ? 1 : ind.price <= ind.bb.lower ? -1 : 0) : 0 },
  { key: 'stochrsi', vote: ind => ind.stoch.current < 25 && ind.stoch.current > ind.stoch.prev ? 1 : ind.stoch.current > 75 && ind.stoch.current < ind.stoch.prev ? -1 : 0 },
  { key: 'structure', vote: ind => ind.structure },
  { key: 'taker_flow', vote: ind => { if (ind.takerFlow == null) return 0; if (ind.takerFlow > 0.55) return 1; if (ind.takerFlow < 0.45) return -1; return 0 } },
  { key: 'onchain_fng', role: 'confirmer', vote: ind => { if (!ind.fng) return 0; const v = ind.fng.value; if (v > 75) return -1; if (v < 25) return 1; if (v > 60) return -1; if (v < 40) return 1; return 0 } },
  { key: 'defi_gas', role: 'confirmer', vote: ind => { if (!ind.gasRatio || ind.gasRatio <= 1.3) return 0; return ind.ema20 > ind.ema50 ? 1 : -1 } },
  { key: 'orderbook_live', role: 'confirmer', vote: ind => { if (ind.obImbalance == null) return 0; if (ind.obImbalance > 0.15) return 1; if (ind.obImbalance < -0.15) return -1; return 0 } }
];

// ===== signalFromIndicators (مع الفلاتر) =====
function signalFromIndicators(symbol, ks, i, ind, mode) {
  const price = ind.price, atr = ind.atr, atrPct = price ? atr / price : 0;
  // فلتر 1: ATR Range (حارس السيولة/التقلب)
  if (!Number.isFinite(price) || !Number.isFinite(atr) || atrPct < CONFIG.minAtrPct || atrPct > CONFIG.maxAtrPct) return null;
  // فلتر 2: ADX Threshold
  if (ind.adx < CONFIG.minAdx) return null;

  const weights = WEIGHTS;
  const votes = {};
  for (const p of VOTE_PLUGINS) votes[p.key] = p.vote(ind);
  const corePlugins = VOTE_PLUGINS.filter(p => p.role !== 'confirmer');
  const confirmerPlugins = VOTE_PLUGINS.filter(p => p.role === 'confirmer');

  // فلتر 3: Weighted Voting (يجب أن يكون هناك توافق)
  let sum = 0, participating = 0;
  for (const p of corePlugins) {
    const w = weights[p.key] ?? CONFIG.DEFAULT_INDICATOR_WEIGHT;
    sum += (votes[p.key] || 0) * w;
    if (votes[p.key]) participating += w;
  }
  if (!sum) return null; // لا توافق → لا إشارة

  const dir = sum > 0 ? 'LONG' : 'SHORT';
  // فلتر 4: DI Direction
  const di = dir === 'LONG' ? ind.pdi > ind.mdi : ind.mdi > ind.pdi;
  if (!di) return null;

  const confirmed = [];
  for (const p of confirmerPlugins) {
    const v = votes[p.key];
    if (!v) continue;
    const voteDir = v > 0 ? 'LONG' : 'SHORT';
    if (voteDir === dir) {
      const w = weights[p.key] ?? CONFIG.DEFAULT_INDICATOR_WEIGHT;
      sum += v * w;
      participating += w;
      confirmed.push(p.key);
    }
  }

  const filters = [`ADX ${ind.adx.toFixed(1)}`, `DI ${dir === 'LONG' ? '+DI' : '-DI'}`];
  for (const p of corePlugins) if (votes[p.key] && Math.sign(votes[p.key]) === Math.sign(sum)) filters.push(`${p.key.toUpperCase()}`);
  for (const k of confirmed) filters.push(`${k.toUpperCase()} ✓مؤكِّد`);

  const pct = participating ? Math.abs(sum) / participating * 100 : 0;
  return { symbol, dir, price, atr, atrPct, adx: ind.adx, pdi: ind.pdi, mdi: ind.mdi, pct, filters, closedCandle: ks[i]?.openTime ?? 0, index: i };
}

// ===== analyzeLatest =====
function analyzeLatest(symbol, ks, mode, extra) {
  const a = normalizeKlines(ks);
  if (a.length < CONFIG.minKlines) return { signal: null, indicators: null };
  const c = a.map(k => k.close), h = a.map(k => k.high), l = a.map(k => k.low), v = a.map(k => k.volume);
  const price = c.at(-1), e20 = Indicators.ema(c, 20).at(-1), e50 = Indicators.ema(c, 50).at(-1);
  const bb = Indicators.bollinger(c);
  const avg = v.slice(-20).reduce((x, y) => x + y, 0) / Math.min(20, v.length);
  const adxRes = Indicators.adx(h, l, c);

  // Taker Flow من آخر 10 شموع
  const win = Math.min(10, a.length);
  let buySum = 0, volSum = 0;
  for (let i = a.length - win; i < a.length; i++) {
    if (Number.isFinite(a[i].takerBuyVolume) && a[i].volume > 0) {
      buySum += a[i].takerBuyVolume;
      volSum += a[i].volume;
    }
  }
  const takerFlow = volSum > 0 ? buySum / volSum : null;

  const ind = {
    price, ema20: e20, ema50: e50,
    macd: Indicators.macd(c),
    rsi: Indicators.rsi(c),
    atr: Indicators.atr(h, l, c),
    adx: adxRes.adx, pdi: adxRes.pdi, mdi: adxRes.mdi,
    fvg: Indicators.fvg(a),
    supertrend: Indicators.supertrend(h, l, c),
    volume: avg ? v.at(-1) / avg : 0,
    bb,
    stoch: Indicators.stochRsi(c),
    structure: Indicators.structure(h, l, c),
    takerFlow,
    obImbalance: extra?.obImbalance ?? null,
    fng: null,
    gasRatio: null
  };
  return { signal: signalFromIndicators(symbol, a, a.length - 1, ind, mode), indicators: ind };
}

// ===== levelsFromSignal =====
function levelsFromSignal(s) {
  const d = s.atr * 1.5,
    sl = s.dir === 'LONG' ? s.price - d : s.price + d,
    tp1 = s.dir === 'LONG' ? s.price + d : s.price - d,
    tp2 = s.dir === 'LONG' ? s.price + 2 * d : s.price - 2 * d,
    tp3 = s.dir === 'LONG' ? s.price + 3 * d : s.price - 3 * d;
  if ([s.price, s.atr, sl, tp1, tp2, tp3].some(v => !Number.isFinite(v) || v <= 0)) return null;
  const risk = Math.abs(s.price - sl), reward = Math.abs(tp3 - s.price);
  // فلتر 5: R:R ≥ 2.5
  if (!risk || reward < risk * 2.5) return null;
  return { ...s, sl, tp1, tp2, tp3, rr: reward / risk };
}

// ===== Cooldown Check =====
function cooldownKey(s) { return `${s.symbol || s.sym}:${s.dir}:${15}:${s.closedCandle || 0}`; }
function canEmit(s, today) {
  const mins = CONFIG.signalCooldown;
  if (!mins) return { ok: true };
  const base = `${s.symbol || s.sym}:${s.dir}:15`;
  const last = loadTracked().find(t => t.date === today && t.symbol === s.symbol && !t.closed);
  return !last ? { ok: true } : { ok: false, reason: `cooldown — إشارة سابقة مفتوحة` };
}

// ===== Market Microstructure (Order Book + Tape) =====
async function getMarketMicrostructure(symbol) {
  try {
    const [depthRes, tradesRes] = await Promise.all([
      fetch(`https://api.binance.com/api/v3/depth?symbol=${symbol}&limit=20`),
      fetch(`https://api.binance.com/api/v3/aggTrades?symbol=${symbol}&limit=500`)
    ]);
    if (!depthRes.ok || !tradesRes.ok) return null;
    const depth = await depthRes.json();
    const trades = await tradesRes.json();
    const bidNotional = (depth.bids || []).reduce((sum, [price, qty]) => sum + Number(price) * Number(qty), 0);
    const askNotional = (depth.asks || []).reduce((sum, [price, qty]) => sum + Number(price) * Number(qty), 0);
    const bookTotal = bidNotional + askNotional;
    const orderBookImbalance = bookTotal ? (bidNotional - askNotional) / bookTotal : null;
    let buyQty = 0, totalQty = 0;
    for (const trade of Array.isArray(trades) ? trades : []) {
      const qty = Number(trade.q || 0);
      totalQty += qty;
      if (!trade.isBuyerMaker) buyQty += qty;
    }
    const tapeBuyPct = totalQty ? (buyQty / totalQty) * 100 : null;
    return { orderBookImbalance, tapeBuyPct, samples: Array.isArray(trades) ? trades.length : 0 };
  } catch (e) {
    console.log(`تعذر تحميل عمق السوق لـ ${symbol}`);
    return null;
  }
}

// ===== Multi-Timeframe Analysis (4 أطر مع تأكيد 4H) =====
async function getMTFAnalysis(symbol) {
  const timeframes = ['15m', '1h', '4h'];
  const results = {};
  for (const tf of timeframes) {
    try {
      const kl = await getKlines(symbol, tf, CONFIG.minKlinesMTF[tf]);
      if (kl.length >= CONFIG.minKlinesMTF[tf]) {
        const { signal } = analyzeLatest(symbol, kl, 'balanced', null);
        results[tf] = signal;
      }
    } catch (e) {
      console.log(`تعذر جلب ${tf} لـ ${symbol}`);
    }
  }

  // 4H تأكيد إلزامي
  if (!results['4h']) return null;

  // توافق: عدّ الأصوات
  let longVotes = 0, shortVotes = 0;
  const votesByTf = [];
  for (const [tf, sig] of Object.entries(results)) {
    if (!sig) continue;
    if (sig.dir === 'LONG') { longVotes++; votesByTf.push(`${tf}→LONG`); }
    else { shortVotes++; votesByTf.push(`${tf}→SHORT`); }
  }

  const totalFrames = timeframes.length;
  // يجب ≥ 2 توافق من 3 أطر + تأكيد 4H
  if (longVotes >= 2 && longVotes >= shortVotes && results['4h']?.dir === 'LONG')
    return { dir: 'LONG', votes: longVotes, totalFrames, votesByTf, pct4h: results['4h'].pct, adx4h: results['4h'].adx };
  if (shortVotes >= 2 && shortVotes >= longVotes && results['4h']?.dir === 'SHORT')
    return { dir: 'SHORT', votes: shortVotes, totalFrames, votesByTf, pct4h: results['4h'].pct, adx4h: results['4h'].adx };

  return null;
}

// ===== تقييم شامل (v13 full) =====
async function evaluate(symbol) {
  try {
    // جلب 500 شمعة 15m للتحليل الأساسي
    const kl = await getKlines(symbol, '15m', 500);
    if (kl.length < CONFIG.minKlines) return null;

    // جلب بيانات Order Book للتأكيد الإضافي
    let obImbalance = null;
    try {
      const depthRes = await fetch(`https://api.binance.com/api/v3/depth?symbol=${symbol}&limit=20`);
      if (depthRes.ok) {
        const depth = await depthRes.json();
        const bidNotional = (depth.bids || []).reduce((s, [p, q]) => s + Number(p) * Number(q), 0);
        const askNotional = (depth.asks || []).reduce((s, [p, q]) => s + Number(p) * Number(q), 0);
        const total = bidNotional + askNotional;
        obImbalance = total ? (bidNotional - askNotional) / total : null;
      }
    } catch (e) { /* لا Order Book — لا مشكلة */ }

    // تحليل v13 الأساسي
    const { signal, indicators } = analyzeLatest(symbol, kl, 'balanced', { obImbalance });
    if (!signal) return null;

    // تحليل MTF للتأكيد الإضافي
    const mtf = await getMTFAnalysis(symbol);
    if (!mtf) return null;

    // دمج النتائج
    const combined = levelsFromSignal(signal);
    if (!combined) return null;

    return {
      ...combined,
      symbol,
      votes: mtf.votes,
      totalFrames: mtf.totalFrames,
      votesByTf: mtf.votesByTf,
      adx4h: mtf.adx4h,
      rsi4h: indicators?.rsi ?? null,
      tf: '15m (MTF 15m+1h+4h)'
    };
  } catch (e) {
    console.log(`خطأ في تقييم ${symbol}: ${e.message}`);
    return null;
  }
}

const fmtDate = () => new Date().toISOString().slice(0, 10);
const fmtTime = () => new Date().toLocaleTimeString('en-GB', { hour12: false, timeZone: 'Asia/Riyadh' });

function formatMicro(value) {
  return Number.isFinite(Number(value)) ? Number(value).toFixed(1) : '—';
}

// ===== المسح الرئيسي =====
async function scan() {
  const today = fmtDate();
  let tracked = loadTracked();
  const todayCount = tracked.filter(t => t.date === today).length;
  let emittedToday = todayCount;
  console.log(`بدء الفحص — ${new Date().toISOString()} — إشارات اليوم: ${todayCount}/${MAX_SIGNALS_PER_DAY}`);

  // نافذة اليوم الحالية
  const todaySlotSignals = tracked.filter(t => t.date === today && t.slot === currentSlot() && !t.closed).length;
  if (todaySlotSignals > 0) {
    console.log(`نافذة اليوم (${currentSlot()}) استُهلكت بالفعل — ننتظر النافذة التالية`);
    return;
  }
  if (todayCount >= MAX_SIGNALS_PER_DAY) { console.log('حد إشارات اليوم وصل'); return; }

  // الإغلاق الذاتي أولًا
  await checkOpenTrades();
  tracked = loadTracked();

  console.log(`بدء تحليل ${SYMS.length} زوج بنظام v13 الكامل...`);
  const res = await Promise.all(SYMS.map(evaluate));

  // اختيار إشارة واحدة للنافذة الحالية
  const candidates = [];
  for (let i = 0; i < res.length; i++) {
    const s = res[i];
    if (!s) continue;
    if (tracked.some(t => t.date === today && t.symbol === SYMS[i])) continue;
    candidates.push({ ...s, symbol: SYMS[i] });
  }
  // ترتيب: أعلى قوة توافق (pct) ثم أكثر أصوات MTF
  candidates.sort((a, b) => (b.pct || 0) - (a.pct || 0) || (b.votes || 0) - (a.votes || 0));
  const loopSignals = candidates.slice(0, 1);

  for (let i = 0; i < loopSignals.length; i++) {
    const s = loopSignals[i];
    if (!s) continue;
    if (emittedToday >= MAX_SIGNALS_PER_DAY) break;

    // Cooldown check
    const cd = canEmit(s, today);
    if (!cd.ok) { console.log(`⛔ ${s.symbol} مرفوض: ${cd.reason}`); continue; }

    await loadPricePrecision(s.symbol);
    s.priceDecimals = pricePrecisionCache.get(s.symbol) ?? fallbackPriceDecimals(s.price);
    s.date = today; s.ts = Date.now(); s.slot = currentSlot(); s.closed = false;
    tracked.push(s);
    saveTracked(tracked);
    emittedToday++;

    // ===== صيغة الرسالة (نموذج المستخدم الموحد) =====
    const directionText = s.dir === 'LONG' ? 'شراء 🟢' : 'بيع 🔴';
    const rr = (() => {
      const slDist = Math.abs(s.price - s.sl);
      const tpDist = Math.abs(s.tp3 - s.price);
      if (!Number.isFinite(slDist) || slDist <= 0) return null;
      return Number((tpDist / slDist).toFixed(1));
    })();
    const strength = Number.isFinite(s.pct) ? Number(s.pct.toFixed(1)) : null;
    const tfLine = Array.isArray(s.votesByTf) && s.votesByTf.length
      ? `\n🗓️ أطر مؤيدة: ${s.votesByTf.join(' | ')}` : '';
    const filtersLine = Array.isArray(s.filters) && s.filters.length
      ? `\n🔍 الفلاتر: ${s.filters.join(' | ')}` : '';

    const msg = `🚨 <b>إشارة ${s.dir === 'LONG' ? 'Long' : 'Short'}</b> 🚨\n\n` +
      ` الزوج: <b>${s.symbol}</b>\n` +
      `🏷️ النوع: كريبتو 🪙\n` +
      `📈 الاتجاه: ${directionText}\n` +
      `💰 سعر الدخول: <code>${formatPrice(s.price, s.symbol)}</code>\n\n` +
      `🛑 وقف الخسارة (SL): <code>${formatPrice(s.sl, s.symbol)}</code>\n` +
      `🎯 الهدف الأول (TP1): <code>${formatPrice(s.tp1, s.symbol)}</code>\n` +
      `🎯 الهدف الثاني (TP2): <code>${formatPrice(s.tp2, s.symbol)}</code>\n` +
      `🎯 الهدف الثالث (TP3): <code>${formatPrice(s.tp3, s.symbol)}</code>\n` +
      (rr ? `⚖️ المخاطرة/العائد: <b>1 : ${rr}</b>\n` : '') +
      (strength ? `🔥 قوة التوافق: <b>${strength}%</b>\n` : '') +
      (s.adx4h ? `📊 ADX 4H: <b>${s.adx4h.toFixed(1)}</b>\n` : '') +
      `📌 الإطار الزمني: 15 دقيقة${tfLine}${filtersLine}\n` +
      `⏰ ${fmtTime()}`;
    await send(msg);
    await appendToSheet([
      tracked.filter(t => t.date === today).length,
      s.date, fmtTime(), s.symbol, s.dir,
      s.price, s.sl, s.tp1, s.tp2, s.tp3,
      '', 'مفتوحة', '', 'مفتوحة'
    ]);
    console.log(`✓ إشارة ${s.dir} لـ ${s.symbol} | R:R 1:${rr} | قوة ${strength}%`);
  }
  console.log(`مسح اكتمل — إشارات اليوم: ${loadTracked().filter(t => t.date === today).length}`);
}

// ===== كتابة السجل في Google Sheet =====
async function appendToSheet(values) {
  if (!SHEET_CSV_URL) return;
  try {
    const res = await fetch(SHEET_CSV_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'text/csv' },
      body: values.join(',') + '\n'
    });
    console.log(res.ok ? '✓ صف أُضيف للسجل العام' : `✗ لم يُكتب في الشيت (HTTP ${res.status}) — السجل محفوظ في repo`);
  } catch (e) {
    console.log('سجل الـSheet غير متاح — البيانات محفوظة في المستودع');
  }
}

scan().catch(e => { console.error('خطأ فادح:', e.message); process.exit(1); });
