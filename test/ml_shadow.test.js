'use strict';
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { FEATURE_KEYS, signalToFeatures, tradeToExample } = require('../engine/ml/features');
const { selectThreshold } = require('../engine/ml/train_shadow');
const { scoreSignal, evaluateCandidate } = require('../engine/ml/shadow_gate');
const signal = { dir: 'LONG', corePct: 73.5, mtfPct: 82, adx: 22, atrPct: 0.02, rr: 3, rsi4h: 48, ts: 1700000000000, slot: 2 };
const trade = { ...signal, closed: true, closePct: 1.2 };
assert.deepStrictEqual(FEATURE_KEYS.map(k => signalToFeatures(signal)[k]), tradeToExample(trade).x,
  'live and training paths must use identical shared features');
const examples = Array.from({ length: 30 }, (_, i) => ({ x: [i / 30], y: i > 15 ? 1 : 0, net: i - 10 }));
const selected = selectThreshold(examples, [1]);
assert.ok([0.45, 0.5, 0.55, 0.6, 0.65].includes(selected.threshold));
const oldMode = process.env.ML_SHADOW_MODE;
const oldModel = require('../engine/ml/shadow_gate').loadModel;
// A malformed/disabled model must never gate a live signal.
process.env.ML_SHADOW_MODE = 'filter';
const modelPath = path.join(process.env.MAYOR_STATE_DIR || 'data', 'ml', 'shadow_model.json');
fs.mkdirSync(path.dirname(modelPath), { recursive: true });
fs.writeFileSync(modelPath, JSON.stringify({ enabledForFiltering: false, weights: [] }));
const disabled = evaluateCandidate(signal);
assert.strictEqual(disabled.allow, true);
assert.strictEqual(disabled.reason, 'ml-disabled-or-insufficient-sample');
if (oldMode === undefined) delete process.env.ML_SHADOW_MODE; else process.env.ML_SHADOW_MODE = oldMode;
console.log('✓ shadow ML shares feature path, tunes thresholds with validation examples, and fails open when disabled');
