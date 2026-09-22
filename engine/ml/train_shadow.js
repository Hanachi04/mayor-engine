'use strict';
/**
 * Train a simple logistic regression on tracked.json (win=1).
 * Walk-forward: train on first 70%, test on last 30% by time.
 * Writes data/ml/shadow_model.json — used only if ML_SHADOW_MODE allows.
 */

const fs = require('fs');
const path = require('path');
const { FEATURE_KEYS, datasetFromTracked } = require('./features');

const ROOT = path.join(__dirname, '..', '..');
const TRACKED = path.join(ROOT, 'data', 'tracked.json');
const OUT = path.join(ROOT, 'data', 'ml', 'shadow_model.json');

function sigmoid(z) {
  if (z > 20) return 1;
  if (z < -20) return 0;
  return 1 / (1 + Math.exp(-z));
}

function trainLogistic(examples, { lr = 0.15, epochs = 800, l2 = 0.02 } = {}) {
  const dim = FEATURE_KEYS.length;
  const w = new Array(dim).fill(0);
  for (let e = 0; e < epochs; e++) {
    const grad = new Array(dim).fill(0);
    for (const ex of examples) {
      const z = ex.x.reduce((s, xi, i) => s + w[i] * xi, 0);
      const p = sigmoid(z);
      const err = p - ex.y;
      for (let i = 0; i < dim; i++) grad[i] += err * ex.x[i];
    }
    const n = examples.length || 1;
    for (let i = 0; i < dim; i++) {
      grad[i] = grad[i] / n + l2 * w[i];
      w[i] -= lr * grad[i];
    }
  }
  return w;
}

function predict(w, x) {
  const z = x.reduce((s, xi, i) => s + w[i] * xi, 0);
  return sigmoid(z);
}

function metrics(examples, w) {
  if (!examples.length) return { n: 0, accuracy: 0, logloss: 0, baseline: 0 };
  let correct = 0, ll = 0;
  const wins = examples.filter(e => e.y === 1).length;
  for (const ex of examples) {
    const p = predict(w, ex.x);
    const pred = p >= 0.5 ? 1 : 0;
    if (pred === ex.y) correct++;
    const pp = Math.min(1 - 1e-7, Math.max(1e-7, p));
    ll += -(ex.y * Math.log(pp) + (1 - ex.y) * Math.log(1 - pp));
  }
  return {
    n: examples.length,
    accuracy: correct / examples.length,
    logloss: ll / examples.length,
    baseline: Math.max(wins, examples.length - wins) / examples.length,
    winRate: wins / examples.length
  };
}

function main() {
  const tracked = JSON.parse(fs.readFileSync(TRACKED, 'utf8'));
  let data = datasetFromTracked(tracked, { mode: 'core' });
  if (data.length < 12) data = datasetFromTracked(tracked); // fallback all
  data.sort((a, b) => Number(a.ts || 0) - Number(b.ts || 0));
  const cut = Math.max(8, Math.floor(data.length * 0.7));
  const train = data.slice(0, cut);
  const test = data.slice(cut);
  const w = trainLogistic(train);
  const trainM = metrics(train, w);
  const testM = metrics(test, w);

  // Shadow filter utility: P(win) threshold suggestion
  const scores = test.map(ex => ({ p: predict(w, ex.x), y: ex.y, net: ex.net }));
  let best = { thr: 0.5, net: -999, n: 0 };
  for (const thr of [0.45, 0.5, 0.55, 0.6, 0.65]) {
    const kept = scores.filter(s => s.p >= thr);
    if (kept.length < 3) continue;
    const net = kept.reduce((a, s) => a + s.net, 0);
    if (net > best.net) best = { thr, net, n: kept.length, wr: kept.filter(s => s.y).length / kept.length };
  }

  const model = {
    version: 1,
    type: 'logistic_win_prob',
    featureKeys: FEATURE_KEYS,
    weights: w.map(x => Number(x.toFixed(6))),
    trainedAt: new Date().toISOString(),
    trainSize: train.length,
    testSize: test.length,
    trainMetrics: trainM,
    testMetrics: testM,
    suggestedMinPWin: best.thr,
    suggestedFilterStats: best,
    note: 'Shadow model only. Does not guarantee live edge. Prefer skip when P(win) low.'
  };

  fs.mkdirSync(path.dirname(OUT), { recursive: true });
  fs.writeFileSync(OUT, JSON.stringify(model, null, 2));
  console.log(JSON.stringify({
    out: OUT,
    train: trainM,
    test: testM,
    suggested: best
  }, null, 2));
}

if (require.main === module) main();
module.exports = { trainLogistic, predict, metrics, main };
