# Futures Scalper v1

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

## القواعد
- Binance USDT-M Perpetual · تنفيذ 1m · تأكيد 3m+5m · فلتر 15m
- LONG+SHORT · cooldown 3 دقائق · حد 30 إشارة/يوم · حد 4 صفقات مفتوحة
- SL=ATR×1.1 · TP R:R≥1.5 · مخاطرة ~0.35% · إغلاق ~25 دقيقة
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
