'use strict';
/** Time-ordered shadow model. Threshold selection uses validation only; test is report-only. */
const fs = require('fs');
const path = require('path');
const { FEATURE_KEYS, datasetFromTracked } = require('./features');
const { atomicWriteJson, readJsonWithBackup } = require('../atomic_json');
const { stateDir } = require('../state_dir');

const TRACKED = path.join(stateDir(), 'tracked.json');
const OUT = path.join(stateDir(), 'ml', 'shadow_model.json');
const MIN_ML_SAMPLES = Math.max(100, Number(process.env.ML_MIN_TRAIN_SAMPLES || 100));
const THRESHOLDS = [0.45, 0.5, 0.55, 0.6, 0.65];
function sigmoid(z) { if (z > 20) return 1; if (z < -20) return 0; return 1 / (1 + Math.exp(-z)); }
function trainLogistic(examples, { lr = 0.15, epochs = 800, l2 = 0.02 } = {}) {
  const w = new Array(FEATURE_KEYS.length).fill(0);
  for (let e = 0; e < epochs; e++) {
    const grad = new Array(w.length).fill(0);
    for (const ex of examples) {
      const p = sigmoid(ex.x.reduce((sum, value, i) => sum + w[i] * value, 0));
      for (let i = 0; i < w.length; i++) grad[i] += (p - ex.y) * ex.x[i];
    }
    const n = examples.length || 1;
    for (let i = 0; i < w.length; i++) w[i] -= lr * (grad[i] / n + l2 * w[i]);
  }
  return w;
}
function predict(weights, x) { return sigmoid(x.reduce((sum, value, i) => sum + (weights[i] || 0) * value, 0)); }
function metrics(examples, weights) {
  if (!examples.length) return { n: 0, accuracy: 0, logloss: 0, baseline: 0, winRate: 0 };
  let correct = 0, loss = 0;
  const wins = examples.filter(e => e.y === 1).length;
  for (const ex of examples) {
    const p = predict(weights, ex.x);
    if ((p >= 0.5 ? 1 : 0) === ex.y) correct++;
    const bounded = Math.min(1 - 1e-7, Math.max(1e-7, p));
    loss -= ex.y * Math.log(bounded) + (1 - ex.y) * Math.log(1 - bounded);
  }
  return { n: examples.length, accuracy: correct / examples.length, logloss: loss / examples.length, baseline: Math.max(wins, examples.length - wins) / examples.length, winRate: wins / examples.length };
}
function selectThreshold(examples, weights) {
  let best = { threshold: 0.5, net: -Infinity, n: 0 };
  for (const threshold of THRESHOLDS) {
    const kept = examples.filter(ex => predict(weights, ex.x) >= threshold);
    if (kept.length < 10) continue;
    const net = kept.reduce((sum, ex) => sum + ex.net, 0);
    if (net > best.net) best = { threshold, net, n: kept.length, winRate: kept.filter(ex => ex.y).length / kept.length };
  }
  return Number.isFinite(best.net) ? best : { threshold: 0.5, net: null, n: 0, reason: 'validation-sample-too-small' };
}
function main() {
  const tracked = readJsonWithBackup(TRACKED, [], { validate: Array.isArray });
  let data = datasetFromTracked(tracked, { mode: 'core' });
  if (data.length < 12) data = datasetFromTracked(tracked);
  data.sort((a, b) => Number(a.ts || 0) - Number(b.ts || 0));
  const n = data.length;
  const enough = n >= MIN_ML_SAMPLES;
  const trainEnd = Math.floor(n * 0.6), validationEnd = Math.floor(n * 0.8);
  const train = data.slice(0, trainEnd), validation = data.slice(trainEnd, validationEnd), test = data.slice(validationEnd);
  const weights = enough ? trainLogistic(train) : new Array(FEATURE_KEYS.length).fill(0);
  const trainMetrics = enough ? metrics(train, weights) : null;
  const validationMetrics = enough ? metrics(validation, weights) : null;
  const testMetrics = enough ? metrics(test, weights) : null;
  const selected = enough ? selectThreshold(validation, weights) : { threshold: 0.5, net: null, n: 0, reason: 'insufficient-sample; use non-ML strategy' };
  const model = {
    version: 2, type: enough ? 'logistic_win_prob' : 'disabled_insufficient_sample', featureKeys: FEATURE_KEYS,
    weights: enough ? weights.map(x => Number(x.toFixed(6))) : [], trainedAt: new Date().toISOString(),
    sampleSize: n, minMlSamples: MIN_ML_SAMPLES, enabledForFiltering: enough,
    split: { train: train.length, validation: validation.length, test: test.length, method: 'chronological 60/20/20' },
    trainMetrics, validationMetrics, testMetrics,
    suggestedMinPWin: selected.threshold, validationThresholdStats: selected,
    note: enough ? 'Threshold selected on validation only; test is report-only.' : `Only ${n} closed trades; ML filtering disabled until ${MIN_ML_SAMPLES} samples. Use the non-ML strategy.`
  };
  atomicWriteJson(OUT, model, { validate: v => v && typeof v === 'object' && !Array.isArray(v) });
  console.log(JSON.stringify({ out: OUT, sampleSize: n, enabledForFiltering: enough, split: model.split, validationThreshold: selected, test: testMetrics }, null, 2));
}
if (require.main === module) main();
module.exports = { trainLogistic, predict, metrics, selectThreshold, main, MIN_ML_SAMPLES };
