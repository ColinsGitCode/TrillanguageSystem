'use strict';

const fs = require('node:fs');
const { BUILD_INFO_PATH, buildInfoFromEnv } = require('../../lib/buildInfo');

function writeBuildInfo({ filePath = BUILD_INFO_PATH, env = process.env } = {}) {
  const info = buildInfoFromEnv({ ...env, BUILD_TIME: env.BUILD_TIME || new Date().toISOString() });
  for (const [key, field] of [
    ['BUILD_COMMIT', 'commit'], ['BUILD_TIME', 'builtAtUtc'],
    ['BUILD_DIRTY', 'dirty'], ['BUILD_SOURCE_HASH', 'sourceHash'],
  ]) {
    if (env[key] && info[field] === null) throw new Error(`Invalid ${key}`);
  }
  fs.writeFileSync(filePath, `${JSON.stringify(info, null, 2)}\n`);
  return info;
}

if (require.main === module) writeBuildInfo();

module.exports = { writeBuildInfo };
