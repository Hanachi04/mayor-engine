# تثبيت Futures Scalper v1 على mayor-engine

```bash
git clone https://github.com/Hanachi04/mayor-engine.git
cd mayor-engine
git checkout -b feat/futures-scalper-v1

# انسخ محتويات هذا الأرشيف فوق المشروع
cp -a engine/scalper data/scalper test/scalper .github/workflows/scalper.yml .
# package.json: أضف السكربتات التالية داخل "scripts":
#   "test:scalper": "node test/scalper/unit.test.js",
#   "scalper": "node engine/scalper/scan.js",
#   "scalper:backtest": "node engine/scalper/backtest.js"

npm test
node test/scalper/unit.test.js

git add engine/scalper data/scalper test/scalper .github/workflows/scalper.yml package.json
git commit -m "feat(scalper): add isolated Futures Scalper v1 engine"
git push -u origin feat/futures-scalper-v1
```

لا تلمس engine/scan.js أو data/tracked.json أو .github/workflows/mayor.yml.
