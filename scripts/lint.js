'use strict';

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const root = path.join(__dirname, '..');
const files = [
  'engine/scan.js',
  'engine/backtest.js',
  'engine/shared/data-contract.js',
  'engine/scalper/scan.js',
  'engine/scalper/backtest.js',
  'test/unit.test.js',
  'test/scalper/unit.test.js',
  'test/shared/data-contract.test.js'
];
for (const relative of files) {
  const file = path.join(root, relative);
  if (!fs.existsSync(file)) throw new Error(`lint target missing: ${relative}`);
  const result = spawnSync(process.execPath, ['--check', file], { stdio: 'inherit' });
  if (result.status !== 0) process.exit(result.status || 1);
}
console.log(`✓ lint: syntax checked ${files.length} files`);
