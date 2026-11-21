'use strict';

/**
 * Exit walker — يحدد خروج الصفقة الحية من الشموع الفعلية منذ الدخول، بدل لقطة سعر لحظية.
 *
 * القواعد (مطابقة لـ chooseExit في engine/backtest.js):
 * - تُفحص الشموع المغلقة بالترتيب الزمني، بدءًا من أول شمعة openTime >= entryTime
 *   (لا تُستخدم أي بيانات قبل الدخول).
 * - LONG: ضرب SL إذا low <= SL، وضرب TP إذا high >= TP. SHORT بالعكس.
 * - إذا لُمس SL وTP في الشمعة نفسها → SL أولًا (افتراض محافظ).
 * - عند لمس عدة أهداف في الشمعة نفسها يُسجَّل أبعد هدف لُمس (كما في الـbacktest).
 * - الإغلاق بسعر المستوى (SL/TP) لا بسعر التيكر اللاحق، ووقت الإغلاق = closeTime للشمعة.
 * - انتهاء المدة: أول شمعة closeTime - entryTime >= maxAgeMs تُغلق على close تلك الشمعة.
 * - إذا انتهت الشموع دون خروج → الصفقة تبقى مفتوحة (null).
 */

function finite(v) { const n = Number(v); return Number.isFinite(n) ? n : NaN; }

/**
 * @param {object} trade { dir: 'LONG'|'SHORT', sl, tp1, [tp2], [tp3] }
 * @param {Array} candles [{ openTime, high, low, close, closeTime }]
 * @param {object} opts { entryTime, maxAgeMs, targets: ['tp1','tp2','tp3'], expiredLabel }
 * @returns {null | { result, rawExit, exitTime, candleIndex, reason }}
 */
function walkExit(trade, candles, opts = {}) {
  const dir = trade.dir;
  if (dir !== 'LONG' && dir !== 'SHORT') throw new Error(`walkExit: invalid dir ${dir}`);
  const long = dir === 'LONG';
  const sl = finite(trade.sl);
  if (!Number.isFinite(sl)) throw new Error('walkExit: invalid sl');
  const entryTime = finite(opts.entryTime ?? trade.entryTime ?? trade.ts);
  if (!Number.isFinite(entryTime)) throw new Error('walkExit: invalid entryTime');
  const maxAgeMs = finite(opts.maxAgeMs);
  const targetKeys = (opts.targets || ['tp1', 'tp2', 'tp3']).filter(k => Number.isFinite(finite(trade[k])));
  // أبعد هدف أولًا لاختيار أعلى هدف لُمس في الشمعة نفسها
  const targetsFarFirst = targetKeys
    .map(k => ({ key: k, price: finite(trade[k]) }))
    .sort((a, b) => long ? b.price - a.price : a.price - b.price);
  const expiredLabel = opts.expiredLabel || 'TIMEOUT';

  const series = (Array.isArray(candles) ? candles : [])
    .filter(c => c && Number.isFinite(finite(c.openTime)) && finite(c.openTime) >= entryTime)
    .slice()
    .sort((a, b) => a.openTime - b.openTime);

  for (let i = 0; i < series.length; i++) {
    const c = series[i];
    const high = finite(c.high), low = finite(c.low);
    if (!Number.isFinite(high) || !Number.isFinite(low)) continue;
    const slHit = long ? low <= sl : high >= sl;
    if (slHit) return { result: 'SL', rawExit: sl, exitTime: finite(c.closeTime), candleIndex: i, reason: 'sl-touched' };
    for (const t of targetsFarFirst) {
      const hit = long ? high >= t.price : low <= t.price;
      if (hit) return { result: t.key.toUpperCase(), rawExit: t.price, exitTime: finite(c.closeTime), candleIndex: i, reason: 'tp-touched' };
    }
    if (Number.isFinite(maxAgeMs) && maxAgeMs > 0 && finite(c.closeTime) - entryTime >= maxAgeMs) {
      return { result: expiredLabel, rawExit: finite(c.close), exitTime: finite(c.closeTime), candleIndex: i, reason: 'max-age' };
    }
  }
  return null;
}

/** وقت الدخول للصفقة المسجّلة: entryTime صريح إن وُجد، وإلا ts لحظة البث. */
function tradeEntryTime(trade) {
  const e = finite(trade.entryTime);
  if (Number.isFinite(e)) return e;
  return finite(trade.ts);
}

module.exports = { walkExit, tradeEntryTime };
