# Aegis Quant v1 — Slice 1

هذه الشريحة معزولة داخل `aegis-quant/` على الفرع `feat/aegis-quant-v1`. لا تعدّل ملفات MaYor v3 أو `scalper-v1`، ولا تضيف GitHub Actions، ولا تنفّذ أوامر تداول حقيقية.

## السلسلة المنفذة

تجلب `pipeline.py` شهرًا واحدًا من شموع Binance USDT-M لـ`BTCUSDT` على إطار ساعة واحد، ثم تحسب محليًا RSI وMACD وBollinger Bands وVolatility. يمرر النظام لقطة واحدة يوميًا إلى وكيل معنويات واحد باستخدام النموذج المتاح فعليًا بعد فحص البيئة، ثم يدمج صوت الوكيل مع شرط فني واحد لإنتاج `LONG` أو `SHORT`. كل قرار، بما فيه عدم وجود إشارة، يسجل في SQLite محلي، مع مخاطرة ثابتة قدرها 0.35% لأغراض التسجيل فقط.

> هذه المرحلة تثبت المسار التقني من البيانات إلى الميزات إلى الوكيل إلى القرار إلى SQLite. لا تقدم حكمًا على الربحية، ولا تتضمن DRL أو مجلس وكلاء أو DRL أو توسعة رموز.

## التشغيل المحلي

```bash
python3 aegis-quant/pipeline.py
python3 aegis-quant/test/test_pipeline.py
```

يحتاج وكيل المعنويات إلى `GEMINI_API_KEY` من Google AI Studio، ويمكن اختيار النموذج عبر `GEMINI_MODEL` (الافتراضي `gemini-3.6-flash`). يستخدم البرنامج واجهة Gemini `generateContent` مع إخراج JSON منظم. قد تستخدم الطبقة المجانية البيانات لتحسين منتجات Google، لذلك لا ترسل بيانات سرية. البيانات والنتائج تحفظ في `aegis-quant/data/`، ولا تحفظ الأسرار في المستودع.

## Profitability evaluation (v1.1)

`pipeline.py` now runs a **rule-based** paper-trade evaluator (no LLM randomness):

- Entry: next 1h open after decision bar
- SL: 1.5× 20-bar realized vol (min 0.3%)
- TP: 2R, max hold 24h
- Fees + slippage included

Report field: `profitability` with `status` ∈ `EDGE_CANDIDATE` | `WEAK_OR_NEGATIVE` | `NO_TRADES`.

This measures technical-signal expectancy only. It is **not** a guarantee of live profit.
