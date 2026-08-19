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
  const url = `https://api.binance.com/api/v3/klines?symbol=${symbol}&interval=4h&limit=150`;
  const res = await fetch(url);
  const data = await res.json();
  return data.map(k => ({ open: +k[1], high: +k[2], low: +k[3], close: +k[4], volume: +k[5], ts: k[0] }));
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
    if (kl.length < 150) return null;
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
  console.log(`بدء الفحص — ${new Date().toISOString()} — إشارات اليوم: ${todayCount}/${MAX_SIGNALS_PER_DAY}`);

  if (todayCount >= MAX_SIGNALS_PER_DAY) { console.log('حد إشارات اليوم وصل'); return; }

  const res = await Promise.all(SYMS.map(evaluate));
  for (const s of res) {
    if (!s) continue;
    s.date = today; s.ts = Date.now(); s.closed = false;
    s.symbol = SYMS[res.indexOf(s)];
    tracked.push(s);
    saveTracked(tracked);
    const msg = `<b>📡 MaYor Signal</b>\n\n${s.dir === 'LONG' ? '🟢' : '🔴'} <b>${s.dir} ${s.symbol}</b>\n📍 Entry: <code>${s.price.toFixed(2)}</code>\n🛑 SL: <code>${s.sl.toFixed(2)}</code>\n🎯 TP1: <code>${s.tp1.toFixed(2)}</code>\n🎯 TP2: <code>${s.tp2.toFixed(2)}</code>\n🎯 TP3: <code>${s.tp3.toFixed(2)}</code>\n📊 RSI: ${s.rsi} | المصدر: Binance 4H\n⏰ ${fmtTime()}`;
    await send(msg);
    await appendToSheet([
      tracked.filter(t => t.date === today).length,
      s.date, fmtTime(), s.symbol, s.dir,
      +s.price.toFixed(2), +s.sl.toFixed(2),
      +s.tp1.toFixed(2), +s.tp2.toFixed(2), +s.tp3.toFixed(2),
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

scan().catch(e => { console.error('خطأ فادح:', e.message); process.exit(1); });
