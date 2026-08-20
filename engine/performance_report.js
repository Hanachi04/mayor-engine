// تقارير أداء MaYor v3 — بحثية/إشعارية فقط؛ لا تنفذ أوامر تداول.
// يولد ملخصات يومية وأسبوعية وشهرية من data/tracked.json بعد الرسوم والانزلاق.

'use strict';

const fs = require('fs');
const path = require('path');
const { CONFIG, netPnl } = require('./scan.js');

const TOKEN = process.env.TELEGRAM_TOKEN || '';
const CHAT = process.env.TELEGRAM_CHAT || '';
const REQUEST_TIMEOUT_MS = Number(process.env.REQUEST_TIMEOUT_MS || 12000);
const DATA_DIR = path.join(__dirname, '..', 'data');
const TRACKED_FILE = path.join(DATA_DIR, 'tracked.json');
const REPORTS_DIR = path.join(DATA_DIR, 'reports');

const PERIODS = {
  daily: { label: 'اليومي', hours: 24, file: 'daily.json' },
  weekly: { label: 'الأسبوعي', hours: 7 * 24, file: 'weekly.json' },
  monthly: { label: 'الشهري (آخر 30 يومًا)', hours: 30 * 24, file: 'monthly.json' }
};

const finite = (value, fallback = 0) => Number.isFinite(Number(value)) ? Number(value) : fallback;
const esc = value => String(value ?? '').replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]));
const dateISO = (value = new Date()) => new Date(value).toISOString().slice(0, 10);
const riyadhTime = () => new Date().toLocaleTimeString('en-GB', { hour12: false, timeZone: 'Asia/Riyadh' });

function loadTracked() {
  try {
    const raw = fs.existsSync(TRACKED_FILE) ? fs.readFileSync(TRACKED_FILE, 'utf8') : '[]';
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch (error) {
    console.log(`تعذر قراءة tracked.json: ${error.message}`);
    return [];
  }
}

function costsForTrade(trade) {
  if (trade.closed && Number.isFinite(Number(trade.grossPnlPct)) && Number.isFinite(Number(trade.closePct))) {
    return {
      grossPct: finite(trade.grossPnlPct), feesPct: finite(trade.feesPct), slippagePct: finite(trade.slippagePct),
      netPct: finite(trade.closePct), netUsd: finite(trade.netPnlUsd, NaN)
    };
  }
  if (!trade.closed || !Number.isFinite(Number(trade.price)) || !Number.isFinite(Number(trade.closePrice))) {
    return { grossPct: 0, feesPct: 0, slippagePct: 0, netPct: 0, netUsd: NaN };
  }
  const calculated = netPnl(Number(trade.price), Number(trade.closePrice), trade.dir, CONFIG);
  const notional = finite(trade.position?.notional, NaN);
  return {
    grossPct: calculated.grossPct,
    feesPct: calculated.feesPct,
    slippagePct: CONFIG.slippageRate * 2 * 100,
    netPct: calculated.netPct,
    netUsd: Number.isFinite(notional) ? notional * calculated.netPct / 100 : NaN
  };
}

function drawdownFromPcts(values) {
  let cumulative = 0, peak = 0, maxDrawdown = 0;
  for (const value of values) {
    cumulative += value;
    peak = Math.max(peak, cumulative);
    maxDrawdown = Math.min(maxDrawdown, cumulative - peak);
  }
  return maxDrawdown;
}

function normalizePeriod(period) {
  return PERIODS[period] ? period : 'daily';
}

function buildPerformanceReport(period = 'daily', now = Date.now()) {
  const key = normalizePeriod(period);
  const definition = PERIODS[key];
  const windowStart = now - definition.hours * 3600 * 1000;
  const allTrades = loadTracked();
  const trades = allTrades.filter(trade => finite(trade.ts, 0) >= windowStart && finite(trade.ts, 0) <= now);
  const closed = trades.filter(trade => trade.closed);
  const open = trades.filter(trade => !trade.closed);
  const byResult = {};
  const bySymbol = {};
  const netPcts = [];
  let wins = 0, losses = 0, neutral = 0, grossPct = 0, feesPct = 0, slippagePct = 0, netPct = 0, netUsd = 0, hasUsd = false;

  for (const trade of trades) {
    const result = trade.closed ? (trade.closeResult || 'غير محدد') : 'مفتوحة';
    byResult[result] = (byResult[result] || 0) + 1;
    if (!trade.closed) continue;
    const costs = costsForTrade(trade);
    grossPct += costs.grossPct;
    feesPct += costs.feesPct;
    slippagePct += costs.slippagePct;
    netPct += costs.netPct;
    netPcts.push(costs.netPct);
    if (costs.netPct > 0) wins++;
    else if (costs.netPct < 0) losses++;
    else neutral++;
    if (Number.isFinite(costs.netUsd)) { netUsd += costs.netUsd; hasUsd = true; }
    const bucket = bySymbol[trade.symbol] || (bySymbol[trade.symbol] = { count: 0, wins: 0, losses: 0, netPct: 0 });
    bucket.count++;
    bucket.netPct += costs.netPct;
    if (costs.netPct > 0) bucket.wins++;
    if (costs.netPct < 0) bucket.losses++;
  }

  const symbols = Object.entries(bySymbol).sort((a, b) => b[1].netPct - a[1].netPct);
  const positive = netPcts.filter(value => value > 0).reduce((sum, value) => sum + value, 0);
  const negative = Math.abs(netPcts.filter(value => value < 0).reduce((sum, value) => sum + value, 0));
  const summary = {
    signals: trades.length,
    closed: closed.length,
    open: open.length,
    wins,
    losses,
    neutral,
    winRatePct: closed.length ? wins / closed.length * 100 : 0,
    grossPnlPct: grossPct,
    feesPct,
    slippagePct,
    netPnlPct: netPct,
    netPnlUsd: hasUsd ? netUsd : null,
    averageNetPnlPct: closed.length ? netPct / closed.length : 0,
    profitFactor: negative > 0 ? positive / negative : (positive > 0 ? null : 0),
    maxDrawdownPct: drawdownFromPcts(netPcts),
    bestSymbol: symbols[0] ? { symbol: symbols[0][0], netPct: symbols[0][1].netPct } : null,
    worstSymbol: symbols.length ? { symbol: symbols.at(-1)[0], netPct: symbols.at(-1)[1].netPct } : null
  };

  return {
    schemaVersion: 1,
    engineVersion: 'cloud-pro-mtf-3.0-unified',
    period: key,
    periodLabel: definition.label,
    generatedAt: new Date(now).toISOString(),
    windowStart: new Date(windowStart).toISOString(),
    windowEnd: new Date(now).toISOString(),
    accounting: { takerFeeRate: CONFIG.takerFeeRate, slippageRate: CONFIG.slippageRate, note: 'النتائج بحثية ومحسوبة بعد الرسوم والانزلاق النظريين.' },
    summary,
    byResult,
    bySymbol
  };
}

function signed(value, digits = 3) { return `${value >= 0 ? '+' : ''}${value.toFixed(digits)}`; }

function buildTelegramMessage(report) {
  const s = report.summary;
  const lines = [
    `📊 <b>تقرير MaYor Cloud Pro v3 ${report.periodLabel}</b>`,
    `📅 ${dateISO(report.windowStart)} ← ${dateISO(report.windowEnd)}`,
    '',
    `• الإشارات المنشأة: <b>${s.signals}</b>`,
    `• صفقات محسومة: <b>${s.closed}</b> | مفتوحة: <b>${s.open}</b>`,
    s.closed ? `• رابحة: <b>${s.wins}</b> | خاسرة: <b>${s.losses}</b> | Win Rate: <b>${s.winRatePct.toFixed(1)}%</b>` : '• لا توجد صفقات محسومة داخل الفترة',
    s.closed ? `• PnL الإجمالي: <b>${signed(s.grossPnlPct)}%</b>` : '',
    s.closed ? `• الرسوم: <b>-${s.feesPct.toFixed(3)}%</b> | الانزلاق: <b>-${s.slippagePct.toFixed(3)}%</b>` : '',
    s.closed ? `• <b>صافي PnL: ${signed(s.netPnlPct)}%</b>${s.netPnlUsd !== null ? ` | $${s.netPnlUsd.toFixed(2)}` : ''}` : '',
    s.closed && s.profitFactor !== null ? `• معامل الربح: <b>${s.profitFactor.toFixed(2)}</b> | أقصى تراجع تسلسلي: <b>${s.maxDrawdownPct.toFixed(3)}%</b>` : '',
    s.bestSymbol ? `• أفضل زوج: <b>${esc(s.bestSymbol.symbol)} (${signed(s.bestSymbol.netPct)}%)</b>` : '',
    s.worstSymbol && s.worstSymbol.symbol !== s.bestSymbol?.symbol ? `• أضعف زوج: <b>${esc(s.worstSymbol.symbol)} (${signed(s.worstSymbol.netPct)}%)</b>` : '',
    '',
    `⚙️ رسوم taker ${(report.accounting.takerFeeRate * 100).toFixed(3)}%/جهة + انزلاق ${(report.accounting.slippageRate * 100).toFixed(3)}%/جهة`,
    `🔍 بحثي/إشعاري فقط ولا ينفذ صفقات | ${riyadhTime()} الرياض`
  ].filter(Boolean);
  return lines.join('\n');
}

function saveReport(report) {
  if (!fs.existsSync(REPORTS_DIR)) fs.mkdirSync(REPORTS_DIR, { recursive: true });
  const filename = PERIODS[report.period].file;
  const target = path.join(REPORTS_DIR, filename);
  fs.writeFileSync(target, JSON.stringify(report, null, 2));
  return target;
}

async function sendReport(message) {
  if (!TOKEN || !CHAT) { console.log('تقرير Telegram معطّل: TELEGRAM_TOKEN أو TELEGRAM_CHAT غير متوفر'); return false; }
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const response = await fetch(`https://api.telegram.org/bot${TOKEN}/sendMessage`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, signal: controller.signal,
      body: JSON.stringify({ chat_id: CHAT, text: message, parse_mode: 'HTML' })
    });
    console.log(response.ok ? '✓ أُرسل تقرير الأداء' : `✗ فشل إرسال التقرير (HTTP ${response.status})`);
    return response.ok;
  } catch (error) {
    console.log(`فشل إرسال التقرير: ${error.message}`);
    return false;
  } finally {
    clearTimeout(timer);
  }
}

async function run(period = 'daily') {
  const report = buildPerformanceReport(period);
  const file = saveReport(report);
  const message = buildTelegramMessage(report);
  console.log(message.replace(/<[^>]+>/g, ''));
  if (!/^(0|false|no)$/i.test(process.env.REPORT_SEND || '1')) await sendReport(message);
  return { report, message, file };
}

if (require.main === module) run(process.argv[2] || 'daily').catch(error => { console.error(error); process.exitCode = 1; });

module.exports = { PERIODS, costsForTrade, buildPerformanceReport, buildTelegramMessage, saveReport, sendReport, run };
