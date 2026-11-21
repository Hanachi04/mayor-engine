'use strict';

/**
 * Edge statistics — اختبار وجود ميزة (edge) حقيقية في عوائد الصفقات.
 *
 * لماذا: خلط ترتيب الصفقات (permutation) لا يغيّر مجموع العوائد، فلا يمكنه قياس الربحية،
 * و"eq - dd" موجب تقريبًا لأي استراتيجية. لذلك:
 *  - bootstrapEdge: إعادة معاينة العوائد لكل صفقة **مع الإرجاع** (seeded) → توزيع المتوسط/المجموع،
 *    وp-value = P(mean <= 0) ومئين 5% للعائد الكلي. البوابة تعتمد على هذا.
 *  - drawdownRisk: خلط الترتيب يُستخدم فقط كمقياس مخاطرة منفصل (توزيع أقصى تراجع).
 */

const DEFAULT_ITERATIONS = 2000;
const DEFAULT_SEED = 17;
const DEFAULT_ALPHA = 0.05;

/** RNG حتمي (mulberry32) لنتائج قابلة لإعادة الإنتاج */
function mulberry32(seed) {
  let a = seed >>> 0;
  return function next() {
    a = (a + 0x6D2B79F5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function cleanReturns(returns) {
  return (Array.isArray(returns) ? returns : []).map(Number).filter(Number.isFinite);
}
function mean(a) { return a.length ? a.reduce((x, y) => x + y, 0) / a.length : 0; }
function stddev(a) {
  if (a.length < 2) return 0;
  const m = mean(a);
  return Math.sqrt(a.reduce((s, x) => s + (x - m) ** 2, 0) / (a.length - 1));
}
function quantileSorted(s, q) {
  if (!s.length) return 0;
  const pos = (s.length - 1) * q, lo = Math.floor(pos), hi = Math.ceil(pos);
  return s[lo] + (s[hi] - s[lo]) * (pos - lo);
}
function r5(v) { return Number(Number(v).toFixed(5)); }

/**
 * Bootstrap للعوائد لكل صفقة مع الإرجاع.
 * @returns {{ method, iterations, seed, n, observedMeanPct, observedTotalPct, pValueMeanLeZero,
 *   totalP05, totalP50, totalP95, meanP05, meanP95, zScore }}
 */
function bootstrapEdge(returns, opts = {}) {
  const r = cleanReturns(returns);
  const iterations = Math.max(1, Math.floor(opts.iterations || DEFAULT_ITERATIONS));
  const seed = Number.isFinite(opts.seed) ? opts.seed : DEFAULT_SEED;
  const n = r.length;
  if (!n) {
    return { method: 'bootstrap_mean_returns', iterations, seed, n: 0, observedMeanPct: 0, observedTotalPct: 0,
      pValueMeanLeZero: 1, totalP05: 0, totalP50: 0, totalP95: 0, meanP05: 0, meanP95: 0, zScore: 0 };
  }
  const rand = mulberry32(seed);
  const means = new Array(iterations);
  let worse = 0;
  for (let k = 0; k < iterations; k++) {
    let s = 0;
    for (let i = 0; i < n; i++) s += r[Math.floor(rand() * n)];
    const m = s / n;
    means[k] = m;
    if (m <= 0) worse++;
  }
  const sorted = means.slice().sort((a, b) => a - b);
  const obsMean = mean(r);
  const sdMean = stddev(means);
  return {
    method: 'bootstrap_mean_returns',
    iterations, seed, n,
    observedMeanPct: r5(obsMean),
    observedTotalPct: r5(obsMean * n),
    pValueMeanLeZero: r5(worse / iterations),
    meanP05: r5(quantileSorted(sorted, 0.05)),
    meanP95: r5(quantileSorted(sorted, 0.95)),
    totalP05: r5(quantileSorted(sorted, 0.05) * n),
    totalP50: r5(quantileSorted(sorted, 0.5) * n),
    totalP95: r5(quantileSorted(sorted, 0.95) * n),
    // للتوافق مع لوحات العرض القديمة: z = المتوسط المرصود / الخطأ المعياري للمتوسط (bootstrap)
    zScore: sdMean > 0 ? r5(obsMean / sdMean) : 0
  };
}

function maxDrawdown(returns) {
  let equity = 0, peak = 0, dd = 0;
  for (const x of returns) { equity += x; peak = Math.max(peak, equity); dd = Math.max(dd, peak - equity); }
  return dd;
}

/** توزيع أقصى تراجع عبر خلط ترتيب الصفقات (مقياس مخاطرة فقط، ليس اختبار ميزة). */
function drawdownRisk(returns, opts = {}) {
  const r = cleanReturns(returns);
  const runs = Math.max(1, Math.floor(opts.runs || DEFAULT_ITERATIONS));
  const seed = Number.isFinite(opts.seed) ? opts.seed : DEFAULT_SEED + 1;
  if (!r.length) return { method: 'permutation_drawdown', runs, seed, observedMaxDrawdownPct: 0, maxDrawdownP05: 0, maxDrawdownP50: 0, maxDrawdownP95: 0 };
  const rand = mulberry32(seed);
  const dds = new Array(runs);
  for (let k = 0; k < runs; k++) {
    const a = r.slice();
    for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(rand() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; }
    dds[k] = maxDrawdown(a);
  }
  dds.sort((a, b) => a - b);
  return {
    method: 'permutation_drawdown', runs, seed,
    observedMaxDrawdownPct: r5(maxDrawdown(r)),
    maxDrawdownP05: r5(quantileSorted(dds, 0.05)),
    maxDrawdownP50: r5(quantileSorted(dds, 0.5)),
    maxDrawdownP95: r5(quantileSorted(dds, 0.95))
  };
}

/** البوابة: تمر فقط إذا كان p-value لفرضية "المتوسط <= 0" ≤ alpha وعدد الصفقات كافٍ. */
function edgeGate(returns, opts = {}) {
  const alpha = Number.isFinite(opts.alpha) ? opts.alpha : DEFAULT_ALPHA;
  const minTrades = Number.isFinite(opts.minTrades) ? opts.minTrades : 1;
  const bootstrap = opts.bootstrap || bootstrapEdge(returns, opts);
  const reasons = [];
  if (bootstrap.n < minTrades) reasons.push(`sample ${bootstrap.n}/${minTrades}`);
  if (!(bootstrap.pValueMeanLeZero <= alpha)) reasons.push(`bootstrap p=${bootstrap.pValueMeanLeZero} > ${alpha}`);
  return { passed: reasons.length === 0, alpha, minTrades, pValue: bootstrap.pValueMeanLeZero, reasons, bootstrap };
}

module.exports = { mulberry32, bootstrapEdge, drawdownRisk, edgeGate, maxDrawdown, DEFAULT_ITERATIONS, DEFAULT_SEED, DEFAULT_ALPHA };
