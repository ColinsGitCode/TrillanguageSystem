#!/usr/bin/env node

import process from 'node:process';
import { inspectAsset } from '../../../services/textbooks/manifestContract.mjs';

function usage() {
  return 'Usage: hash-assets.mjs --root <source-root> --path <relative-path> [--path <relative-path> ...]';
}

function parseArgs(argv) {
  const options = { paths: [] };
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (token === '--root') options.root = argv[++index];
    else if (token === '--path') options.paths.push(argv[++index]);
    else throw new Error(`Unknown argument: ${token}`);
  }
  if (!options.root || options.paths.length === 0 || options.paths.some((value) => !value)) throw new Error(usage());
  return options;
}

try {
  const options = parseArgs(process.argv.slice(2));
  const assets = options.paths.map((relativePath) => inspectAsset(options.root, relativePath));
  process.stdout.write(`${JSON.stringify({ assets }, null, 2)}\n`);
} catch (error) {
  const code = String(error.message || '').startsWith('TEXTBOOK_')
    ? error.message
    : error.code === 'ENOENT'
      ? 'TEXTBOOK_MEDIA_NOT_FOUND'
      : 'TEXTBOOK_ASSET_HASH_FAILED';
  process.stderr.write(`${JSON.stringify({ success: false, error: code })}\n`);
  process.exitCode = 1;
}
