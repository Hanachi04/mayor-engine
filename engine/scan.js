// MaYor Signal Engine — GitHub Actions Edition
// يُشغَّل كل 30 دقيقة من GitHub Actions: يفحص السوق ← يرسل الإشارات ← يكتب السجل في Google Sheet
// البيانات الثابتة (سجل الإشارات + صفقات متابعة) تُخزن في repo داخل data/ وتُحدَّث ثم تُرفع مرة أخرى

const fs = require('fs');
const path = require('path');

const TOKEN = process.env.TELEGRAM_TOKEN;
const CHAT = process.env.TELEGRAM_CHAT || '@Paracaudina';
const SHEET_CSV_URL = process.env.SHEET_CSV_URL || ''; // رابط CSV المنشور لشيت السجل
const MAX_SIGNALS_PER_DAY = 6;
const SYMS = (process.env.SYMBOLS || 'BTCUSDT,ETHUSDT,SOLUSDT,BNBUSDT,XRPUSDT,DOGEUSDT,ADAUSDT,AVAXUSDT,LINKUSDT,DOTUSDT').split(',');
const DATA_DIR = path.join(__dirname, '..', 'data');
const pricePrecisionCache = new Map();

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

async function getKlines(symbol) {
  // نحتاج 200 شمعة فعلية حتى لا يُحسب SMA200 على عينة ناقصة.
  const url = `https://api.binance.com/api/v3/klines?symbol=${symbol}&interval=4h&limit=250`;
  const res = await fetch(url);
  const data = await res.json();
  if (!res.ok || !Array.isArray(data)) throw new Error(`klines HTTP ${res.status}`);
  return data.map(k => ({ open: +k[1], high: +k[2], low: +k[3], close: +k[4], volume: +k[5], ts: k[0] }));
}

// طبقة مجانية خفيفة من Binance REST بدل WebSocket دائم داخل GitHub Actions.
// تُستخدم كقراءة سياقية فقط، ولا تُحوّل وحدها إلى قرار تداول.
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
    const orderBookImbalance = bookTotal ? ((bidNotional - askNotional) / bookTotal) * 100 : null;
    let buyQty = 0, totalQty = 0;
    for (const trade of Array.isArray(trades) ? trades : []) {
      const qty = Number(trade.q || 0);
      totalQty += qty;
      // isBuyerMaker=true يعني أن الطرف المشتري كان Maker؛ بالتالي الطرف المعتدي بائع.
      if (!trade.isBuyerMaker) buyQty += qty;
    }
    const tapeBuyPct = totalQty ? (buyQty / totalQty) * 100 : null;
    return { orderBookImbalance, tapeBuyPct, samples: Array.isArray(trades) ? trades.length : 0 };
  } catch (e) {
    console.log(`تعذر تحميل عمق السوق لـ ${symbol} — ستُرسل الإشارة بدون هذه القراءة`);
    return null;
  }
}

function formatMicro(value) {
  return Number.isFinite(Number(value)) ? Number(value).toFixed(1) : '—';
}

function rsi(closes, period = 14) {
  if (closes.length < period + 1) return null;
  let gains = 0, losses = 0;
  for (let i = closes.length - period; i < closes.length; i++) {
    const diff = closes[i] - closes[i - 1];
    if (diff >= 0) gains += diff; else losses -= diff;
  }
  const avgG = gains / period, avgL = losses / period;
  if (avgL === 0) return 100;
  return 100 - 100 / (1 + avgG / avgL);
}

function sma(arr, n) { return arr.slice(-n).reduce((a, b) => a + b, 0) / n; }

function atr(klines, period = 14) {
  let sum = 0;
  for (let i = klines.length - period; i < klines.length; i++) {
    sum += Math.max(klines[i].high - klines[i].low, Math.abs(klines[i].high - klines[i - 1].close), Math.abs(klines[i].low - klines[i - 1].close));
  }
  return sum / period;
}

function evaluate(symbol) {
  return getKlines(symbol).then(kl => {
    if (kl.length < 200) return null;
    const closes = kl.map(k => k.close);
    const r = rsi(closes), ema50 = sma(closes, 50), ema200 = sma(closes, 200);
    const last = kl[kl.length - 1], a = atr(kl);
    if (r === null) return null;
    if (ema50 > ema200 && r >= 35 && r <= 55) {
      return { dir: 'LONG', price: last.close, sl: last.close - 1.5 * a, tp1: last.close + 1.5 * a, tp2: last.close + 2.5 * a, tp3: last.close + 3.5 * a, rsi: r.toFixed(1) };
    }
    if (ema50 < ema200 && r >= 55 && r <= 75) {
      return { dir: 'SHORT', price: last.close, sl: last.close + 1.5 * a, tp1: last.close - 1.5 * a, tp2: last.close - 2.5 * a, tp3: last.close - 3.5 * a, rsi: r.toFixed(1) };
    }
    return null;
  }).catch(() => null);
}

const fmtDate = () => new Date().toISOString().slice(0, 10);
const fmtTime = () => new Date().toLocaleTimeString('en-GB', { hour12: false, timeZone: 'Asia/Riyadh' });

async function scan() {
  const today = fmtDate();
  const tracked = loadTracked();
  const todayCount = tracked.filter(t => t.date === today).length;
  let emittedToday = todayCount;
  console.log(`بدء الفحص — ${new Date().toISOString()} — إشارات اليوم: ${todayCount}/${MAX_SIGNALS_PER_DAY}`);

  if (todayCount >= MAX_SIGNALS_PER_DAY) { console.log('حد إشارات اليوم وصل'); return; }

  const res = await Promise.all(SYMS.map(evaluate));
  for (let i = 0; i < res.length; i++) {
    const s = res[i];
    if (!s) continue;
    if (emittedToday >= MAX_SIGNALS_PER_DAY) break;
    s.symbol = SYMS[i];
    // منع تكرار نفس الزوج في اليوم نفسه عند تشغيل الفحص كل 30 دقيقة.
    if (tracked.some(t => t.date === today && t.symbol === s.symbol)) continue;
    await loadPricePrecision(s.symbol);
    s.priceDecimals = pricePrecisionCache.get(s.symbol) ?? fallbackPriceDecimals(s.price);
    const micro = await getMarketMicrostructure(s.symbol);
    if (micro) {
      s.orderBookImbalance = Number.isFinite(micro.orderBookImbalance) ? Number(micro.orderBookImbalance.toFixed(2)) : null;
      s.tapeBuyPct = Number.isFinite(micro.tapeBuyPct) ? Number(micro.tapeBuyPct.toFixed(2)) : null;
      s.tapeSamples = micro.samples;
    }
    s.date = today; s.ts = Date.now(); s.closed = false;
    tracked.push(s);
    saveTracked(tracked);
    emittedToday++;
    const microLine = micro ? `\n📚 Order Book: ${formatMicro(micro.orderBookImbalance)}% | Tape شراء: ${formatMicro(micro.tapeBuyPct)}%` : '\n📚 Order Book/Tape: غير متاح مؤقتًا';
    const msg = `<b>📡 MaYor Signal</b>\n\n${s.dir === 'LONG' ? '🟢' : '🔴'} <b>${s.dir} ${s.symbol}</b>\n📍 Entry: <code>${formatPrice(s.price, s.symbol)}</code>\n🛑 SL: <code>${formatPrice(s.sl, s.symbol)}</code>\n🎯 TP1: <code>${formatPrice(s.tp1, s.symbol)}</code>\n🎯 TP2: <code>${formatPrice(s.tp2, s.symbol)}</code>\n🎯 TP3: <code>${formatPrice(s.tp3, s.symbol)}</code>\n📊 RSI: ${s.rsi} | المصدر: Binance 4H${microLine}\n⏰ ${fmtTime()}`;
    await send(msg);
    await appendToSheet([
      tracked.filter(t => t.date === today).length,
      s.date, fmtTime(), s.symbol, s.dir,
      s.price, s.sl,
      s.tp1, s.tp2, s.tp3,
      '', 'مفتوحة', '', 'مفتوحة'
    ]);
  }
  console.log(`مسح اكتمل — إشارات اليوم: ${loadTracked().filter(t => t.date === today).length}`);
}

// ===== كتابة السجل في Google Sheet عبر API CSV المنشور =====
// ملاحظة: CSV المنشور للاستقبال فقط؛ الكتابة الفعلية تتم بحفظ tracked.json في repo.
// الشيت يُحدَّث تلقائيًا من خلال ملف CSV قابل للكتابة عبر GitHub Actions إذا ضُبطت
// SHEET_CSV_URL كخدمة قبول، وإلا يبقى السجل في repo (بيانات كاملة).
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

// عند فشل الخطوة الأخيرة في الـworkflow (git push) لا نعيد تعيين البيانات
scan().catch(e => { console.error('خطأ فادح:', e.message); process.exit(1); });
