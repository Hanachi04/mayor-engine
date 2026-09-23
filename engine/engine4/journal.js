'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const config = require('./config');

function ensureDirs() {
  for (const p of Object.values(config.PATHS)) {
    if (typeof p === 'string' && p.startsWith(config.PATHS.root)) {
      fs.mkdirSync(p, { recursive: true });
    }
  }
}

function appendJsonl(filePath, obj) {
  ensureDirs();
  fs.appendFileSync(filePath, JSON.stringify(obj) + '\n', 'utf8');
}

function readJsonl(filePath) {
  if (!fs.existsSync(filePath)) return [];
  const text = fs.readFileSync(filePath, 'utf8').trim();
  if (!text) return [];
  return text.split('\n').filter(Boolean).map((line) => JSON.parse(line));
}

function signalPath(symbol) {
  return path.join(config.PATHS.signals, `${symbol}.jsonl`);
}
function tradePath(symbol) {
  return path.join(config.PATHS.trades, `${symbol}.jsonl`);
}
function equityPath() {
  return path.join(config.PATHS.equity, 'equity.jsonl');
}
function auditPath() {
  return path.join(config.PATHS.audit, 'events.jsonl');
}
function statePath() {
  return path.join(config.PATHS.state, 'engine4_state.json');
}

function payloadHash(payload) {
  return crypto.createHash('sha256').update(JSON.stringify(payload)).digest('hex').slice(0, 16);
}

function audit(event_type, payload) {
  const row = {
    timestamp: new Date().toISOString(),
    event_type,
    symbol: payload.symbol || null,
    signal_id: payload.signal_id || null,
    trade_id: payload.trade_id || null,
    payload_hash: payloadHash(payload),
    payload,
  };
  appendJsonl(auditPath(), row);
  return row;
}

function loadState() {
  ensureDirs();
  const p = statePath();
  if (!fs.existsSync(p)) {
    return {
      version: 1,
      strategy_version: config.STRATEGY_VERSION,
      open_positions: {}, // symbol -> position
      pending_signals: {}, // symbol -> signal awaiting next open
      seen_signal_ids: [],
      seen_trade_ids: [],
      notified_event_ids: [],
      equity: config.INITIAL_CAPITAL,
      peak_equity: config.INITIAL_CAPITAL,
      max_drawdown: 0,
      last_bar_ts: {}, // symbol -> last processed closed bar open time
      paused: false,
      pause_reason: null,
    };
  }
  return JSON.parse(fs.readFileSync(p, 'utf8'));
}

function saveState(state) {
  ensureDirs();
  // Cap id lists to prevent unbounded growth
  for (const key of ['seen_signal_ids', 'seen_trade_ids', 'notified_event_ids']) {
    if (Array.isArray(state[key]) && state[key].length > 5000) {
      state[key] = state[key].slice(-3000);
    }
  }
  fs.writeFileSync(statePath(), JSON.stringify(state, null, 2), 'utf8');
}

function hasSeen(state, listKey, id) {
  return (state[listKey] || []).includes(id);
}

function markSeen(state, listKey, id) {
  if (!state[listKey]) state[listKey] = [];
  if (!state[listKey].includes(id)) state[listKey].push(id);
}

function recordSignal(signal) {
  appendJsonl(signalPath(signal.symbol), signal);
  audit('SIGNAL', signal);
}

function recordTrade(trade) {
  appendJsonl(tradePath(trade.symbol), trade);
  if (trade.status === 'OPEN') audit('ENTRY', trade);
  if (trade.status === 'CLOSED') audit('EXIT', trade);
}

function recordEquitySnapshot(snap) {
  appendJsonl(equityPath(), snap);
}

function allTrades() {
  const out = [];
  for (const sym of config.SYMBOLS) {
    out.push(...readJsonl(tradePath(sym)));
  }
  return out.sort((a, b) => (a.entry_time || '').localeCompare(b.entry_time || ''));
}

function allSignals() {
  const out = [];
  for (const sym of config.SYMBOLS) {
    out.push(...readJsonl(signalPath(sym)));
  }
  return out;
}

function closedTrades() {
  return allTrades().filter((t) => t.status === 'CLOSED');
}

module.exports = {
  ensureDirs,
  loadState,
  saveState,
  hasSeen,
  markSeen,
  recordSignal,
  recordTrade,
  recordEquitySnapshot,
  allTrades,
  allSignals,
  closedTrades,
  audit,
  readJsonl,
  signalPath,
  tradePath,
  equityPath,
  statePath,
};
