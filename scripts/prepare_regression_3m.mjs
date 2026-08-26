import fs from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const SOURCE_DIR = path.join(ROOT, 'data', 'historical');
const TARGET_DIR = path.join(ROOT, 'data', 'historical-regression-3m');
const AUDIT_FILE = '/home/ubuntu/research/history_audit_1y_multiframe_output.json';
const START_MS = Date.parse('2026-05-23T00:00:00.000Z');
const END_EXCLUSIVE_MS = Date.parse('2026-08-23T00:00:00.000Z');
const INTERVALS = { '5m': 5 * 60_000, '15m': 15 * 60_000, '1h': 60 * 60_000, '4h': 4 * 60 * 60_000 };

function writeJsonAtomic(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const temp = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(temp, JSON.stringify(value));
  fs.renameSync(temp, file);
}

const audit = JSON.parse(fs.readFileSync(AUDIT_FILE, 'utf8'));
const symbols = audit.symbols.filter(row => row.status === 'valid').map(row => row.symbol).sort();
if (symbols.length !== 35) throw new Error(`expected-35-valid-symbols:actual=${symbols.length}`);

const summary = { startUtc: new Date(START_MS).toISOString(), endExclusiveUtc: new Date(END_EXCLUSIVE_MS).toISOString(), symbols, frames: {} };
for (const [interval, cadence] of Object.entries(INTERVALS)) {
  const expected = (END_EXCLUSIVE_MS - START_MS) / cadence;
  summary.frames[interval] = { expectedCandlesPerSymbol: expected, symbols: {} };
  for (const symbol of symbols) {
    const source = path.join(SOURCE_DIR, `${symbol}_${interval}.json`);
    const target = path.join(TARGET_DIR, `${symbol}_${interval}.json`);
    const raw = JSON.parse(fs.readFileSync(source, 'utf8'));
    const windowed = raw.filter(candle => Number(candle?.[0]) >= START_MS && Number(candle?.[0]) < END_EXCLUSIVE_MS);
    if (windowed.length !== expected) throw new Error(`unexpected-window-count:${symbol}:${interval}:actual=${windowed.length}:expected=${expected}`);
    if (Number(windowed[0]?.[0]) !== START_MS || Number(windowed.at(-1)?.[0]) !== END_EXCLUSIVE_MS - cadence) {
      throw new Error(`unexpected-window-boundary:${symbol}:${interval}`);
    }
    writeJsonAtomic(target, windowed);
    summary.frames[interval].symbols[symbol] = windowed.length;
  }
}
writeJsonAtomic(path.join(TARGET_DIR, 'manifest.json'), summary);
console.log(JSON.stringify({ target: TARGET_DIR, symbolCount: symbols.length, frames: Object.fromEntries(Object.entries(summary.frames).map(([frame, value]) => [frame, value.expectedCandlesPerSymbol])) }, null, 2));
