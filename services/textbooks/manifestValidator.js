'use strict';

const fs = require('node:fs');
const path = require('node:path');
const Ajv2020 = require('ajv/dist/2020');
const addFormats = require('ajv-formats');
const { textbookError } = require('./textbookErrors');

const SCHEMA_PATH = path.resolve(__dirname, '../../Docs/Architecture/schemas/textbook-track-manifest.v1.schema.json');

let compiledValidator;
let contractPromise;

function schemaErrors(validate) {
  return (validate.errors || []).map((error) => ({
    code: 'MANIFEST_SCHEMA_INVALID',
    instancePath: error.instancePath,
    keyword: error.keyword,
    message: error.message,
  }));
}

function getValidator() {
  if (compiledValidator) return compiledValidator;
  const schema = JSON.parse(fs.readFileSync(SCHEMA_PATH, 'utf8'));
  const ajv = new Ajv2020({ allErrors: true, strict: true });
  addFormats(ajv);
  compiledValidator = ajv.compile(schema);
  return compiledValidator;
}

async function getContract() {
  if (!contractPromise) {
    contractPromise = import('./manifestContract.mjs');
  }
  return contractPromise;
}

function sanitizeRelativePath(relativePath) {
  const value = String(relativePath || '').trim();
  if (!value || path.isAbsolute(value) || value.includes('\0') || value.includes('\\')) {
    throw textbookError('TEXTBOOK_MANIFEST_PATH_REJECTED', 400);
  }
  const parts = value.split('/');
  if (parts.some((part) => !part || part === '.' || part === '..')) {
    throw textbookError('TEXTBOOK_MANIFEST_PATH_REJECTED', 400);
  }
  return value;
}

function safeReadJson(filePath) {
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch (error) {
    if (error.code === 'ENOENT') throw textbookError('TEXTBOOK_MANIFEST_NOT_FOUND', 404);
    if (error instanceof SyntaxError) throw textbookError('TEXTBOOK_MANIFEST_JSON_INVALID', 400);
    throw error;
  }
}

async function validateManifestDraft({ sourceRoot, manifestRelativePath, expectedManifestHash }) {
  const contract = await getContract();
  const safeManifestPath = sanitizeRelativePath(manifestRelativePath);
  let manifestPath;
  try {
    manifestPath = contract.resolveAssetPath(sourceRoot, safeManifestPath);
  } catch (error) {
    const code = String(error.message || '').startsWith('TEXTBOOK_')
      ? error.message
      : 'TEXTBOOK_MANIFEST_PATH_REJECTED';
    throw textbookError(code, code === 'TEXTBOOK_MEDIA_NOT_FOUND' ? 404 : 400);
  }
  const manifest = safeReadJson(manifestPath);
  const validate = getValidator();
  if (!validate(manifest)) {
    throw textbookError('TEXTBOOK_MANIFEST_INVALID', 400, schemaErrors(validate));
  }
  const deterministicErrors = contract.runDeterministicChecks(manifest, { sourceRoot });
  if (deterministicErrors.length) {
    throw textbookError('TEXTBOOK_MANIFEST_INVALID', 400, deterministicErrors);
  }
  const actualManifestHash = contract.computeManifestFileHash(manifest);
  if (expectedManifestHash && actualManifestHash !== String(expectedManifestHash).trim().toLowerCase()) {
    throw textbookError('TEXTBOOK_MANIFEST_HASH_MISMATCH', 409);
  }
  return {
    manifest,
    manifestRelativePath: safeManifestPath,
    manifestHash: actualManifestHash,
    summary: contract.summarizeManifest(manifest),
  };
}

module.exports = {
  validateManifestDraft,
  sanitizeRelativePath,
};
