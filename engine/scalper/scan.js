'use strict';

/**
 * Futures Scalper v1 — isolated signal engine for Binance USDT-M Perpetual Futures.
 * Research / notification only. Does NOT modify MaYor Cloud Pro files.
 * Shares pure indicator helpers from ../scan.js via require (read-only).
 */

const fs = require('fs');
const path = require('path');
const { CONFIG, ENGINE_VERSION, GATE_VERSION } = require('./config');

const parent = require('../scan.js');
const {
  Indicators,
  prepareKlines,
  normalizeKlines,
  netPnl,
  calculatePositionSize: parentCalculatePositionSize
} = parent;

const DATA_DIR = path.join(__dirname, '..', '..', 'data', 'scalper');
const TRACKED_FILE = path.join(DATA_DIR, 'tracked.json');
const VERIFICATION_FILE = path.join(DATA_DIR, 'verification.json');
const HEARTBEAT_FILE = path.join(DATA_DIR, 'heartbeat.json');

if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }
function finite(v, fb = NaN) {
  if (v === null || v === undefined || v === '') return fb;
  const n = Number(v);
  return Number.isFinite(n) ? n : fb;
}
function esc(v) {
  return String(v ?? '').replace(/[&<>"']/g, c =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
function fmtDate(d = new Date()) { return d.toISOString().slice(0, 10); }
function fmtTime(d = new Date()) {
  return d.toLocaleTimeString('en-GB', { hour12: false, timeZone: 'Asia/Riyadh' });
}
function round(v, d = 4) { return Number(Number(v).toFixed(d)); }

let nextRequestAt = 0;

function loadTracked() {
  try {
    if (!fs.existsSync(TRACKED_FILE)) return [];
    const v = JSON.parse(fs.readFileSync(TRACKED_FILE, 'utf8'));
    return Array.isArray(v) ? v : [];
  } catch (e) {
    console.log(`scalper tracked read error: ${e.message}`);
    return [];
  }
}
function saveTracked(arr) {
  fs.writeFileSync(TRACKED_FILE, JSON.stringify(arr, null, 2));
}

function loadVerification() {
  try {
    if (!fs.existsSync(VERIFICATION_FILE)) {
      return { passed: false, status: 'BLOCKED', reason: 'verification-file-missing', gateVersion: GATE_VERSION };
    }
    return JSON.parse(fs.readFileSync(VERIFICATION_FILE, 'utf8'));
  } catch (e) {
    return { passed: false, status: 'BLOCKED', reason: `read-error:${e.message}`, gateVersion: GATE_VERSION };
  }
}
function verificationPassed(v = loadVerification()) {
  return v && v.passed === true && v.status === 'PASS' && v.gateVersion === GATE_VERSION;
}

function writeHeartbeat(ok = true, extra = {}) {
  const payload = {
    engineVersion: ENGINE_VERSION,
    at: new Date().toISOString(),
    ts: Date.now(),
    ok,
    ...extra
  };
  fs.writeFileSync(HEARTBEAT_FILE, JSON.stringify(payload, null, 2));
}

async function requestJson(pathname, params = {}) {
  let lastError = null;
  for (const base of CONFIG.futuresEndpoints) {
    for (let attempt = 0; attempt <= CONFIG.retries; attempt++) {
      let timer;
      try {
        const now = Date.now();
        if (now < nextRequestAt) await sleep(nextRequestAt - now);
        nextRequestAt = Date.now() + CONFIG.minRequestGapMs;
        const url = new URL(`${base}${pathname}`);
        for (const [k, v] of Object.entries(params)) url.searchParams.set(k, String(v));
        const controller = new AbortController();
        timer = setTimeout(() => controller.abort(), CONFIG.requestTimeoutMs);
        const res = await fetch(url, {
          signal: controller.signal,
          headers: { 'user-agent': 'Futures-Scalper-v1/1.0' }
        });
        if (!res.ok) {
          const body = await res.text().catch(() => '');
          const err = new Error(`HTTP ${res.status} ${base} ${body.slice(0, 100)}`);
          err.status = res.status;
          throw err;
        }
        return await res.json();
      } catch (e) {
        lastError = e;
        const retryable = e.name === 'AbortError' || [418, 429, 500, 502, 503, 504].includes(e.status);
        if (retryable && attempt < CONFIG.retries) {
          const delay = Math.min(15000, 400 * (2 ** attempt) + Math.floor(Math.random() * 200));
          await sleep(delay);
        }
      } finally {
        if (timer) clearTimeout(timer);
      }
    }
  }
  throw lastError || new Error('Futures request failed');
}

async function getKlines(symbol, interval, limit) {
  const raw = await requestJson('/fapi/v1/klines', { symbol, interval, limit });
  const min = CONFIG.minKlines[interval] || 30;
  const prepared = prepareKlines(raw, min);
  if (!prepared.ok) throw new Error(`${symbol} ${interval} ${prepared.reason}`);
  return prepared.klines;
}

async function get24hVolumeMap(symbols) {
  const data = await requestJson('/fapi/v1/ticker/24hr');
  const map = new Map();
  const set = new Set(symbols);
  for (const t of Array.isArray(data) ? data : []) {
    if (set.has(t.symbol)) {
      map.set(t.symbol, {
        quoteVolume: finite(t.quoteVolume, 0),
        price: finite(t.lastPrice),
        changePct: finite(t.priceChangePercent, 0)
      });
    }
  }
  return map;
}

async function getOrderBookImbalance(symbol, limit = 50) {
  try {
    const data = await requestJson('/fapi/v1/depth', { symbol, limit });
    let bid = 0, ask = 0;
    for (const [p, q] of data.bids || []) bid += finite(p, 0) * finite(q, 0);
    for (const [p, q] of data.asks || []) ask += finite(p, 0) * finite(q, 0);
    const total = bid + ask;
    return total > 0 ? (bid - ask) / total : null;
  } catch (e) {
    console.log(`OB ${symbol}: ${e.message}`);
    return null;
  }
}

async function getTicker(symbol) {
  const data = await requestJson('/fapi/v1/ticker/price', { symbol });
  const price = finite(data?.price);
  if (!Number.isFinite(price)) throw new Error(`ticker-invalid:${symbol}`);
  return price;
}

function analyze1m(ks, extra = {}) {
  const prepared = extra.skipSanitize
    ? { ok: true, klines: normalizeKlines(ks) }
    : prepareKlines(ks, CONFIG.minKlines['1m'], extra.now || Date.now());
  const a = prepared.klines;
  if (!prepared.ok || a.length < CONFIG.minKlines['1m']) {
    return { signal: null, reason: prepared.reason || 'insufficient-candles' };
  }

  const c = a.map(k => k.close);
  const h = a.map(k => k.high);
  const l = a.map(k => k.low);
  const v = a.map(k => k.volume);
  const price = c.at(-1);

  const emaFast = Indicators.ema(c, CONFIG.emaFast);
  const emaSlow = Indicators.ema(c, CONFIG.emaSlow);
  const e9 = emaFast.at(-1);
  const e21 = emaSlow.at(-1);
  const e9Prev = emaFast.at(-2);
  const e21Prev = emaSlow.at(-2);

  if (![e9, e21, e9Prev, e21Prev, price].every(Number.isFinite)) {
    return { signal: null, reason: 'ema-invalid' };
  }

  let dir = null;
  if (e9 > e21 && e9Prev <= e21Prev) dir = 'LONG';
  else if (e9 < e21 && e9Prev >= e21Prev) dir = 'SHORT';
  else if (e9 > e21) dir = 'LONG';
  else if (e9 < e21) dir = 'SHORT';
  else return { signal: null, reason: 'no-ema-direction' };

  const avgVol = v.slice(-21, -1).reduce((s, x) => s + x, 0) / Math.min(20, v.length - 1 || 1);
  const volSpike = avgVol > 0 && v.at(-1) >= avgVol * CONFIG.volumeSpikeMult;
  const rsi = Indicators.rsi(c, CONFIG.rsiPeriod);
  const atr = Indicators.atr(h, l, c, CONFIG.atrPeriod);
  if (!Number.isFinite(atr) || atr <= 0) return { signal: null, reason: 'atr-invalid' };

  const recentCross = (dir === 'LONG' && e9Prev <= e21Prev) || (dir === 'SHORT' && e9Prev >= e21Prev);
  if (!recentCross && !volSpike) {
    return { signal: null, reason: 'no-cross-no-volume', dir, rsi, atr };
  }
  const rsiExtreme = dir === 'LONG' ? rsi >= 90 : rsi <= 10;
  if (rsiExtreme && !volSpike) {
    return { signal: null, reason: 'rsi-extreme', dir, rsi, atr };
  }

  return {
    signal: {
      symbol: extra.symbol,
      dir,
      price,
      atr,
      atrPct: atr / price,
      rsi,
      e9, e21,
      volSpike,
      recentCross,
      volume: v.at(-1),
      avgVolume: avgVol,
      closedCandle: a.at(-1).openTime
    },
    reason: ''
  };
}

function emaDirection(ks, fast = 9, slow = 21) {
  const prepared = prepareKlines(ks, Math.max(slow + 5, 30));
  if (!prepared.ok) return null;
  const c = prepared.klines.map(k => k.close);
  const ef = Indicators.ema(c, fast).at(-1);
  const es = Indicators.ema(c, slow).at(-1);
  if (!Number.isFinite(ef) || !Number.isFinite(es)) return null;
  return ef > es ? 'LONG' : ef < es ? 'SHORT' : null;
}

function softTrend15m(ks) {
  const prepared = prepareKlines(ks, CONFIG.minKlines['15m']);
  if (!prepared.ok) return null;
  const c = prepared.klines.map(k => k.close);
  const ema50 = Indicators.ema(c, 50).at(-1);
  const price = c.at(-1);
  if (!Number.isFinite(ema50) || !Number.isFinite(price)) return null;
  return price > ema50 ? 'LONG' : price < ema50 ? 'SHORT' : null;
}

function levelsFromSignal(s) {
  const distance = s.atr * CONFIG.atrSlMult;
  const sl = s.dir === 'LONG' ? s.price - distance : s.price + distance;
  const reward = distance * CONFIG.minRr;
  const tp1 = s.dir === 'LONG' ? s.price + reward : s.price - reward;
  const tp2 = s.dir === 'LONG' ? s.price + reward * 1.5 : s.price - reward * 1.5;
  const risk = Math.abs(s.price - sl);
  const rr = risk > 0 ? Math.abs(tp1 - s.price) / risk : 0;
  if ([s.price, s.atr, sl, tp1].some(v => !Number.isFinite(v) || v <= 0) || rr < CONFIG.minRr * 0.95) {
    return null;
  }
  return { ...s, sl, tp1, tp2, rr: round(rr, 2) };
}

function calculatePositionSize(signal) {
  const cfg = {
    capital: CONFIG.capital,
    riskPerTradePct: CONFIG.riskPerTradePct,
    leverage: CONFIG.leverage,
    maxNotionalMultiple: CONFIG.maxNotionalMultiple,
    takerFeeRate: CONFIG.takerFeeRate,
    slippageRate: CONFIG.slippageRate
  };
  return parentCalculatePositionSize({ price: signal.price, sl: signal.sl }, cfg);
}

async function getMTFScalper(symbol, liquidity24h) {
  const frames = {};
  const intervals = [CONFIG.baseInterval, ...CONFIG.confirmIntervals, CONFIG.trendInterval];
  const results = await Promise.all(intervals.map(async interval => {
    try {
      const klines = await getKlines(symbol, interval, CONFIG.limits[interval]);
      return [interval, klines];
    } catch (e) {
      console.log(`${symbol} ${interval}: ${e.message}`);
      return [interval, null];
    }
  }));
  for (const [iv, ks] of results) if (ks) frames[iv] = ks;

  if (!frames['1m']) return { ok: false, reason: 'no-1m' };

  const base = analyze1m(frames['1m'], { symbol });
  if (!base.signal) return { ok: false, reason: base.reason || '1m-reject', frames };

  const dir = base.signal.dir;

  for (const iv of CONFIG.confirmIntervals) {
    if (!frames[iv]) return { ok: false, reason: `missing-${iv}`, frames };
    const confDir = emaDirection(frames[iv]);
    if (confDir !== dir) return { ok: false, reason: `confirm-${iv}-conflict:${confDir}`, frames };
  }

  if (frames['15m']) {
    const trend = softTrend15m(frames['15m']);
    if (trend && trend !== dir) {
      return { ok: false, reason: `trend-15m-against:${trend}`, frames };
    }
  }

  let ob = null;
  try { ob = await getOrderBookImbalance(symbol); } catch (_) {}
  if (Number.isFinite(ob)) {
    const obDir = ob > 0.12 ? 'LONG' : ob < -0.12 ? 'SHORT' : null;
    base.signal.orderBookImbalance = round(ob, 4);
    base.signal.obAligned = obDir === dir;
  }

  const leveled = levelsFromSignal(base.signal);
  if (!leveled) return { ok: false, reason: 'invalid-levels', frames };

  leveled.liquidity24h = liquidity24h;
  leveled.position = calculatePositionSize(leveled);
  leveled.filters = [
    `EMA9/21 ${dir}`,
    base.signal.volSpike ? 'VOL_SPIKE' : 'EMA_CROSS',
    `RSI7 ${round(base.signal.rsi, 1)}`,
    `ATR×${CONFIG.atrSlMult}`,
    `RR 1:${leveled.rr}`,
    '3m+5m OK'
  ];
  if (leveled.obAligned) leveled.filters.push('OB ✓');

  return { ok: true, signal: leveled, frames };
}

function canEmit(tracked, signal) {
  const openCount = tracked.filter(t => !t.closed).length;
  if (openCount >= CONFIG.maxOpenTrades) {
    return { ok: false, reason: `max-open-${openCount}` };
  }
  const last = tracked
    .filter(t => t.symbol === signal.symbol && t.dir === signal.dir)
    .sort((a, b) => Number(b.ts || 0) - Number(a.ts || 0))[0];
  if (last && Date.now() - Number(last.ts || 0) < CONFIG.cooldownMs) {
    const left = Math.ceil((CONFIG.cooldownMs - (Date.now() - Number(last.ts))) / 60000);
    return { ok: false, reason: `cooldown-${left}m` };
  }
  return { ok: true };
}

function entryFillPrice(raw, dir) {
  return raw * (dir === 'LONG' ? 1 + CONFIG.slippageRate : 1 - CONFIG.slippageRate);
}
function exitFillPrice(raw, dir) {
  return raw * (dir === 'LONG' ? 1 - CONFIG.slippageRate : 1 + CONFIG.slippageRate);
}

async function send(message) {
  const token = CONFIG.telegramToken;
  const chat = CONFIG.telegramChat;
  if (!token) {
    console.log('Scalper Telegram disabled (no token)');
    return false;
  }
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), CONFIG.requestTimeoutMs);
    const res = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      signal: controller.signal,
      body: JSON.stringify({ chat_id: chat, text: message, parse_mode: 'HTML' })
    });
    clearTimeout(timer);
    if (!res.ok) {
      console.log(`Scalper Telegram HTTP ${res.status}`);
      return false;
    }
    console.log('✓ Scalper Telegram sent');
    return true;
  } catch (e) {
    console.log(`Scalper Telegram error: ${e.message}`);
    return false;
  }
}

function buildSignalMessage(s) {
  const direction = s.dir === 'LONG' ? 'شراء 🟢' : 'بيع 🔴';
  return `⚡ <b>SCALPER</b> ⚡\n\n` +
    `الزوج: <b>${esc(s.symbol)}</b> (Futures)\n` +
    `📈 الاتجاه: ${direction}\n` +
    `💰 دخول: <code>${s.price}</code>\n` +
    `🛑 SL: <code>${round(s.sl, 6)}</code>\n` +
    `🎯 TP: <code>${round(s.tp1, 6)}</code>\n` +
    `⚖️ R:R 1:${s.rr}\n` +
    `📊 RSI7: ${round(s.rsi, 1)} | ATR: ${round(s.atrPct * 100, 3)}%\n` +
    `🔍 ${s.filters.join(' | ')}\n` +
    `⏰ ${fmtTime()} | ${ENGINE_VERSION}`;
}

function buildCloseMessage(trade, result) {
  const outcome = result === 'SL' ? '⛔ SL' : result.startsWith('TP') ? `✅ ${result}` : '⏱️ انتهت المدة';
  return `⚡ <b>SCALPER إغلاق</b> ⚡\n\n` +
    `${esc(trade.symbol)} ${trade.dir}\n${outcome}\n` +
    `دخول: <code>${trade.price}</code> → خروج: <code>${trade.closePrice}</code>\n` +
    `صافي: <b>${trade.closePct >= 0 ? '+' : ''}${trade.closePct}%</b>\n` +
    `⏰ ${fmtTime()}`;
}

async function checkOpenTrades() {
  const tracked = loadTracked();
  const open = tracked.filter(t => !t.closed);
  if (!open.length) {
    console.log('Scalper: no open trades');
    return;
  }
  const prices = new Map();
  for (const t of open) {
    try { prices.set(t.symbol, await getTicker(t.symbol)); }
    catch (e) { console.log(`price ${t.symbol}: ${e.message}`); }
  }
  let closedCount = 0;
  for (const trade of open) {
    const price = prices.get(trade.symbol);
    if (!Number.isFinite(price)) continue;
    const sign = trade.dir === 'LONG' ? 1 : -1;
    const slHit = sign === 1 ? price <= trade.sl : price >= trade.sl;
    const tpHit = sign === 1 ? price >= trade.tp1 : price <= trade.tp1;
    const expired = Date.now() - Number(trade.ts || 0) > CONFIG.maxTradeAgeMs;
    let result = null;
    if (slHit) result = 'SL';
    else if (tpHit) result = 'TP1';
    else if (expired) result = 'TIMEOUT';
    if (!result) continue;

    const entryF = trade.entryFillPrice || entryFillPrice(trade.price, trade.dir);
    const exitF = exitFillPrice(price, trade.dir);
    const grossPct = sign * (exitF - entryF) / entryF * 100;
    const feesPct = CONFIG.takerFeeRate * 2 * 100;
    const slipPct = CONFIG.slippageRate * 2 * 100;
    trade.closed = true;
    trade.closePrice = price;
    trade.closeResult = result;
    trade.entryFillPrice = entryF;
    trade.exitFillPrice = exitF;
    trade.grossPnlPct = round(grossPct, 4);
    trade.feesPct = round(feesPct, 4);
    trade.slippagePct = round(slipPct, 4);
    trade.closePct = round(grossPct - feesPct, 4);
    trade.netPnlUsd = trade.position?.notional
      ? round(trade.position.notional * trade.closePct / 100, 4) : null;
    trade.closeAt = new Date().toISOString();
    closedCount++;
    await send(buildCloseMessage(trade, result));
    console.log(`Scalper close ${trade.symbol}: ${result} net=${trade.closePct}%`);
  }
  if (closedCount) saveTracked(tracked);
  console.log(`Scalper open follow-up: closed ${closedCount}`);
}

async function scan() {
  writeHeartbeat(true, { phase: 'start' });
  const today = fmtDate();
  await checkOpenTrades();

  const verification = loadVerification();
  if (!verificationPassed(verification)) {
    if (CONFIG.verificationGateMode === 'warn') {
      console.warn(`Scalper gate warn: ${verification.reason || verification.status}`);
    } else {
      console.log(`Scalper broadcast blocked by gate: ${verification.reason || verification.status}`);
      writeHeartbeat(true, { phase: 'blocked-by-gate' });
      return;
    }
  }

  let tracked = loadTracked();
  const todayCount = tracked.filter(t => t.date === today).length;
  if (todayCount >= CONFIG.maxSignalsPerDay) {
    console.log('Scalper daily signal limit reached');
    writeHeartbeat(true, { phase: 'daily-limit' });
    return;
  }

  console.log(`⚡ ${ENGINE_VERSION} — ${CONFIG.symbols.length} symbols — ${new Date().toISOString()}`);
  let volumeMap;
  try {
    volumeMap = await get24hVolumeMap(CONFIG.symbols);
  } catch (e) {
    console.log(`Scalper volume map failed: ${e.message}`);
    writeHeartbeat(false, { error: e.message });
    return;
  }

  const eligible = CONFIG.symbols.filter(s =>
    finite(volumeMap.get(s)?.quoteVolume, 0) >= CONFIG.minQuoteVolume24h
  );
  console.log(`Scalper liquidity: ${eligible.length}/${CONFIG.symbols.length}`);

  const results = await Promise.all(eligible.map(async symbol => {
    try {
      return { symbol, ...(await getMTFScalper(symbol, volumeMap.get(symbol).quoteVolume)) };
    } catch (e) {
      console.log(`Scalper eval ${symbol}: ${e.message}`);
      return { symbol, ok: false, reason: 'eval-error' };
    }
  }));

  const candidates = results
    .filter(r => r.ok && r.signal)
    .map(r => r.signal)
    .filter(s => canEmit(tracked, s).ok)
    .sort((a, b) => (b.volSpike ? 1 : 0) - (a.volSpike ? 1 : 0) || b.atrPct - a.atrPct);

  const remaining = CONFIG.maxSignalsPerDay - todayCount;
  const openSlots = CONFIG.maxOpenTrades - tracked.filter(t => !t.closed).length;
  const take = Math.max(0, Math.min(remaining, openSlots, candidates.length, 2));

  if (!take) {
    console.log('Scalper: no eligible candidates this cycle');
    writeHeartbeat(true, { phase: 'no-candidates', candidates: candidates.length });
    return;
  }

  for (let i = 0; i < take; i++) {
    const chosen = candidates[i];
    const cd = canEmit(tracked, chosen);
    if (!cd.ok) continue;

    const record = {
      ...chosen,
      engineVersion: ENGINE_VERSION,
      feeRate: CONFIG.takerFeeRate,
      slippageRate: CONFIG.slippageRate,
      date: today,
      ts: Date.now(),
      closed: false,
      entryFillPrice: entryFillPrice(chosen.price, chosen.dir)
    };

    if (CONFIG.dryRun) {
      console.log(`DRY_RUN SCALPER: ${record.dir} ${record.symbol} RR 1:${record.rr}`);
      console.log(buildSignalMessage(record));
      continue;
    }

    tracked.push(record);
    saveTracked(tracked);
    await send(buildSignalMessage(record));
    console.log(`✓ SCALPER ${record.dir} ${record.symbol} | RR 1:${record.rr}`);
  }

  writeHeartbeat(true, { phase: 'done', emitted: take });
}

if (process.env.SCALPER_TEST === '1' || require.main !== module) {
  module.exports = {
    CONFIG, ENGINE_VERSION, GATE_VERSION,
    analyze1m, emaDirection, softTrend15m, levelsFromSignal,
    calculatePositionSize, canEmit, entryFillPrice, exitFillPrice,
    prepareKlines, Indicators, loadTracked, saveTracked,
    loadVerification, verificationPassed, getMTFScalper, netPnl
  };
} else {
  scan().catch(e => {
    console.error(`Scalper fatal: ${e.stack || e.message}`);
    writeHeartbeat(false, { error: String(e.message || e) });
    process.exitCode = 1;
  });
}
