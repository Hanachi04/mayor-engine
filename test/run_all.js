'use strict';
// Runs every test file with live state redirected to a fresh temp dir,
// then fails if anything under data/ was modified.
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const ROOT = path.join(__dirname, '..');
const FILES = [
  'test/unit.test.js',
  'test/scalper/unit.test.js',
  'test/adaptation.test.js',
  'test/circuit_breaker.test.js',
  'test/auto_status.test.js',
  'test/integration_pipeline.test.js',
  'test/heartbeat.test.js',
  'test/engine4/unit.test.js',
  'test/exit_and_edge.test.js',
  'test/binance_http.test.js',
  'test/atomic_json.test.js',
  'test/ml_shadow.test.js'
];

const stateDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mayor-state-'));
let failed = 0;
for (const file of FILES) {
  const testStateDir = path.join(stateDir, path.basename(file, '.js'));
  fs.mkdirSync(testStateDir, { recursive: true });
  const env = { ...process.env, MAYOR_STATE_DIR: testStateDir };
  console.log(`\n=== ${file} ===`);
  const r = spawnSync(process.execPath, [path.join(ROOT, file)], { stdio: 'inherit', env, cwd: ROOT });
  if (r.status !== 0) {
    console.error(`FAILED: ${file} (exit ${r.status}${r.signal ? ', signal ' + r.signal : ''})`);
    failed++;
    break;
  }
}

try { fs.rmSync(stateDir, { recursive: true, force: true }); } catch (_) {}

const git = spawnSync('git', ['status', '--porcelain', '--', 'data/'], { cwd: ROOT, encoding: 'utf8' });
if (git.status !== 0) {
  console.error('git status failed:', git.stderr);
  process.exit(1);
}
if (git.stdout.trim()) {
  console.error('Tests modified tracked files under data/:\n' + git.stdout);
  process.exit(1);
}
if (failed) process.exit(1);
console.log('\nAll test files passed; data/ clean.');
