# MaYor Signal Engine

محرك إشارات تداول تلقائي يعمل على GitHub Actions مجانًا.

- **الجدولة:** فحص السوق كل 30 دقيقة (Binance 4H)
- **المنهجية:** RSI + EMA50/200 + ATR (نفس منطق MaYor v13)
- **حد الإشارات:** 6 يوميًا
- **التوثيق:** الإشارات تُرسل تلقائيًا إلى قناة تلغرام، والصفقات تُتابع وتُسجَّل نتائجها في `data/tracked.json`
- **الأزواج:** BTCUSDT, ETHUSDT, SOLUSDT, BNBUSDT, XRPUSDT, DOGEUSDT, ADAUSDT, AVAXUSDT, LINKUSDT, DOTUSDT

## الأسرار المطلوبة (Settings ← Secrets)

| السر | القيمة |
|---|---|
| `TELEGRAM_TOKEN` | توكن بوت تلغرام |
| `TELEGRAM_CHAT` | معرف القناة (مثل `@Paracaudina`) |
