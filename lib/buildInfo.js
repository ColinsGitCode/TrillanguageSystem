'use strict';

const fs = require('node:fs');
const path = require('node:path');

const BUILD_INFO_PATH = path.join(__dirname, '..', 'build-info.json');

function sanitizeCommit(value) {
  const commit = String(value || '').trim();
  return /^[a-f0-9]{7,40}$/iu.test(commit) ? commit : null;
}

function sanitizeBuildTime(value) {
  const date = new Date(String(value || ''));
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

function sanitizeBuildInfo(value = {}) {
  return {
    commit: sanitizeCommit(value?.commit),
    builtAtUtc: sanitizeBuildTime(value?.builtAtUtc),
    dirty: typeof value?.dirty === 'boolean' ? value.dirty : null,
    sourceHash: typeof value?.sourceHash === 'string' && /^[a-f0-9]{64}$/u.test(value.sourceHash) ? value.sourceHash : null,
  };
}

function buildInfoFromEnv(env = process.env) {
  return sanitizeBuildInfo({
    commit: env.BUILD_COMMIT,
    builtAtUtc: env.BUILD_TIME,
    dirty: env.BUILD_DIRTY === 'true' ? true : env.BUILD_DIRTY === 'false' ? false : null,
    sourceHash: env.BUILD_SOURCE_HASH,
  });
}

function readBuildInfo({ filePath = BUILD_INFO_PATH, env = process.env } = {}) {
  try {
    // Baked metadata wins over runtime environment variables, including when damaged.
    return sanitizeBuildInfo(JSON.parse(fs.readFileSync(filePath, 'utf8')));
  } catch (error) {
    return error.code === 'ENOENT' ? buildInfoFromEnv(env) : sanitizeBuildInfo();
  }
}

module.exports = {
  BUILD_INFO_PATH,
  buildInfoFromEnv,
  readBuildInfo,
  sanitizeBuildInfo,
  sanitizeCommit,
  sanitizeBuildTime,
};
