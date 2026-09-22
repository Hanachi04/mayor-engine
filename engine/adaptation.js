'use strict';
/**
 * Layer A — safe adaptation (risk only, not signal weights)
 * - Per-symbol blacklist from last N closed trades (profit factor / net)
 * - Temporary ban with expiry
 * - Append-only adaptation_log.jsonl
 * Does NOT change indicator weights or STRATEGY_MODE.
 */

const fs = require('fs');
const path = require('path');

const DATA_DIR = path.join(__dirname, '..', 'data');
const STATE_FILE = path.join(DATA_DIR, 'adaptation_state.json');
const LOG_FILE = path.join(DATA_DIR, 'adaptation_log.jsonl');

function envNum(name, fallback) {
  const n = Number(process.env[name]);
  return Number.isFinite(n) ? n : fallback;
}

function envBool(name, fallback = true) {
  const v = process.env[name];
  if (v === undefined || v === null || v === '') return fallback;
  return !/^(0|false|no)$/i.test(String(v));
}

const ADAPT = {
  enabled: envBool('ADAPTATION_ENABLED', true),
  /** Look at last N closed trades per symbol */
  lookbackTrades: Math.max(3, Math.floor(envNum('ADAPT_LOOKBACK_TRADES', 8))),
  /** Need at least this many closed trades before judging a symbol */
  minTrades: Math.max(3, Math.floor(envNum('ADAPT_MIN_TRADES', 6))),
  /** Blacklist if profit factor of lookback window is strictly below this */
  minPf: envNum('ADAPT_MIN_PF', 0.85),
  /** Or if sum net% of lookback window is at/below this */
  maxNetPct: envNum('ADAPT_MAX_NET_PCT', -3),
  /** Ban duration in hours */
  banHours: Math.max(1, envNum('ADAPT_BAN_HOURS', 72)),
  /** Max new bans written in one refresh (safety) */
  maxNewBansPerRefresh: Math.max(1, Math.floor(envNum('ADAPT_MAX_NEW_BANS', 3)))
};

function finite(v, fb = 0) {
  const n = Number(v);
  return Number.isFinite(n) ? n : fb;
}

function ensureDataDir() {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
}

function loadState() {
  try {
    if (!fs.existsSync(STATE_FILE)) return { version: 1, blacklist: {}, updatedAt: null };
    const s = JSON.parse(fs.readFileSync(STATE_FILE, 'utf8'));
    if (!s.blacklist || typeof s.blacklist !== 'object') s.blacklist = {};
    return s;
  } catch {
    return { version: 1, blacklist: {}, updatedAt: null };
  }
}

function saveState(state) {
  ensureDataDir();
  state.updatedAt = new Date().toISOString();
  fs.writeFileSync(STATE_FILE, JSON.stringify(state, null, 2));
}

function appendLog(entry) {
  ensureDataDir();
  fs.appendFileSync(LOG_FILE, JSON.stringify({ at: new Date().toISOString(), ...entry }) + '\n');
}

function closedNet(trade) {
  if (!(trade.closed || trade.closeResult)) return null;
  for (const k of ['closePct', 'netPct', 'net_pnl_pct']) {
    if (trade[k] !== undefined && trade[k] !== null && Number.isFinite(Number(trade[k]))) {
      return Number(trade[k]);
    }
  }
  return null;
}

function profitFactor(nets) {
  const wins = nets.filter(n => n > 0);
  const losses = nets.filter(n => n <= 0);
  const gw = wins.reduce((a, b) => a + b, 0);
  const gl = Math.abs(losses.reduce((a, b) => a + b, 0));
  if (gl === 0) return gw > 0 ? 99 : 0;
  return gw / gl;
}

function summarizeSymbol(trades) {
  const closed = trades
    .map(t => ({ net: closedNet(t), at: t.closeAt || t.date || '', symbol: t.symbol }))
    .filter(x => x.net !== null)
    .sort((a, b) => String(b.at).localeCompare(String(a.at)));
  const window = closed.slice(0, ADAPT.lookbackTrades);
  const nets = window.map(x => x.net);
  if (nets.length < ADAPT.minTrades) {
    return { ok: false, reason: 'insufficient-sample', trades: nets.length, nets };
  }
  const pf = profitFactor(nets);
  const netSum = nets.reduce((a, b) => a + b, 0);
  const weak = pf < ADAPT.minPf || netSum <= ADAPT.maxNetPct;
  return {
    ok: true,
    trades: nets.length,
    pf: Number(pf.toFixed(3)),
    netSum: Number(netSum.toFixed(3)),
    wins: nets.filter(n => n > 0).length,
    weak,
    reason: weak
      ? (pf < ADAPT.minPf ? `pf:${pf.toFixed(2)}<${ADAPT.minPf}` : `net:${netSum.toFixed(2)}<=${ADAPT.maxNetPct}`)
      : 'healthy'
  };
}

/**
 * Refresh blacklist from tracked trades. Expires old bans. Adds new weak symbols.
 * @returns {{ state, activeBans: string[], changes: object[] }}
 */
function refreshBlacklist(tracked) {
  const state = loadState();
  const now = Date.now();
  const changes = [];

  // Expire
  for (const [sym, info] of Object.entries(state.blacklist)) {
    const until = Date.parse(info.until || 0);
    if (!Number.isFinite(until) || until <= now) {
      delete state.blacklist[sym];
      changes.push({ action: 'expire', symbol: sym, previous: info });
      appendLog({ action: 'expire', symbol: sym, previous: info });
    }
  }

  if (!ADAPT.enabled) {
    saveState(state);
    return { state, activeBans: Object.keys(state.blacklist), changes, adapt: ADAPT };
  }

  const bySym = {};
  for (const t of Array.isArray(tracked) ? tracked : []) {
    if (!t.symbol) continue;
    (bySym[t.symbol] = bySym[t.symbol] || []).push(t);
  }

  let newBans = 0;
  const ranked = [];
  for (const [symbol, list] of Object.entries(bySym)) {
    const summary = summarizeSymbol(list);
    if (!summary.ok || !summary.weak) continue;
    if (state.blacklist[symbol]) continue; // already banned
    ranked.push({ symbol, summary });
  }
  // Ban worst net first
  ranked.sort((a, b) => a.summary.netSum - b.summary.netSum);

  for (const { symbol, summary } of ranked) {
    if (newBans >= ADAPT.maxNewBansPerRefresh) break;
    const until = new Date(now + ADAPT.banHours * 3600 * 1000).toISOString();
    const entry = {
      until,
      reason: summary.reason,
      pf: summary.pf,
      netSum: summary.netSum,
      trades: summary.trades,
      bannedAt: new Date().toISOString()
    };
    state.blacklist[symbol] = entry;
    newBans++;
    changes.push({ action: 'ban', symbol, entry });
    appendLog({ action: 'ban', symbol, entry, adaptConfig: {
      lookback: ADAPT.lookbackTrades, minTrades: ADAPT.minTrades, minPf: ADAPT.minPf, maxNetPct: ADAPT.maxNetPct, banHours: ADAPT.banHours
    }});
  }

  saveState(state);
  return {
    state,
    activeBans: Object.keys(state.blacklist),
    changes,
    adapt: { ...ADAPT }
  };
}

function isBlacklisted(symbol, state = loadState()) {
  if (!ADAPT.enabled) return { banned: false };
  const info = state.blacklist[symbol];
  if (!info) return { banned: false };
  const until = Date.parse(info.until || 0);
  if (!Number.isFinite(until) || until <= Date.now()) return { banned: false };
  return { banned: true, info };
}

function filterEligible(symbols, tracked) {
  const { state, activeBans, changes, adapt } = refreshBlacklist(tracked);
  const allowed = [];
  const skipped = [];
  for (const symbol of symbols) {
    const hit = isBlacklisted(symbol, state);
    if (hit.banned) skipped.push({ symbol, until: hit.info.until, reason: hit.info.reason });
    else allowed.push(symbol);
  }
  return { allowed, skipped, activeBans, changes, adapt, state };
}

module.exports = {
  ADAPT,
  loadState,
  saveState,
  refreshBlacklist,
  isBlacklisted,
  filterEligible,
  summarizeSymbol,
  profitFactor
};
