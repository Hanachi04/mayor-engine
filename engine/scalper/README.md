# Futures Scalper v1.1

محرك سكالبينج مستقل تمامًا — **لا يلمس** نظام MaYor Cloud Pro MTF.

## العزل
| مسار | دور |
|------|-----|
| `engine/scalper/scan.js` | محرك الإشارات (Futures 1m) |
| `engine/scalper/backtest.js` | باكتيست محلي IS/OOS + Monte Carlo |
| `engine/scalper/config.js` | إعدادات env |
| `data/scalper/*` | tracked / verification / heartbeat منفصلة |
| `.github/workflows/scalper.yml` | كل 15 دقيقة |
| `test/scalper/` | اختبارات الوحدة |

## القواعد (v1.1)
- Binance USDT-M Perpetual · تنفيذ 1m · تأكيد 3m+5m · فلتر 15m
- LONG+SHORT · cooldown 3 دقائق · حد 30 إشارة/يوم · حد 4 صفقات مفتوحة
- SL=ATR×1.1 · TP R:R≥1.5 · مخاطرة ~0.35% · إغلاق ~25 دقيقة
- **minAtrPct ≥ 0.15%** — يرفض SL الضيق على majors
- **requireRecentCross** — يشترط تقاطع EMA9/21 على الشمعة المغلقة الأخيرة
- RSI soft (80/20) يُرفض بلا volume spike؛ hard (90/10) يُرفض دائمًا
- **لا أوامر حقيقية**

## قيد Actions
الجدولة كل 15 دقيقة (`7/15 * * * *`) لتقليل استهلاك الحصة. هذا تقريب بحثي وليس سكالبينج بالثانية.

## تشغيل
```bash
npm test
node test/scalper/unit.test.js
SCALPER_DRY_RUN=1 node engine/scalper/scan.js
node engine/scalper/backtest.js
```

## متغيرات التحسين
| المتغير | الافتراضي | الوظيفة |
|---------|-----------|---------|
| `SCALPER_MIN_ATR_PCT` | `0.0015` | حد ATR النسبي الأدنى |
| `SCALPER_REQUIRE_RECENT_CROSS` | `1` | إلزام تقاطع EMA الحديث |
| `SCALPER_RSI_SOFT_LONG` / `SHORT` | `80` / `20` | رفض تشبع بلا حجم |
| `SCALPER_RSI_HARD_LONG` / `SHORT` | `90` / `10` | رفض تشبع مطلق |
