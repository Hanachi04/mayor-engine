// MaYor Signal Engine — GitHub Actions Edition
// يُشغَّل كل 30 دقيقة من GitHub Actions: يفحص السوق ← يرسل الإشارات ← يكتب السجل في Google Sheet
// البيانات الثابتة (سجل الإشارات + صفقات متابعة) تُخزن في repo داخل data/ وتُحدَّث ثم تُرفع مرة أخرى

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

// ===== نظام الإغلاق الذاتي: متابعة الصفقات المفتوحة في كل دورة وإغلاقها عند بلوغ هدف أو ضرب SL =====
// مدة حياة الإشارة الافتراضية: 48 ساعة من إرسالها؛ بعدها تُغلق تلقائيًا إذا لم تُحسم.
const TRADE_MAX_AGE_MS = 48 * 3600 * 1000;

async function getTicker(symbol) {
  const url = `https://api.binance.com/api/v3/ticker/price?symbol=${symbol}`;
  const res = await fetch(url);
  const data = await res.json();
  if (!res.ok || !data?.price) throw new Error(`ticker HTTP ${res.status}`);
  return +data.price;
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
    const emoji = result === 'SL' ? '🔴' : result.startsWith('TP') ? '🎯' : '⏱️';
    const msg = `${emoji} <b>إغلاق MaYor — ${t.symbol}</b>
${result === 'SL' ? '⛔ ضرب وقف الخسارة' : result.startsWith('TP') ? '✅ أصابت ' + result : '⏱️ انتهت مدة الإشارة (48 ساعة)'}
📍 الدخول: <code>${formatPrice(t.price, t.symbol)}</code> | الإغلاق: <code>${formatPrice(price, t.symbol)}</code>
📈 النتيجة: <b>${t.closePct > 0 ? '+' : ''}${t.closePct}%</b>
🎯 الأهداف: TP1 <code>${formatPrice(t.tp1, t.symbol)}</code> | TP2 <code>${formatPrice(t.tp2, t.symbol)}</code> | TP3 <code>${formatPrice(t.tp3, t.symbol)}</code>
⏰ ${fmtTime()}`;
    await send(msg);
    console.log(`✗ أُغلقت ${t.symbol}: ${result} (${t.closePct}%)`);
  }
  if (closedCount > 0) saveTracked(tracked);
  const stillOpen = tracked.filter(t => !t.closed).length;
  console.log(`متابعة الصفقات: أُغلق ${closedCount} | مفتوحة: ${stillOpen}`);
}

async function getKlines(symbol, interval = '4h', limit = 250) {
  // الأطر الصغيرة لا تحتاج 200 شمعة؛ يكفي الحد الأدنى لحساب المؤشرات بدقة معقولة.
  const url = `https://api.binance.com/api/v3/klines?symbol=${symbol}&interval=${interval}&limit=${limit}`;
  const res = await fetch(url);
  const data = await res.json();
  if (!res.ok || !Array.isArray(data)) throw new Error(`klines HTTP ${res.status}`);
  return data.map(k => ({ open: +k[1], high: +k[2], low: +k[3], close: +k[4], volume: +k[5], ts: k[0] }));
}

// ===== نظام التحليل متعدد الأطر الزمنية (MTF) =====
// 4 أطر: 5د / 15د / 1س / 4س. لكل إطار حساب RSI + علاقتا السعر بالمؤشرات المتحركة.
// الاتفاق المطلوب: 3 أطر على الأقل تؤيد الاتجاه نفسه. الاتجاه الرئيسي من 4H ملزم.
// الأهداف تُحسب من ATR على الإطار 15د (أضيق من 4H → أهداف أقرب وأسهل بلوغًا).
const MTF_TIMEFRAMES = ['5m', '15m', '1h', '4h'];
const MTF_MIN_CANDLES = { '5m': 120, '15m': 120, '1h': 200, '4h': 200 };

function evaluateTimeframe(kl) {
  const closes = kl.map(k => k.close);
  const r = rsi(closes), ema50 = sma(closes, 50), ema200 = sma(closes, 200);
  if (r === null || kl.length < 60) return null;
  const last = kl[kl.length - 1];
  const longScore = (ema50 > ema200 ? 1 : 0) + (last.close > ema50 ? 1 : 0) + (r >= 35 && r <= 55 ? 1 : 0);
  const shortScore = (ema50 < ema200 ? 1 : 0) + (last.close < ema50 ? 1 : 0) + (r >= 55 && r <= 75 ? 1 : 0);
  return { longScore, shortScore, rsi: r };
}

function evaluateMTF(symbol) {
  return Promise.all(MTF_TIMEFRAMES.map(tf =>
    getKlines(symbol, tf, MTF_MIN_CANDLES[tf]).then(kl => ({ tf, kl })).catch(() => null)
  )).then(frames => {
    let longVotes = 0, shortVotes = 0, rsi4h = null, rsi15 = null, last4h = null, atr15 = null;
    const votesByTf = [];
    for (const f of frames) {
      if (!f || f.kl.length < MTF_MIN_CANDLES[f.tf]) continue;
      const ev = evaluateTimeframe(f.kl);
      if (!ev) continue;
      if (ev.longScore >= 2) { longVotes++; votesByTf.push(`${f.tf}→LONG`); }
      if (ev.shortScore >= 2) { shortVotes++; votesByTf.push(`${f.tf}→SHORT`); }
      if (f.tf === '4h') { rsi4h = ev.rsi; last4h = f.kl[f.kl.length - 1].close; }
      if (f.tf === '15m') rsi15 = ev.rsi;
    }
    // الإطار 4H يوجه الاتجاه: إن كان راسخًا يعطى صوتًا إضافيًا، وإن عارض يُلغى القرار.
    const frames4h = frames.find(f => f?.tf === '4h');
    const ev4h = frames4h?.kl?.length >= MTF_MIN_CANDLES['4h'] ? evaluateTimeframe(frames4h.kl) : null;
    // الإطار 4H حارس نهائي: يجب أن يدعم اتجاه الإشارة صراحة (Score≥2) ولا يكون مؤيدًا للاتجاه المعاكس.
    let dir = null;
    if (longVotes >= 3 && longVotes > shortVotes && ev4h && ev4h.longScore >= 2) dir = 'LONG';
    else if (shortVotes >= 3 && shortVotes > longVotes && ev4h && ev4h.shortScore >= 2) dir = 'SHORT';
    if (!dir || !last4h) return null;
    return { dir, last4h, votes: dir === 'LONG' ? longVotes : shortVotes, votesByTf, rsi4h, rsi15, frames };
  }).catch(() => null);
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
  // المرحلة 1: قرار الاتجاه من نظام الأطر المتعددة (4 أطر، اتفاق 3 على الأقل، واتجاه 4H راسخ).
  return evaluateMTF(symbol).then(mtf => {
    if (!mtf) return null;
    // المرحلة 2: الأهداف من ATR على الإطار 15د — أهداف أقرب وأسهل بلوغًا من نموذج 4H القديم.
    const frames15 = mtf.frames.find(f => f?.tf === '15m');
    if (!frames15 || frames15.kl.length < MTF_MIN_CANDLES['15m']) return null;
    const a = atr(frames15.kl);
    const price = mtf.last4h;
    const k = { LONG: 1, SHORT: -1 }[mtf.dir];
    return {
      dir: mtf.dir, price, votes: mtf.votes, votesByTf: mtf.votesByTf, rsi4h: mtf.rsi4h, rsi15: mtf.rsi15,
      sl: +(price - k * 1.5 * a).toFixed(12),
      tp1: +(price + k * 1.0 * a).toFixed(12),
      tp2: +(price + k * 2.0 * a).toFixed(12),
      tp3: +(price + k * 3.0 * a).toFixed(12),
      atr15: a,
      tf: 'MTF 5m+15m+1h+4h'
    };
  }).catch(() => null);
}

const fmtDate = () => new Date().toISOString().slice(0, 10);
const fmtTime = () => new Date().toLocaleTimeString('en-GB', { hour12: false, timeZone: 'Asia/Riyadh' });

async function scan() {
  const today = fmtDate();
  let tracked = loadTracked();
  const todayCount = tracked.filter(t => t.date === today).length;
  let emittedToday = todayCount;
  console.log(`بدء الفحص — ${new Date().toISOString()} — إشارات اليوم: ${todayCount}/${MAX_SIGNALS_PER_DAY}`);

  // نافذة اليوم الحالية: إن كانت نافذة اليوم قد استُهلكت إشارة فيها، يُكتفى بذلك ويُنتظر الفحص القادم.
  const todaySlotSignals = tracked.filter(t => t.date === today && t.slot === currentSlot() && !t.closed).length;
  if (todaySlotSignals > 0) {
    console.log(`نافذة اليوم (${currentSlot()}) استُهلكت بالفعل — ننتظر النافذة التالية`);
    return;
  }
  if (todayCount >= MAX_SIGNALS_PER_DAY) { console.log('حد إشارات اليوم وصل'); return; }

  // الإغلاق الذاتي أولًا: متابعة الصفقات المفتوحة وتسجيل نتائجها.
  // ملاحظة: checkOpenTrades يعيد تحميل السجل ويحفظه، فيجب إعادة تحميله هنا (let tracked بعد الإغلاق).
  await checkOpenTrades();
  tracked = loadTracked();

  const res = await Promise.all(SYMS.map(evaluate));
  // اختيار إشارة واحدة للنافذة الحالية: الأفضل جودة (أكثر أصواتًا) وغير مكررة في اليوم.
  const candidates = [];
  for (let i = 0; i < res.length; i++) {
    const s = res[i];
    if (!s) continue;
    if (tracked.some(t => t.date === today && t.symbol === SYMS[i])) continue;
    candidates.push({ ...s, symbol: SYMS[i] });
  }
  candidates.sort((a, b) => (b.votes || 0) - (a.votes || 0) || (b.rsi4h || 0) - (a.rsi4h || 0));
  // السجل المحدّث بعد الإغلاق الذاتي هو الأساس (ملاحظة: tracked أعيد تحميله أعلاه).
  const loopSignals = candidates.slice(0, 1);
  for (let i = 0; i < loopSignals.length; i++) {
    const s = loopSignals[i];
    if (!s) continue;
    if (emittedToday >= MAX_SIGNALS_PER_DAY) break;
    await loadPricePrecision(s.symbol);
    s.priceDecimals = pricePrecisionCache.get(s.symbol) ?? fallbackPriceDecimals(s.price);
    const micro = await getMarketMicrostructure(s.symbol);
    if (micro) {
      s.orderBookImbalance = Number.isFinite(micro.orderBookImbalance) ? Number(micro.orderBookImbalance.toFixed(2)) : null;
      s.tapeBuyPct = Number.isFinite(micro.tapeBuyPct) ? Number(micro.tapeBuyPct.toFixed(2)) : null;
      s.tapeSamples = micro.samples;
    }
    s.date = today; s.ts = Date.now(); s.slot = currentSlot(); s.closed = false;
    tracked.push(s);
    saveTracked(tracked);
    emittedToday++;
    const microLine = micro ? `\n📚 Order Book: ${formatMicro(micro.orderBookImbalance)}% | Tape شراء: ${formatMicro(micro.tapeBuyPct)}%` : '\n📚 Order Book/Tape: غير متاح مؤقتًا';
    const tfLine = Array.isArray(s.votesByTf) && s.votesByTf.length ? `\n🗓️ أطر مؤيدة: ${s.votesByTf.join(' | ')}` : '';
    const rsiLine = `RSI 4H: ${s.rsi4h ?? '—'} | RSI 15د: ${s.rsi15 ?? '—'}`;
    const msg = `<b>📡 MaYor Signal (MTF)</b>\n\n${s.dir === 'LONG' ? '🟢' : '🔴'} <b>${s.dir} ${s.symbol}</b>\n📍 Entry: <code>${formatPrice(s.price, s.symbol)}</code>\n🛑 SL: <code>${formatPrice(s.sl, s.symbol)}</code>\n🎯 TP1: <code>${formatPrice(s.tp1, s.symbol)}</code>\n🎯 TP2: <code>${formatPrice(s.tp2, s.symbol)}</code>\n🎯 TP3: <code>${formatPrice(s.tp3, s.symbol)}</code>\n📊 ${rsiLine} | أصوات: ${s.votes}/4${tfLine}${microLine}\n⏰ ${fmtTime()}`;
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
