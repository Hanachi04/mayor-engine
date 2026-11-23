'use strict';
/**
 * Shadow / soft ML gate for MaYor signals.
 * Modes:
 *   off     — disabled
 *   log     — score and log only (default)
 *   filter  — skip signal if P(win) < minPWin
 */

const fs = require('fs');
const path = require('path');
const { FEATURE_KEYS, signalToFeatures } = require('./features');

const { stateDir } = require('../state_dir');
const { readJsonWithBackup } = require('../atomic_json');
const MODEL_PATH = path.join(stateDir(), 'ml', 'shadow_model.json');
const LOG_PATH = path.join(stateDir(), 'ml', 'shadow_log.jsonl');

function mode() {
  return String(process.env.ML_SHADOW_MODE || 'log').toLowerCase();
}

function loadModel() {
  try {
    if (!fs.existsSync(MODEL_PATH)) return null;
    return readJsonWithBackup(MODEL_PATH, null, { validate: value => value && typeof value === 'object' && !Array.isArray(value) });
  } catch {
    return null;
  }
}

function sigmoid(z) {
  if (z > 20) return 1;
  if (z < -20) return 0;
  return 1 / (1 + Math.exp(-z));
}

function scoreSignal(signal, model) {
  if (!model || !model.enabledForFiltering || !Array.isArray(model.weights) || model.weights.length !== FEATURE_KEYS.length) return null;
  const feats = signalToFeatures(signal);
  const x = FEATURE_KEYS.map(k => feats[k]);
  const z = x.reduce((s, xi, i) => s + (model.weights[i] || 0) * xi, 0);
  const pWin = sigmoid(z);
  const minP = Number(process.env.ML_MIN_PWIN || model.suggestedMinPWin || 0.5);
  return { pWin, minP, x, feats };
}

function appendShadowLog(entry) {
  try {
    fs.mkdirSync(path.dirname(LOG_PATH), { recursive: true });
    fs.appendFileSync(LOG_PATH, JSON.stringify({ at: new Date().toISOString(), ...entry }) + '\n');
  } catch (e) {
    console.log(`shadow log error: ${e.message}`);
  }
}

/**
 * @returns {{ allow: boolean, reason: string, score: object|null }}
 */
function evaluateCandidate(signal) {
  const m = mode();
  if (m === 'off' || m === '0' || m === 'false') {
    return { allow: true, reason: 'ml-off', score: null };
  }
  const model = loadModel();
  if (!model) return { allow: true, reason: 'no-model', score: null };
  const score = scoreSignal(signal, model);
  if (!score) return { allow: true, reason: m === 'filter' ? 'ml-disabled-or-insufficient-sample' : 'score-fail', score: null };

  const pass = score.pWin >= score.minP;
  appendShadowLog({
    mode: m,
    symbol: signal.symbol,
    dir: signal.dir,
    pWin: Number(score.pWin.toFixed(4)),
    minP: score.minP,
    pass,
    corePct: signal.corePct,
    mtfPct: signal.mtfPct
  });

  if (m === 'log') {
    return { allow: true, reason: pass ? 'shadow-pass' : 'shadow-would-skip', score };
  }
  if (m === 'filter') {
    return { allow: pass, reason: pass ? 'ml-pass' : `ml-skip:pWin=${score.pWin.toFixed(2)}<${score.minP}`, score };
  }
  return { allow: true, reason: 'ml-unknown-mode', score };
}

module.exports = { evaluateCandidate, scoreSignal, loadModel, mode };
