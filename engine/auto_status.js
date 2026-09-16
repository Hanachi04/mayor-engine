'use strict';
/**
 * توثيق تلقائي موحّد — MaYor + Scalper + Aegis
 * يكتب: docs/STATUS.md | data/reports/status.json | يُلحق data/reports/history.jsonl
 * بحثي فقط — لا أوامر تداول.
 */

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const DATA = path.join(ROOT, 'data');
const REPORTS = path.join(DATA, 'reports');
const DOCS = path.join(ROOT, 'docs');

function readJson(fp, fallback) {
  try {
    if (!fs.existsSync(fp)) return fallback;
    return JSON.parse(fs.readFileSync(fp, 'utf8'));
  } catch {
    return fallback;
  }
}

function finite(v, fb = 0) {
  const n = Number(v);
  return Number.isFinite(n) ? n : fb;
}

function summarizeTracked(tracked, label) {
  const list = Array.isArray(tracked) ? tracked : [];
  const closed = list.filter(t => t.closed || t.closeResult);
  const open = list.filter(t => !t.closed && !t.closeResult);
  let wins = 0, losses = 0, net = 0;
  for (const t of closed) {
    const n = finite(t.closePct ?? t.netPct ?? t.net_pnl_pct, NaN);
    if (!Number.isFinite(n)) continue;
    net += n;
    if (n > 0) wins++;
    else losses++;
  }
  const decided = wins + losses;
  return {
    label,
    total: list.length,
    open: open.length,
    closed: closed.length,
    wins,
    losses,
    winRatePct: decided ? Number(((wins / decided) * 100).toFixed(1)) : 0,
    netPct: Number(net.toFixed(3)),
    lastAt: list.length ? (list[list.length - 1].closeAt || list[list.length - 1].at || list[list.length - 1].date || null) : null
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
  const mayorTracked = readJson(path.join(DATA, 'tracked.json'), []);
  const mayorVer = readJson(path.join(DATA, 'verification.json'), {});
  const scalperTracked = readJson(path.join(DATA, 'scalper', 'tracked.json'), []);
  const scalperVer = readJson(path.join(DATA, 'scalper', 'verification.json'), {});
  const scalperHb = readJson(path.join(DATA, 'scalper', 'heartbeat.json'), {});
  const aegisReport = readJson(path.join(ROOT, 'aegis-quant', 'data', 'pipeline_report.json'), {});
  const daily = readJson(path.join(REPORTS, 'daily.json'), null);
  const weekly = readJson(path.join(REPORTS, 'weekly.json'), null);

  const mayor = summarizeTracked(mayorTracked, 'MaYor');
  const scalper = summarizeTracked(scalperTracked, 'Scalper');

  const aegisProfit = aegisReport.profitability || {};
  const generatedAt = new Date().toISOString();

  const status = {
    schemaVersion: 1,
    generatedAt,
    systems: {
      mayor: {
        ...mayor,
        engineVersion: mayorTracked[0]?.engineVersion || mayorVer.engineVersion || 'cloud-pro-mtf',
        strategyMode: mayorTracked.find(t => t.strategyMode)?.strategyMode || process.env.STRATEGY_MODE || 'unknown',
        gate: { status: mayorVer.status || 'UNKNOWN', passed: !!mayorVer.passed, reason: mayorVer.reason || null },
        verdict: verdictFrom(mayor.netPct, mayor.closed, mayorVer.passed)
      },
      scalper: {
        ...scalper,
        engineVersion: scalperVer.engineVersion || 'futures-scalper',
        gate: { status: scalperVer.status || 'UNKNOWN', passed: !!scalperVer.passed, reason: scalperVer.reason || null },
        heartbeat: scalperHb.at || scalperHb.ts || null,
        heartbeatOk: scalperHb.ok !== false,
        verdict: verdictFrom(scalper.netPct, scalper.closed, scalperVer.passed)
      },
      aegis: {
        symbol: aegisReport.symbol || 'BTCUSDT',
        tradeDecisions: aegisReport.trade_decisions ?? null,
        profitabilityEvaluated: !!(aegisReport.profitability_evaluated || aegisProfit.profitability_evaluated),
        profitability: aegisProfit.status ? {
          status: aegisProfit.status,
          trades: aegisProfit.trades,
          netPct: aegisProfit.net_pct,
          profitFactor: aegisProfit.profit_factor,
          winRatePct: aegisProfit.win_rate_pct
        } : null,
        verdict: !aegisProfit.status ? '⏳ لم يُقيَّم بعد' :
          aegisProfit.status === 'EDGE_CANDIDATE' ? '✅ مرشح حافة (بحثي)' :
          aegisProfit.status === 'NO_TRADES' ? '⏳ بلا صفقات' : '❌ ضعيف/سالب (بحثي)'
      }
    },
    reports: {
      dailyNetPct: daily?.summary?.netPnlPct ?? null,
      weeklyNetPct: weekly?.summary?.netPnlPct ?? null,
      dailyClosed: daily?.summary?.closed ?? null,
      weeklyClosed: weekly?.summary?.closed ?? null
    },
    note: 'نتائج بحثية بعد رسوم/انزلاق نظريين حيث ينطبق. ليست ضمان ربح ولا توصية مالية.'
  };

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
    `| الحكم | ${status.systems.mayor.verdict} |`,
    `| الإصدار / النمط | ${status.systems.mayor.engineVersion} / ${status.systems.mayor.strategyMode} |`,
    `| صفقات مغلقة | ${status.systems.mayor.closed} (مفتوحة: ${status.systems.mayor.open}) |`,
    `| رابح / خاسر | ${status.systems.mayor.wins} / ${status.systems.mayor.losses} |`,
    `| Win rate | ${status.systems.mayor.winRatePct}% |`,
    `| صافي % (تراكمي في tracked) | ${status.systems.mayor.netPct} |`,
    `| بوابة الإحصاء | ${status.systems.mayor.gate.status} (${status.systems.mayor.gate.passed ? 'PASS' : 'لا'}) |`,
    '',
    '## Futures Scalper',
    '',
    `| الحقل | القيمة |`,
    `|-------|--------|`,
    `| الحكم | ${status.systems.scalper.verdict} |`,
    `| الإصدار | ${status.systems.scalper.engineVersion} |`,
    `| صفقات مغلقة | ${status.systems.scalper.closed} |`,
    `| صافي % | ${status.systems.scalper.netPct} |`,
    `| البوابة | ${status.systems.scalper.gate.status} — ${status.systems.scalper.gate.reason || ''} |`,
    `| نبضة | ${status.systems.scalper.heartbeat || '—'} |`,
    '',
    '## Aegis Quant',
    '',
    `| الحقل | القيمة |`,
    `|-------|--------|`,
    `| الحكم | ${status.systems.aegis.verdict} |`,
    `| قرارات مسجّلة | ${status.systems.aegis.tradeDecisions ?? '—'} |`,
    `| تقييم ربحية | ${status.systems.aegis.profitabilityEvaluated ? 'نعم' : 'لا'} |`,
    ...(status.systems.aegis.profitability ? [
      `| status | ${status.systems.aegis.profitability.status} |`,
      `| صفقات محاكاة | ${status.systems.aegis.profitability.trades} |`,
      `| صافي % | ${status.systems.aegis.profitability.netPct} |`,
      `| PF | ${status.systems.aegis.profitability.profitFactor} |`
    ] : ['| profitability | غير متوفر — شغّل pipeline عند توفر Binance |']),
    '',
    '## تقارير MaYor الدورية',
    '',
    `| الفترة | صفقات مغلقة | صافي % |`,
    `|--------|---------------|--------|`,
    `| يومي | ${status.reports.dailyClosed ?? '—'} | ${status.reports.dailyNetPct ?? '—'} |`,
    `| أسبوعي | ${status.reports.weeklyClosed ?? '—'} | ${status.reports.weeklyNetPct ?? '—'} |`,
    '',
    '## ماذا تفعل؟',
    '',
    '1. لا تغيّر القواعد أثناء أسبوع القياس.',
    '2. اقرأ هذا الملف كل يوم (يُحدَّث تلقائياً من GitHub Actions).',
    '3. بعد 7–30 يوماً: أبقِ النظام الموجب بحثياً، وجمّد السالب.',
    '',
    '---',
    `*Generated by \`engine/auto_status.js\`*`,
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
    mayorNet: status.systems.mayor.netPct,
    mayorClosed: status.systems.mayor.closed,
    scalperNet: status.systems.scalper.netPct,
    scalperClosed: status.systems.scalper.closed,
    aegis: status.systems.aegis.profitability?.status || null,
    mayorVerdict: status.systems.mayor.verdict,
    scalperVerdict: status.systems.scalper.verdict,
    aegisVerdict: status.systems.aegis.verdict
  });
  fs.appendFileSync(path.join(REPORTS, 'history.jsonl'), historyLine + '\n');

  console.log(JSON.stringify({
    ok: true,
    mayor: status.systems.mayor.verdict,
    scalper: status.systems.scalper.verdict,
    aegis: status.systems.aegis.verdict,
    files: ['docs/STATUS.md', 'data/reports/status.json', 'data/reports/history.jsonl']
  }));
}

if (require.main === module) main();
module.exports = { build, main };
