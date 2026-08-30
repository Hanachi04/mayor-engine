'use strict';

const fs = require('fs');
const path = require('path');
const { CONFIG, normalizeKlines, prepareKlines, analyze1m, direction, calculatePositionSize } = require('./core');

const DATA_DIR = path.join(__dirname, 'data');
const TRACKED_FILE = path.join(DATA_DIR, 'tracked.json');
const ENDPOINT = 'https://fapi.binance.com';
function loadTracked() { try { return JSON.parse(fs.readFileSync(TRACKED_FILE, 'utf8')); } catch { return []; } }
function saveTracked(v) { fs.mkdirSync(DATA_DIR, { recursive: true }); fs.writeFileSync(TRACKED_FILE, JSON.stringify(v, null, 2)); }
async function fetchJson(route, params) { const u = new URL(ENDPOINT + route); for (const [k, v] of Object.entries(params)) u.searchParams.set(k, String(v)); const r = await fetch(u); if (!r.ok) throw new Error(`Binance HTTP ${r.status}`); return r.json(); }
async function fetchFrame(symbol, interval, limit = 200) { const asOf = Date.now(); const raw = await fetchJson('/fapi/v1/klines', { symbol, interval, limit }); return prepareKlines(normalizeKlines(raw), asOf); }
function canEmit(tracked, signal, now) { const today = new Date(now).toISOString().slice(0, 10); const todayCount = tracked.filter(t => t.date === today).length; if (todayCount >= CONFIG.maxSignalsPerDay) return false; return !tracked.some(t => t.symbol === signal.symbol && t.dir === signal.dir && now - t.ts < CONFIG.cooldownMs); }
async function sendTelegram(signal) { const token = process.env.TELEGRAM_TOKEN; const chat = process.env.TELEGRAM_CHAT; if (!token || !chat) return false; const text = `SCALPER ${signal.dir} ${signal.symbol}\nEntry: ${signal.price}\nSL: ${signal.sl}\nTP1: ${signal.tp1}\nRR: 1:${signal.rr.toFixed(2)}\nHold limit: 20m`; const r = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ chat_id: chat, text }) }); return r.ok; }
async function scanOnce() { const now = Date.now(), tracked = loadTracked(), output = []; for (const symbol of CONFIG.symbols) { try { const base = await fetchFrame(symbol, '1m'); const c3 = await fetchFrame(symbol, '3m'); const c5 = await fetchFrame(symbol, '5m'); const c15 = await fetchFrame(symbol, '15m'); const baseSignal = analyze1m(base, symbol); if (!baseSignal || direction(c3) !== baseSignal.dir || direction(c5) !== baseSignal.dir || (direction(c15) && direction(c15) !== baseSignal.dir)) continue; const signal = { ...baseSignal, position: calculatePositionSize(baseSignal) }; if (!canEmit(tracked, signal, now)) continue; const record = { ...signal, ts: now, date: new Date(now).toISOString().slice(0, 10), closed: false, notificationOnly: true }; if (!process.env.DRY_RUN) { tracked.push(record); saveTracked(tracked); await sendTelegram(signal); } output.push(record); } catch (e) { console.error(`${symbol}: ${e.message}`); } } console.log(`Scalper cycle complete: ${output.length} signal(s); schedule externally every 15 minutes`); return output; }
if (require.main === module) scanOnce().catch(e => { console.error(e); process.exitCode = 1; });
module.exports = { fetchFrame, canEmit, scanOnce, sendTelegram };
