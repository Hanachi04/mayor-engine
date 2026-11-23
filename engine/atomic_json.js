'use strict';

const fs = require('fs');
const path = require('path');

function backupPath(filePath) { return `${filePath}.bak`; }

function readCandidate(filePath, validate) {
  try {
    const text = fs.readFileSync(filePath, 'utf8');
    const value = JSON.parse(text);
    if (validate && !validate(value)) return { ok: false, error: new Error(`invalid JSON value in ${filePath}`) };
    return { ok: true, value };
  } catch (error) {
    return { ok: false, error };
  }
}

function readJsonWithBackup(filePath, fallback, { validate } = {}) {
  if (!fs.existsSync(filePath)) {
    const backup = readCandidate(backupPath(filePath), validate);
    return backup.ok ? backup.value : fallback;
  }
  const primary = readCandidate(filePath, validate);
  if (primary.ok) return primary.value;
  const backup = readCandidate(backupPath(filePath), validate);
  return backup.ok ? backup.value : fallback;
}

function atomicWriteText(filePath, text) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const temp = `${filePath}.tmp-${process.pid}-${Date.now()}-${Math.random().toString(16).slice(2)}`;
  let fd;
  try {
    fd = fs.openSync(temp, 'wx', 0o600);
    fs.writeFileSync(fd, text, 'utf8');
    fs.fsyncSync(fd);
    fs.closeSync(fd); fd = undefined;
    fs.renameSync(temp, filePath);
    try {
      const dirFd = fs.openSync(path.dirname(filePath), 'r');
      try { fs.fsyncSync(dirFd); } finally { fs.closeSync(dirFd); }
    } catch (_) { /* directory fsync is not supported on every platform */ }
  } catch (error) {
    if (fd !== undefined) fs.closeSync(fd);
    try { fs.unlinkSync(temp); } catch (_) {}
    throw error;
  }
}

function atomicWriteJson(filePath, value, { validate } = {}) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  if (fs.existsSync(filePath)) {
    const previous = readCandidate(filePath, validate);
    if (previous.ok) {
      const oldText = fs.readFileSync(filePath, 'utf8');
      atomicWriteText(backupPath(filePath), oldText);
    }
  }
  atomicWriteText(filePath, `${JSON.stringify(value, null, 2)}\n`);
}

module.exports = { atomicWriteJson, readJsonWithBackup, backupPath };
