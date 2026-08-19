// تقرير الأداء الأسبوعي — يُشغَّل من GitHub Actions كل أسبوع (workflow: weekly-report.yml)
// يقرأ data/tracked.json ويحسب إحصاءات الأداء ثم يرسل التقرير إلى قناة Telegram

const fs = require('fs');
const path = require('path');

const TOKEN = process.env.TELEGRAM_TOKEN;
const CHAT = process.env.TELEGRAM_CHAT || '@Paracaudina';
const DATA_DIR = path.join(__dirname, '..', 'data');
const trackedFile = path.join(DATA_DIR, 'tracked.json');

const LOAD_MAX_AGE_MS = 7 * 24 * 3600 * 1000; // نطاق التقرير: آخر 7 أيام

const fmtDate = (d = new Date()) => d.toISOString().slice(0, 10);
const fmtTime = () => new Date().toLocaleTimeString('en-GB', { hour12: false, timeZone: 'Asia/Riyadh' });

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
  const decimals = fallbackPriceDecimals(n);
  return n.toFixed(Math.min(12, Math.max(0, decimals)));
}

function loadTracked() {
  return JSON.parse(fs.existsSync(trackedFile) ? fs.readFileSync(trackedFile) : '[]');
}

async function send(msg) {
  if (!TOKEN) { console.log('(تليجرام معطّل: لا يوجد TELEGRAM_TOKEN)'); return; }
  const url = `https://api.telegram.org/bot${TOKEN}/sendMessage`;
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ chat_id: CHAT, text: msg, parse_mode: 'HTML' })
  });
  console.log(res.ok ? `✓ أُرسل التقرير الأسبوعي` : `✗ فشل الإرسال (HTTP ${res.status})`);
}

function main() {
  const now = Date.now();
  const weekStart = now - LOAD_MAX_AGE_MS;
  const tracked = loadTracked();
  const startLabel = tracked.length > 0
    ? fmtDate(new Date(Math.max(weekStart, Math.min(...tracked.map(t => t.ts)))))
    : fmtDate(new Date(weekStart));

  const week = tracked.filter(t => t.ts >= weekStart);
  const closed = week.filter(t => t.closed);
  const open = week.filter(t => !t.closed);

  const summary = {
    total: week.length,
    closed: closed.length,
    open: open.length,
    byResult: {},
    winCount: 0,
    losses: 0,
    netPctSum: 0,
    perSymbol: {},
    closedPcts: [],
  };

  for (const t of week) {
    const key = t.closed ? t.closeResult : 'مفتوحة';
    summary.byResult[key] = (summary.byResult[key] || 0) + 1;
    if (t.closed) {
      const r = t.closeResult;
      if (r.startsWith('TP')) {
        summary.winCount++;
        summary.closedPcts.push(t.closePct);
        summary.netPctSum += t.closePct;
      } else if (r === 'SL') {
        summary.losses++;
        summary.closedPcts.push(t.closePct);
        summary.netPctSum += t.closePct;
      } else {
        // انتهت المدة: تُحتسب ضمن النتائج بالنسبة الفعلية
        summary.closedPcts.push(t.closePct);
        summary.netPctSum += t.closePct;
        if (t.closePct > 0) summary.winCount++;
      }
      summary.perSymbol[t.symbol] = summary.perSymbol[t.symbol] || { wins: 0, losses: 0, sum: 0, count: 0 };
      const s = summary.perSymbol[t.symbol];
      s.count++;
      s.sum += t.closePct;
      if (r.startsWith('TP')) s.wins++;
      else if (r === 'SL') s.losses++;
    }
  }

  const hitRate = summary.closed > 0
    ? Math.round(summary.winCount / summary.closed * 100)
    : 0;
  const net = summary.closedPcts.length
    ? Number(summary.closedPcts.reduce((a, b) => a + b, 0).toFixed(2))
    : 0;

  const best = Object.entries(summary.perSymbol)
    .filter(([, s]) => s.count > 0)
    .sort((a, b) => b[1].sum - a[1].sum)[0];
  const worst = Object.entries(summary.perSymbol)
    .filter(([, s]) => s.count > 0)
    .sort((a, b) => a[1].sum - b[1].sum)[0];

  const emoji = summary.winCount >= summary.losses ? '📈' : '📉';
  const lines = [
    `${emoji} <b>تقرير MaYor الأسبوعي</b>`,
    `📅 من ${startLabel} إلى ${fmtDate()}`,
    ``,
    `📊 <b>ملخص الأسبوع</b>`,
    `• عدد الإشارات: <b>${summary.total}</b>`,
    `• صفقات مُحسومة: <b>${summary.closed}</b> | لا تزال مفتوحة: <b>${summary.open}</b>`,
    summary.closed > 0 ? `• أصابت هدفًا (TP): <b>${summary.winCount}</b> | ضربت SL: <b>${summary.losses}</b>` : '• لا صفقات مُحسومة بعد',
    summary.closed > 0 ? `• نسبة النجاح (win rate): <b>${hitRate}%</b>` : '',
    summary.closed > 0 ? `• الربح الصافي التراكمي: <b>${net > 0 ? '+' : ''}${net}%</b>` : '',
  ].filter(Boolean);

  if (summary.closed > 0 && best) {
    lines.push('');
    lines.push(`🏆 <b>أفضل زوج: ${best[0]} (+${best[1].sum.toFixed(2)}% من ${best[1].count} صفقة مغلقة)</b>`);
  }
  if (summary.closed > 0 && worst && worst[0] !== best?.[0]) {
    lines.push(`⚠️ <b>أضعف زوج: ${worst[0]} (${worst[1].sum.toFixed(2)}% من ${worst[1].count})</b>`);
  }

  lines.push('');
  lines.push(`🔍 <b>توزيع النتائج</b>`);
  const order = ['TP1', 'TP2', 'TP3', 'SL', 'انتهت المدة', 'مفتوحة'];
  for (const k of order) {
    if (summary.byResult[k]) lines.push(`• ${k}: <b>${summary.byResult[k]}</b>`);
  }

  if (open.length > 0) {
    lines.push('');
    lines.push(`⏳ <b>صفقات مفتوحة الآن</b>`);
    for (const t of open.slice(0, 5)) {
      lines.push(`• ${t.symbol} ${t.dir} بدخول <code>${formatPrice(t.price, t.symbol)}</code> (${t.date})`);
    }
  }

  if (summary.closed > 0) {
    const avgHoldMs = summary.closedPcts.length
      ? week.filter(t => t.closed && t.closeAt).reduce((acc, t) => acc + (new Date(t.closeAt) - t.ts), 0) / Math.max(1, week.filter(t => t.closed && t.closeAt).length)
      : 0;
    const avgHours = Number.isFinite(avgHoldMs) && avgHoldMs > 0 ? (avgHoldMs / 3600000).toFixed(1) : null;
    if (avgHours) lines.push(`⏰ متوسط مدة الصفقة: <b>${avgHours} ساعة</b>`);
  }

  lines.push('');
  lines.push(`⚙️ المحرك يعمل 24/7 — الإشارات كل 4 ساعات تقريبًا | ${fmtTime()}`);

  const msg = lines.join('\n');
  return { msg, summary };
}

if (require.main === module) {
  const { msg, summary } = main();
  console.log(msg.replace(/<[^>]+>/g, ''));
  send(msg).then(() => console.log('اكتمل التقرير الأسبوعي')).catch(e => { console.error(e); process.exit(1); });
}
