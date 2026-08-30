'use strict';

const fs = require('fs');
const path = require('path');
const { CONFIG } = require('./core');

const ENDPOINT = 'https://fapi.binance.com/fapi/v1/klines';
const LIMIT = 1000;
const MONTH_MS = 31 * 24 * 60 * 60 * 1000;
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
async function fetchPage(symbol, startTime, endTime) {
  const url = new URL(ENDPOINT); url.searchParams.set('symbol', symbol); url.searchParams.set('interval', '1m'); url.searchParams.set('limit', LIMIT); url.searchParams.set('startTime', startTime); url.searchParams.set('endTime', endTime);
  const response = await fetch(url); if (!response.ok) throw new Error(`${symbol}: HTTP ${response.status}`); return response.json();
}
async function fetchSymbol(symbol, endTime) {
  const start = endTime - MONTH_MS; const rows = []; let cursor = start;
  while (cursor < endTime) {
    const page = await fetchPage(symbol, cursor, endTime); if (!page.length) break;
    rows.push(...page); const lastOpen = Number(page.at(-1)[0]); if (lastOpen <= cursor) break; cursor = lastOpen + 60_000; await sleep(120);
  }
  const unique = [...new Map(rows.map(row => [Number(row[0]), row])).values()].sort((a, b) => a[0] - b[0]);
  fs.writeFileSync(path.join(__dirname, 'fixtures', `${symbol}_1m.json`), JSON.stringify(unique));
  console.log(`${symbol}: ${unique.length} candles`);
}
async function main() { const end = Date.now() - 60_000; for (const symbol of CONFIG.symbols) await fetchSymbol(symbol, end); }
if (require.main === module) main().catch(e => { console.error(e.stack || e.message); process.exitCode = 1; });
module.exports = { fetchSymbol };
