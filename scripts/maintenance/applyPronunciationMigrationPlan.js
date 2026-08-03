'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { createPronunciationService } = require('../../services/pronunciation/pronunciationService');
const { buildManifest } = require('./buildPronunciationMigrationManifest');

function sha256(value) {
  return crypto.createHash('sha256').update(String(value || '')).digest('hex');
}

function parseArgs(argv) {
  const args = { db: process.env.DB_PATH || './data/trilingual_records.db', manifest: null, output: null, apply: false };
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] === '--db') args.db = argv[++i];
    if (argv[i] === '--manifest') args.manifest = argv[++i];
    if (argv[i] === '--output') args.output = argv[++i];
    if (argv[i] === '--apply') args.apply = true;
  }
  return args;
}

function readManifest(filePath) {
  if (!filePath) throw new Error('--manifest is required');
  const manifest = JSON.parse(fs.readFileSync(path.resolve(filePath), 'utf8'));
  if (manifest.schemaVersion !== 'pronunciation-migration-manifest/v1' || !Array.isArray(manifest.entries)) {
    throw new Error('Unsupported pronunciation migration manifest');
  }
  return manifest;
}

async function applyManifest({ dbPath, manifest, apply = false }) {
  const fresh = await buildManifest(dbPath);
  if (fresh.manifestHash !== manifest.manifestHash) {
    const error = new Error('Migration manifest no longer matches the current generation snapshot');
    error.code = 'PRONUNCIATION_MANIFEST_STALE';
    error.details = { expected: manifest.manifestHash, actual: fresh.manifestHash };
    throw error;
  }
  if (!apply) {
    return {
      mode: 'dry-run',
      manifestHash: manifest.manifestHash,
      eligible: manifest.entries.length,
      wouldCreate: manifest.entries.length,
      writes: 0,
    };
  }
  const { DatabaseService } = require('../../services/storage/databaseService');
  const dbService = new DatabaseService(dbPath);
  try {
    const pronunciationService = createPronunciationService({ dbService });
    const results = [];
    for (const entry of manifest.entries) {
      const current = dbService.getGenerationById(entry.generationId);
      if (!current || current.content_hash !== entry.contentHash) {
        const error = new Error(`Generation ${entry.generationId} content hash changed`);
        error.code = 'PRONUNCIATION_SOURCE_HASH_MISMATCH';
        throw error;
      }
      const existing = dbService.getPronunciationDocument('generation', entry.generationId, entry.contentHash);
      if (existing && existing.documentHash !== entry.documentHash) {
        const error = new Error(`Generation ${entry.generationId} already has a different pronunciation projection`);
        error.code = 'PRONUNCIATION_EXISTING_PROJECTION_CONFLICT';
        throw error;
      }
      const result = await pronunciationService.ensureGeneration(entry.generationId);
      if (result.document.documentHash !== entry.documentHash) {
        const error = new Error(`Generation ${entry.generationId} projection hash differs from manifest`);
        error.code = 'PRONUNCIATION_PROJECTION_HASH_MISMATCH';
        throw error;
      }
      results.push({ generationId: entry.generationId, documentId: result.document.id, revision: result.document.revision, status: result.document.status });
    }
    return {
      mode: 'apply',
      manifestHash: manifest.manifestHash,
      eligible: manifest.entries.length,
      writes: results.length,
      results,
      resultHash: sha256(JSON.stringify(results)),
    };
  } finally {
    dbService.close();
  }
}

if (require.main === module) {
  const args = parseArgs(process.argv.slice(2));
  applyManifest({ dbPath: args.db, manifest: readManifest(args.manifest), apply: args.apply })
    .then((result) => {
      const serialized = `${JSON.stringify(result, null, 2)}\n`;
      if (args.output) {
        fs.mkdirSync(path.dirname(path.resolve(args.output)), { recursive: true });
        fs.writeFileSync(args.output, serialized, 'utf8');
      } else process.stdout.write(serialized);
    })
    .catch((error) => {
      process.stderr.write(`${error.stack || error}\n`);
      process.exitCode = 1;
    });
}

module.exports = { applyManifest, readManifest };
