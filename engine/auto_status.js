'use strict';
const { stateDir } = require('./state_dir');
const { readJsonWithBackup } = require('./atomic_json');
/**
 * Unified auto documentation — MaYor + Scalper + Aegis
 * Writes: docs/STATUS.md | data/reports/status.json | appends history.jsonl
 * Research only — no trade orders.
 */

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const DATA = path.join(ROOT, 'data');
const REPORTS = path.join(DATA, 'reports');
const DOCS = path.join(ROOT, 'docs');

function readJson(fp, fallback) {
  try {
    const validate = Array.isArray(fallback) ? Array.isArray : fallback && typeof fallback === 'object'
      ? value => value && typeof value === 'object' && !Array.isArray(value) : null;
    return readJsonWithBackup(fp, fallback, { validate });
  } catch {
    return fallback;
  }
}

function finite(v, fb = 0) {
  const n = Number(v);
  return Number.isFinite(n) ? n : fb;
}

function closedNet(t) {
  for (const k of ['closePct', 'netPct', 'net_pnl_pct']) {
    if (t[k] !== undefined && t[k] !== null && Number.isFinite(Number(t[k]))) return Number(t[k]);
  }
  return null;
}

function metrics(trades) {
  const nets = [];
  for (const t of trades) {
    const n = closedNet(t);
    if (n !== null) nets.push(n);
  }
  const wins = nets.filter(n => n > 0);
  const losses = nets.filter(n => n <= 0);
  const gw = wins.reduce((a, b) => a + b, 0);
  const gl = Math.abs(losses.reduce((a, b) => a + b, 0));
  const pf = gl === 0 ? (gw > 0 ? 99 : 0) : gw / gl;
  const net = nets.reduce((a, b) => a + b, 0);
  // max DD on cumulative
  let peak = 0, eq = 0, maxDd = 0, streak = 0, maxStreak = 0;
  for (const n of nets) {
    eq += n;
    peak = Math.max(peak, eq);
    maxDd = Math.max(maxDd, peak - eq);
    if (n < 0) { streak++; maxStreak = Math.max(maxStreak, streak); }
    else streak = 0;
  }
  const expectancy = nets.length ? net / nets.length : 0;
  return {
    closed: nets.length,
    wins: wins.length,
    losses: losses.length,
    winRatePct: nets.length ? Number(((wins.length / nets.length) * 100).toFixed(1)) : 0,
    netPct: Number(net.toFixed(3)),
    profitFactor: Number(pf.toFixed(3)),
    expectancy: Number(expectancy.toFixed(3)),
    maxDrawdownPct: Number(maxDd.toFixed(3)),
    maxLosingStreak: maxStreak
  };
}

function modeOf(t) {
  return t.strategyMode || 'legacy';
}

function inLastDays(t, days) {
  const at = t.closeAt || t.date;
  if (!at) return false;
  const ts = Date.parse(at);
  if (!Number.isFinite(ts)) return false;
  return ts >= Date.now() - days * 86400000;
}

function summarizeTracked(tracked, label) {
  const list = Array.isArray(tracked) ? tracked : [];
  const closed = list.filter(t => t.closed || t.closeResult);
  const open = list.filter(t => !t.closed && !t.closeResult);
  const m = metrics(closed);
  return {
    label,
    total: list.length,
    open: open.length,
    ...m,
    lastAt: closed.length ? (closed[closed.length - 1].closeAt || closed[closed.length - 1].at || null) : null
  };
}

function verdictFrom(netPct, closed, gatePassed) {
  if (gatePassed === false && closed < 5) return '⏳ جمع عينة';
  if (closed < 5) return '⏳ عينة غير كافية';
  if (netPct > 0.5) return '✅ صافي موجب (بحثي)';
  if (netPct > -0.5) return '➖ حول الصفر';
  return '❌ صافي سالب (بحثي)';
}

function build() {
  const mayorTracked = readJson(path.join(stateDir(), 'tracked.json'), []);
  const mayorVer = readJson(path.join(stateDir(), 'verification.json'), {});
  const scalperTracked = readJson(path.join(stateDir(), 'scalper', 'tracked.json'), []);
  const scalperVer = readJson(path.join(stateDir(), 'scalper', 'verification.json'), {});
  const scalperHb = readJson(path.join(stateDir(), 'scalper', 'heartbeat.json'), {});
  const aegisReport = readJson(path.join(ROOT, 'aegis-quant', 'data', 'pipeline_report.json'), {});
  const daily = readJson(path.join(REPORTS, 'daily.json'), null);
  const weekly = readJson(path.join(REPORTS, 'weekly.json'), null);
  const adaptState = readJson(path.join(stateDir(), 'adaptation_state.json'), { blacklist: {} });
  const adaptBans = Object.entries(adaptState.blacklist || {}).map(([sym, info]) => ({
    symbol: sym, until: info.until, reason: info.reason, pf: info.pf, netSum: info.netSum
  }));

  const closedMayor = mayorTracked.filter(t => t.closed || t.closeResult);
  const coreTrades = closedMayor.filter(t => modeOf(t) === 'core');
  const balancedTrades = closedMayor.filter(t => modeOf(t) === 'balanced');
  const legacyTrades = closedMayor.filter(t => modeOf(t) === 'legacy' || !t.strategyMode);
  const core7 = coreTrades.filter(t => inLastDays(t, 7));
  const core30 = coreTrades.filter(t => inLastDays(t, 30));

  const activeMode = process.env.STRATEGY_MODE ||
    (coreTrades.length ? 'core' : null) ||
    [...closedMayor].reverse().find(t => t.strategyMode)?.strategyMode ||
    'unknown';

  const latestEngine = [...closedMayor].reverse().find(t => t.engineVersion)?.engineVersion ||
    mayorVer.engineVersion || 'cloud-pro-mtf';

  const mayor = summarizeTracked(mayorTracked, 'MaYor');
  const scalper = summarizeTracked(scalperTracked, 'Scalper');
  const coreM = metrics(coreTrades);
  const core7m = metrics(core7);
  const core30m = metrics(core30);
  const legacyM = metrics(legacyTrades.concat(balancedTrades));

  const aegisProfit = aegisReport.profitability || {};
  const aegisOperational = !!(aegisReport.profitability_evaluated && aegisProfit.status);
  const generatedAt = new Date().toISOString();

  const status = {
    schemaVersion: 2,
    generatedAt,
    systems: {
      mayor: {
        ...mayor,
        engineVersion: latestEngine,
        strategyModeActive: activeMode,
        modeCounts: {
          core: coreTrades.length,
          balanced: balancedTrades.length,
          legacy: legacyTrades.length
        },
        core: coreM,
        coreLast7d: core7m,
        coreLast30d: core30m,
        legacyOrBalanced: legacyM,
        gate: { status: mayorVer.status || 'UNKNOWN', passed: !!mayorVer.passed, reason: mayorVer.reason || null },
        verdict: verdictFrom(coreM.closed ? coreM.netPct : mayor.netPct, coreM.closed || mayor.closed, mayorVer.passed)
      },
      scalper: {
        ...scalper,
        engineVersion: scalperHb.engineVersion || scalperVer.engineVersion || 'futures-scalper',
        gate: { status: scalperVer.status || 'UNKNOWN', passed: !!scalperVer.passed, reason: scalperVer.reason || null },
        heartbeat: {
          at: scalperHb.at || null,
          ok: scalperHb.ok === true,
          dataFetchOk: scalperHb.dataFetchOk,
          signalsAvailable: scalperHb.signalsAvailable,
          phase: scalperHb.phase || null,
          error: scalperHb.error || null
        },
        verdict: scalperHb.dataFetchOk === false
          ? '❌ فشل جلب البيانات'
          : verdictFrom(scalper.netPct, scalper.closed, scalperVer.passed)
      },
      aegis: {
        symbol: aegisReport.symbol || 'BTCUSDT',
        operational: aegisOperational,
        tradeDecisions: aegisReport.trade_decisions ?? null,
        profitabilityEvaluated: !!(aegisReport.profitability_evaluated || aegisProfit.profitability_evaluated),
        profitability: aegisProfit.status ? {
          status: aegisProfit.status,
          trades: aegisProfit.trades,
          netPct: aegisProfit.net_pct,
          profitFactor: aegisProfit.profit_factor,
          winRatePct: aegisProfit.win_rate_pct
        } : null,
        verdict: !aegisOperational
          ? '⏸️ منفّذ في الكود لكن غير مُقيَّم تشغيلياً'
          : aegisProfit.status === 'EDGE_CANDIDATE' ? '✅ مرشح حافة (بحثي)'
          : aegisProfit.status === 'NO_TRADES' ? '⏳ بلا صفقات' : '❌ ضعيف/سالب (بحثي)'
      }
    },
    adaptation: {
      activeBans: adaptBans.length,
      bans: adaptBans.slice(0, 15)
    },
    reports: {
      dailyNetPct: daily?.summary?.netPnlPct ?? null,
      weeklyNetPct: weekly?.summary?.netPnlPct ?? null,
      dailyClosed: daily?.summary?.closed ?? null,
      weeklyClosed: weekly?.summary?.closed ?? null
    },
    note: 'نتائج بحثية. Core metrics منفصلة عن legacy/balanced. ليست ضمان ربح.'
  };

  const fmtM = (m) => m && m.closed
    ? `${m.closed} صفقات | WR ${m.winRatePct}% | صافي ${m.netPct}% | PF ${m.profitFactor} | DD ${m.maxDrawdownPct}% | streak ${m.maxLosingStreak}`
    : 'لا بيانات';

  const md = [
    '# حالة الأنظمة — توثيق تلقائي',
    '',
    `**آخر تحديث:** ${generatedAt}`,
    '',
    '> بحثي/إشعاري فقط. لا يضمن ربحاً ولا ينفذ أوامر حقيقية.',
    '',
    '## MaYor Cloud Pro',
    '',
    `| الحقل | القيمة |`,
    `|-------|--------|`,
    `| النمط النشط (تشغيل) | **${activeMode}** |`,
    `| إصدار المحرك (آخر صفقة) | ${latestEngine} |`,
    `| الحكم (يعتمد core إن وُجد) | ${status.systems.mayor.verdict} |`,
    `| توزيع الأوضاع | core=${coreTrades.length} balanced=${balancedTrades.length} legacy=${legacyTrades.length} |`,
    `| بوابة الإحصاء | ${status.systems.mayor.gate.status} (${status.systems.mayor.gate.passed ? 'PASS' : 'لا'}) |`,
    '',
    '### CORE فقط (بحثي)',
    '',
    `| نافذة | ملخص |`,
    `|--------|--------|`,
    `| منذ التفعيل | ${fmtM(coreM)} |`,
    `| آخر 7 أيام | ${fmtM(core7m)} |`,
    `| آخر 30 يوماً | ${fmtM(core30m)} |`,
    '',
    '### Legacy / Balanced (لا يمثل أداء core)',
    '',
    fmtM(legacyM),
    '',
    '## Futures Scalper',
    '',
    `| الحقل | القيمة |`,
    `|-------|--------|`,
    `| الحكم | ${status.systems.scalper.verdict} |`,
    `| الإصدار | ${status.systems.scalper.engineVersion} |`,
    `| صفقات مغلقة | ${scalper.closed} | صافي ${scalper.netPct}% |`,
    `| البوابة | ${status.systems.scalper.gate.status} — ${status.systems.scalper.gate.reason || ''} |`,
    `| نبضة ok / dataFetch | ${scalperHb.ok} / ${scalperHb.dataFetchOk} | phase=${scalperHb.phase || '—'} |`,
    `| خطأ جلب | ${scalperHb.error || '—'} |`,
    '',
    '## Aegis Quant',
    '',
    `| الحقل | القيمة |`,
    `|-------|--------|`,
    `| الحالة | ${status.systems.aegis.verdict} |`,
    `| تشغيلي مُقيَّم؟ | ${aegisOperational ? 'نعم' : 'لا — الكود موجود بدون pipeline حي مجدول بنتائج معتمدة'} |`,
    '',
    '## التكيف الآمن (طبقة A)',
    '',
    adaptBans.length
      ? [
          `| رمز | حتى | سبب | PF | صافي |`,
          `|-----|-----|-----|----|------|`,
          ...adaptBans.slice(0, 12).map(b => `| ${b.symbol} | ${String(b.until || '').slice(0, 16)} | ${b.reason || '—'} | ${b.pf ?? '—'} | ${b.netSum ?? '—'} |`)
        ].join('\n')
      : 'لا رموز محظورة حالياً.',
    '',
    '## تقارير MaYor الدورية (كل الأوضاع)',
    '',
    `| الفترة | صفقات مغلقة | صافي % |`,
    `|--------|---------------|--------|`,
    `| يومي | ${status.reports.dailyClosed ?? '—'} | ${status.reports.dailyNetPct ?? '—'} |`,
    `| أسبوعي | ${status.reports.weeklyClosed ?? '—'} | ${status.reports.weeklyNetPct ?? '—'} |`,
    '',
    '## ماذا تفعل؟',
    '',
    '1. اعتمد مقاييس **CORE** لا الإجمالي المختلط.',
    '2. لا تفعّل ML filter والدقة خارج العينة ضعيفة.',
    '3. Scalper: راقب dataFetchOk وليس نجاح الـ workflow فقط.',
    '',
    '---',
    '*Generated by `engine/auto_status.js`*',
    ''
  ].join('\n');

  return { status, md };
}

function main() {
  if (!fs.existsSync(REPORTS)) fs.mkdirSync(REPORTS, { recursive: true });
  if (!fs.existsSync(DOCS)) fs.mkdirSync(DOCS, { recursive: true });

  const { status, md } = build();
  fs.writeFileSync(path.join(REPORTS, 'status.json'), JSON.stringify(status, null, 2));
  fs.writeFileSync(path.join(DOCS, 'STATUS.md'), md);

  const historyLine = JSON.stringify({
    at: status.generatedAt,
    coreNet: status.systems.mayor.core?.netPct,
    coreClosed: status.systems.mayor.core?.closed,
    mayorNet: status.systems.mayor.netPct,
    mayorClosed: status.systems.mayor.closed,
    scalperNet: status.systems.scalper.netPct,
    scalperDataFetchOk: status.systems.scalper.heartbeat?.dataFetchOk,
    aegisOperational: status.systems.aegis.operational,
    activeMode: status.systems.mayor.strategyModeActive
  });
  fs.appendFileSync(path.join(REPORTS, 'history.jsonl'), historyLine + '\n');

  console.log(JSON.stringify({
    ok: true,
    activeMode: status.systems.mayor.strategyModeActive,
    core: status.systems.mayor.core,
    scalper: status.systems.scalper.verdict,
    aegis: status.systems.aegis.verdict
  }));
}

if (require.main === module) main();
module.exports = { build, main, metrics };
