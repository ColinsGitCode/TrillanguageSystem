'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

const SAFE_MEMBER_PART_RE = /^[A-Za-z0-9._-]+$/;
const SHA256_HEX_RE = /^[0-9a-f]{64}$/;
const RUN_ID_RE = /^[0-9]{8}T[0-9]{6}Z-[0-9a-f]{8}$/;

function canonicalJsonBytes(value) {
  return Buffer.from(stableStringify(value), 'utf8');
}

function stableStringify(value) {
  if (value === null || typeof value !== 'object') {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map((item) => stableStringify(item)).join(',')}]`;
  }
  const keys = Object.keys(value).sort();
  const entries = keys
    .filter((key) => value[key] !== undefined)
    .map((key) => `${JSON.stringify(key)}:${stableStringify(value[key])}`);
  return `{${entries.join(',')}}`;
}

function assertPrivateDir(dirPath) {
  const st = fs.lstatSync(dirPath);
  if (st.isSymbolicLink() || !st.isDirectory()) {
    throw new Error('private_directory_required');
  }
  if ((st.mode & 0o077) !== 0) {
    throw new Error('private_directory_permissions_too_open');
  }
  if (typeof process.getuid === 'function' && st.uid !== process.getuid()) {
    throw new Error('private_directory_owner_mismatch');
  }
  return st;
}

function assertPrivateFile(filePath, { maxBytes = null } = {}) {
  const st = fs.lstatSync(filePath);
  if (st.isSymbolicLink() || !st.isFile()) {
    throw new Error('private_file_required');
  }
  if ((st.mode & 0o077) !== 0) {
    throw new Error('private_file_permissions_too_open');
  }
  if (typeof process.getuid === 'function' && st.uid !== process.getuid()) {
    throw new Error('private_file_owner_mismatch');
  }
  if (maxBytes !== null && st.size > maxBytes) {
    throw new Error('private_file_size_limit_exceeded');
  }
  return st;
}

function ensurePrivateDir(dirPath) {
  fs.mkdirSync(dirPath, { recursive: true, mode: 0o700 });
  const st = fs.lstatSync(dirPath);
  if (st.isSymbolicLink() || !st.isDirectory()) {
    throw new Error('private_directory_required');
  }
  if ((st.mode & 0o077) !== 0) {
    fs.chmodSync(dirPath, 0o700);
  }
  return assertPrivateDir(dirPath);
}

function readPrivateJson(filePath, { maxBytes = 2 * 1024 * 1024 } = {}) {
  assertPrivateFile(filePath, { maxBytes });
  const raw = fs.readFileSync(filePath, 'utf8');
  return JSON.parse(raw);
}

function writePrivateFileAtomic(filePath, data) {
  const dir = path.dirname(filePath);
  ensurePrivateDir(dir);
  const tempPath = path.join(
    dir,
    `.${path.basename(filePath)}-${crypto.randomBytes(6).toString('hex')}.tmp`
  );
  const flags = fs.constants.O_WRONLY
    | fs.constants.O_CREAT
    | fs.constants.O_EXCL
    | (fs.constants.O_NOFOLLOW || 0);
  const fd = fs.openSync(tempPath, flags, 0o600);
  try {
    const buf = Buffer.isBuffer(data) ? data : Buffer.from(data, 'utf8');
    let offset = 0;
    while (offset < buf.length) {
      offset += fs.writeSync(fd, buf, offset, buf.length - offset);
    }
    fs.fsyncSync(fd);
  } catch (err) {
    try { fs.closeSync(fd); } catch {}
    try { fs.unlinkSync(tempPath); } catch {}
    throw err;
  }
  fs.closeSync(fd);
  fs.renameSync(tempPath, filePath);
}

function writePrivateJsonAtomic(filePath, value) {
  writePrivateFileAtomic(filePath, canonicalJsonBytes(value));
}

function sha256File(filePath) {
  return new Promise((resolve, reject) => {
    const hash = crypto.createHash('sha256');
    let size = 0;
    const stream = fs.createReadStream(filePath);
    stream.on('data', (chunk) => {
      size += chunk.length;
      hash.update(chunk);
    });
    stream.on('error', reject);
    stream.on('end', () => resolve({ sha256: hash.digest('hex'), size }));
  });
}

function sha256FileSync(filePath) {
  const hash = crypto.createHash('sha256');
  const fd = fs.openSync(filePath, 'r');
  const buf = Buffer.allocUnsafe(1024 * 1024);
  let size = 0;
  try {
    while (true) {
      const n = fs.readSync(fd, buf, 0, buf.length, null);
      if (n <= 0) break;
      size += n;
      hash.update(buf.subarray(0, n));
    }
  } finally {
    fs.closeSync(fd);
  }
  return { sha256: hash.digest('hex'), size };
}

// tar prints member names in the caller's locale. Without a UTF-8 locale, as
// under ssh, launchd or a bare spawn, macOS bsdtar escapes every non-ASCII byte
// ("\345\210\206…"), and card filenames are almost all Chinese or Japanese:
// the listing then fails the path check and offline restore stops. Every tar
// call runs with an explicit UTF-8 locale instead of inheriting one.
function tarEnv(extra = {}) {
  const locale = process.platform === 'darwin' ? 'en_US.UTF-8' : 'C.UTF-8';
  return { ...process.env, LANG: locale, LC_ALL: locale, ...extra };
}

function assertSafeRelativePath(relPath) {
  if (typeof relPath !== 'string' || !relPath || relPath.includes('\0')) {
    throw new Error('invalid_archive_member_path');
  }
  if (path.isAbsolute(relPath) || relPath.startsWith('/') || relPath.startsWith('\\')) {
    throw new Error('absolute_archive_member_path');
  }
  const normalized = relPath.replace(/\\/g, '/');
  const parts = normalized.split('/');
  for (const part of parts) {
    if (!part || part === '.' || part === '..') {
      throw new Error('unsafe_archive_member_path');
    }
  }
  return normalized;
}

function isPidAlive(pid) {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    return err && err.code === 'EPERM';
  }
}

function acquireNonBlockingLock(lockPath, { origin = 'manual' } = {}) {
  ensurePrivateDir(path.dirname(lockPath));
  const payload = canonicalJsonBytes({
    pid: process.pid,
    origin,
    started_at: new Date().toISOString(),
  });
  const flags = fs.constants.O_WRONLY
    | fs.constants.O_CREAT
    | fs.constants.O_EXCL
    | (fs.constants.O_NOFOLLOW || 0);

  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      const fd = fs.openSync(lockPath, flags, 0o600);
      try {
        fs.writeSync(fd, payload);
        fs.fsyncSync(fd);
      } finally {
        fs.closeSync(fd);
      }
      return {
        release() {
          try {
            const current = JSON.parse(fs.readFileSync(lockPath, 'utf8'));
            if (current && current.pid === process.pid) {
              fs.unlinkSync(lockPath);
            }
          } catch {}
        },
      };
    } catch (err) {
      if (!err || err.code !== 'EEXIST') throw err;
      let existing = null;
      try {
        existing = JSON.parse(fs.readFileSync(lockPath, 'utf8'));
      } catch {}
      if (existing && isPidAlive(existing.pid)) {
        return null;
      }
      // Stale lock from a crashed process: remove once and retry atomically.
      try { fs.unlinkSync(lockPath); } catch {}
    }
  }
  return null;
}

module.exports = {
  SAFE_MEMBER_PART_RE,
  SHA256_HEX_RE,
  RUN_ID_RE,
  canonicalJsonBytes,
  stableStringify,
  assertPrivateDir,
  assertPrivateFile,
  ensurePrivateDir,
  readPrivateJson,
  writePrivateFileAtomic,
  writePrivateJsonAtomic,
  sha256File,
  sha256FileSync,
  assertSafeRelativePath,
  acquireNonBlockingLock,
  tarEnv,
};
