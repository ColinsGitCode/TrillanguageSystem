'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { createHash } = require('node:crypto');
const { execFileSync } = require('node:child_process');

function collectBuildMetadata(root) {
  const git = (...args) => execFileSync('git', args, { cwd: root, encoding: 'utf8' });
  const commit = git('rev-parse', 'HEAD').trim();
  const dirty = Boolean(git('status', '--porcelain', '--untracked-files=all').trim());
  const files = [...new Set(git('ls-files', '-z', '--cached', '--others', '--exclude-standard')
    .split('\0').filter(Boolean))].sort();
  const hash = createHash('sha256');
  // Fingerprint Git-visible source only; ignored secrets/runtime data are not inputs.
  for (const file of files) {
    const fullPath = path.join(root, file);
    let stat;
    try { stat = fs.lstatSync(fullPath); } catch (error) {
      if (error.code === 'ENOENT') continue;
      throw error;
    }
    if (!stat.isFile() && !stat.isSymbolicLink()) throw new Error(`Unsupported source entry: ${file}`);
    const contents = stat.isSymbolicLink() ? fs.readlinkSync(fullPath) : fs.readFileSync(fullPath);
    hash.update(JSON.stringify([file, stat.mode, createHash('sha256').update(contents).digest('hex')]));
  }
  return { commit, dirty, sourceHash: hash.digest('hex'), builtAtUtc: new Date().toISOString() };
}

function rebuildViewer({ root = path.resolve(__dirname, '../..'), run = execFileSync } = {}) {
  const metadata = collectBuildMetadata(root);
  const compose = ['compose', '-p', 'three_lans_system'];
  const buildArgs = Object.entries({
    BUILD_COMMIT: metadata.commit,
    BUILD_TIME: metadata.builtAtUtc,
    BUILD_DIRTY: metadata.dirty,
    BUILD_SOURCE_HASH: metadata.sourceHash,
  }).flatMap(([key, value]) => ['--build-arg', `${key}=${value}`]);
  console.log(JSON.stringify(metadata));
  run('docker', [...compose, 'build', ...buildArgs, 'viewer'], { cwd: root, stdio: 'inherit' });
  const after = collectBuildMetadata(root);
  if (after.commit !== metadata.commit || after.dirty !== metadata.dirty || after.sourceHash !== metadata.sourceHash) {
    throw new Error('Source changed during build; viewer was not restarted. Rebuild from a stable checkout.');
  }
  run('docker', [...compose, 'up', '-d', '--no-build', '--no-deps', 'viewer'], { cwd: root, stdio: 'inherit' });
  return metadata;
}

if (require.main === module) {
  const args = process.argv.slice(2);
  if (args.length === 1 && args[0] === '--metadata-only') {
    console.log(JSON.stringify(collectBuildMetadata(path.resolve(__dirname, '../..')), null, 2));
  } else if (args.length) {
    throw new Error('Usage: npm run deploy:viewer [-- --metadata-only]');
  } else {
    rebuildViewer();
  }
}

module.exports = { collectBuildMetadata, rebuildViewer };
