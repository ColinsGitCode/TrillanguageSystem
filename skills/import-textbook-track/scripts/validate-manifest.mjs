#!/usr/bin/env node

import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';
import Ajv2020 from 'ajv/dist/2020.js';
import addFormats from 'ajv-formats';
import {
  applyComputedHashes,
  runDeterministicChecks,
  summarizeManifest,
} from '../../../services/textbooks/manifestContract.mjs';

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const defaultSchemaPath = path.resolve(scriptDir, '../../../Docs/Architecture/schemas/textbook-track-manifest.v1.schema.json');

function usage() {
  return [
    'Usage: validate-manifest.mjs --manifest <path> --source-root <path>',
    '  [--schema <path>] [--write-hashes] [--summary <path>]',
  ].join('\n');
}

function parseArgs(argv) {
  const options = { schema: defaultSchemaPath, writeHashes: false };
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (token === '--manifest') options.manifest = argv[++index];
    else if (token === '--source-root') options.sourceRoot = argv[++index];
    else if (token === '--schema') options.schema = argv[++index];
    else if (token === '--summary') options.summary = argv[++index];
    else if (token === '--write-hashes') options.writeHashes = true;
    else throw new Error(`Unknown argument: ${token}`);
  }
  if (!options.manifest || !options.sourceRoot) throw new Error(usage());
  return options;
}

function loadJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function schemaErrors(validate) {
  return (validate.errors || []).map((error) => ({
    code: 'MANIFEST_SCHEMA_INVALID',
    instancePath: error.instancePath,
    keyword: error.keyword,
    message: error.message,
  }));
}

function atomicWriteJson(filePath, value) {
  const temporaryPath = `${filePath}.tmp-${process.pid}`;
  fs.writeFileSync(temporaryPath, `${JSON.stringify(value, null, 2)}\n`, { encoding: 'utf8', mode: 0o600 });
  fs.renameSync(temporaryPath, filePath);
}

function assertSchema(validate, manifest) {
  if (!validate(manifest)) {
    const error = new Error('TEXTBOOK_MANIFEST_INVALID');
    error.details = schemaErrors(validate);
    throw error;
  }
}

try {
  const options = parseArgs(process.argv.slice(2));
  const schema = loadJson(options.schema);
  const ajv = new Ajv2020({ allErrors: true, strict: true });
  addFormats(ajv);
  const validate = ajv.compile(schema);
  const manifest = loadJson(options.manifest);
  assertSchema(validate, manifest);

  if (options.writeHashes) {
    const preHashErrors = runDeterministicChecks(manifest, {
      sourceRoot: options.sourceRoot,
      verifyComputedHashes: false,
    });
    if (preHashErrors.length) {
      const error = new Error('TEXTBOOK_MANIFEST_INVALID');
      error.details = preHashErrors;
      throw error;
    }
    applyComputedHashes(manifest);
    atomicWriteJson(options.manifest, manifest);
    assertSchema(validate, manifest);
  }

  const errors = runDeterministicChecks(manifest, { sourceRoot: options.sourceRoot });
  if (errors.length) {
    const error = new Error('TEXTBOOK_MANIFEST_INVALID');
    error.details = errors;
    throw error;
  }

  const summary = summarizeManifest(manifest);
  if (options.summary) atomicWriteJson(options.summary, summary);
  process.stdout.write(`${JSON.stringify({ success: true, summary }, null, 2)}\n`);
} catch (error) {
  const code = String(error.message || '').startsWith('TEXTBOOK_')
    ? error.message
    : error.code === 'ENOENT'
      ? 'TEXTBOOK_FILE_NOT_FOUND'
      : 'TEXTBOOK_MANIFEST_VALIDATION_FAILED';
  process.stderr.write(`${JSON.stringify({
    success: false,
    error: code,
    details: error.details || [],
  }, null, 2)}\n`);
  process.exitCode = 1;
}
