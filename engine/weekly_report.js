// نقطة التوافق السابقة للتقرير الأسبوعي؛ المنطق الموحد موجود في performance_report.js.

'use strict';

const { costsForTrade, buildPerformanceReport, buildTelegramMessage, saveReport, sendReport, run } = require('./performance_report.js');

function main() {
  const report = buildPerformanceReport('weekly');
  saveReport(report);
  return { msg: buildTelegramMessage(report), summary: report.summary, report };
}

if (require.main === module) run('weekly').catch(error => { console.error(error); process.exitCode = 1; });

module.exports = { main, costsForTrade };
