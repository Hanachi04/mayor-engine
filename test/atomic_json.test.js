'use strict';
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { atomicWriteJson, readJsonWithBackup, backupPath } = require('../engine/atomic_json');
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'atomic-json-'));
const file = path.join(dir, 'state.json');
try {
  atomicWriteJson(file, { value: 1 }, { validate: v => typeof v?.value === 'number' });
  atomicWriteJson(file, { value: 2 }, { validate: v => typeof v?.value === 'number' });
  assert.deepStrictEqual(JSON.parse(fs.readFileSync(backupPath(file), 'utf8')), { value: 1 });
  fs.writeFileSync(file, '{corrupt');
  assert.deepStrictEqual(readJsonWithBackup(file, { value: 0 }, { validate: v => typeof v?.value === 'number' }), { value: 1 });
  atomicWriteJson(file, { value: 3 }, { validate: v => typeof v?.value === 'number' });
  assert.deepStrictEqual(JSON.parse(fs.readFileSync(file, 'utf8')), { value: 3 });
  assert.deepStrictEqual(readJsonWithBackup(file, { value: 0 }, { validate: v => typeof v?.value === 'number' }), { value: 3 });
  assert.strictEqual(fs.readdirSync(dir).some(name => name.includes('.tmp-')), false);
  console.log('✓ atomic JSON writes preserve a valid backup and recover corrupt state');
} finally { fs.rmSync(dir, { recursive: true, force: true }); }
