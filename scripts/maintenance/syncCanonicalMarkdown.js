#!/usr/bin/env node
'use strict';

const fs = require('node:fs');
const path = require('node:path');
const Database = require('better-sqlite3');
const { parseTrilingualMarkdown } = require('../../services/generation/markdownParser');
const {
  contentHash,
  normalizeMarkdown,
  resolveRecordPath,
} = require('../../services/dataPreparation/rules');
const { buildAudit, parseArgs } = require('./auditLearningData');
const { ensureGenerationsFtsInfrastructure } = require('../../services/storage/db/ftsInfrastructure');

function loadExpectedManifest(manifestPath) {
  if (!manifestPath) throw new Error('--expected-manifest is required');
  const manifest = JSON.parse(fs.readFileSync(path.resolve(manifestPath), 'utf8'));
  if (!manifest?.run?.stateHash) throw new Error('expected manifest has no stateHash');
  return manifest;
}

function projectionFor(record, markdown) {
  if (record.card_type !== 'trilingual') {
    return {
      en_translation: record.en_translation,
      ja_translation: record.ja_translation,
      zh_translation: record.zh_translation,
    };
  }
  const parsed = parseTrilingualMarkdown(markdown);
  return {
    en_translation: parsed.sections.en.translation || null,
    ja_translation: parsed.sections.ja.translation || null,
    zh_translation: parsed.sections.zh.translation || null,
  };
}

function inspectSync({ dbPath, recordsPath }) {
  const db = new Database(dbPath, { readonly: true, fileMustExist: true });
  try {
    const columns = new Set(db.prepare('PRAGMA table_info(generations)').all().map((row) => row.name));
    const hasContentHash = columns.has('content_hash');
    return db.prepare('SELECT * FROM generations ORDER BY id').all().map((record) => {
      const mdPath = resolveRecordPath(record.md_file_path, recordsPath);
      if (!mdPath || !fs.existsSync(mdPath)) {
        return { generationId: record.id, mdPath, action: 'unresolved-missing-file' };
      }
      const markdown = normalizeMarkdown(fs.readFileSync(mdPath, 'utf8'));
      const nextHash = contentHash(markdown);
      const projection = projectionFor(record, markdown);
      const contentDrift = contentHash(record.markdown_content) !== nextHash;
      const projectionDrift = ['en_translation', 'ja_translation', 'zh_translation']
        .some((key) => (record[key] || null) !== (projection[key] || null));
      const hashDrift = !hasContentHash || record.content_hash !== nextHash;
      return {
        generationId: record.id,
        mdPath,
        action: contentDrift || projectionDrift || hashDrift ? 'update' : 'unchanged',
        contentDrift,
        projectionDrift,
        hashDrift,
        nextHash,
        markdown,
        projection,
      };
    });
  } finally {
    db.close();
  }
}

function applySync({ dbPath, plan }) {
  const db = new Database(dbPath);
  try {
    db.pragma('journal_mode = WAL');
    db.pragma('foreign_keys = ON');
    const columns = new Set(db.prepare('PRAGMA table_info(generations)').all().map((row) => row.name));
    if (!columns.has('content_hash')) db.exec('ALTER TABLE generations ADD COLUMN content_hash TEXT');
    const ftsMaintenance = ensureGenerationsFtsInfrastructure(db);

    const update = db.prepare(`
      UPDATE generations
      SET markdown_content = @markdown,
          content_hash = @contentHash,
          en_translation = @enTranslation,
          ja_translation = @jaTranslation,
          zh_translation = @zhTranslation,
          updated_at = CASE
            WHEN @touchUpdatedAt = 1 THEN CURRENT_TIMESTAMP
            ELSE updated_at
          END
      WHERE id = @generationId
    `);
    let updated = 0;
    for (let offset = 0; offset < plan.length; offset += 50) {
      const batch = plan.slice(offset, offset + 50).filter((item) => item.action === 'update');
      if (!batch.length) continue;
      const transaction = db.transaction(() => {
        batch.forEach((item) => {
          const result = update.run({
            generationId: item.generationId,
            markdown: item.markdown,
            contentHash: item.nextHash,
            enTranslation: item.projection.en_translation,
            jaTranslation: item.projection.ja_translation,
            zhTranslation: item.projection.zh_translation,
            touchUpdatedAt: item.contentDrift || item.projectionDrift ? 1 : 0,
          });
          updated += Number(result.changes || 0);
        });
      });
      transaction.immediate();
    }
    const integrity = db.pragma('integrity_check', { simple: true });
    const foreignKeys = db.pragma('foreign_key_check').length;
    const generations = db.prepare('SELECT count(*) AS count FROM generations').get().count;
    const ftsRows = db.prepare('SELECT count(*) AS count FROM generations_fts').get().count;
    return { updated, integrity, foreignKeys, generations, ftsRows, ftsMaintenance };
  } finally {
    db.close();
  }
}

function runSync(options) {
  const expected = loadExpectedManifest(options.expectedManifest);
  const currentAudit = buildAudit({ dbPath: options.dbPath, recordsPath: options.recordsPath });
  if (currentAudit.run.stateHash !== expected.run.stateHash) {
    throw new Error(`state hash mismatch: expected ${expected.run.stateHash}, got ${currentAudit.run.stateHash}`);
  }
  const plan = inspectSync(options);
  const summary = {
    total: plan.length,
    update: plan.filter((item) => item.action === 'update').length,
    unchanged: plan.filter((item) => item.action === 'unchanged').length,
    unresolved: plan.filter((item) => item.action.startsWith('unresolved')).length,
    contentDrift: plan.filter((item) => item.contentDrift).length,
    projectionDrift: plan.filter((item) => item.projectionDrift).length,
    hashDrift: plan.filter((item) => item.hashDrift).length,
  };
  const result = options.apply ? applySync({ dbPath: options.dbPath, plan }) : null;
  const report = {
    generatedAt: new Date().toISOString(),
    mode: options.apply ? 'apply' : 'dry-run',
    expectedStateHash: expected.run.stateHash,
    summary,
    result,
    unresolved: plan.filter((item) => item.action.startsWith('unresolved')),
  };
  if (options.output) {
    fs.mkdirSync(path.dirname(options.output), { recursive: true });
    fs.writeFileSync(options.output, `${JSON.stringify(report, null, 2)}\n`);
  }
  return report;
}

if (require.main === module) {
  const args = parseArgs(process.argv.slice(2));
  const report = runSync({
    dbPath: path.resolve(String(args.db || process.env.DB_PATH || './data/trilingual_records.db')),
    recordsPath: path.resolve(String(args.records || process.env.RECORDS_PATH || './trilingual_records')),
    expectedManifest: args['expected-manifest'],
    output: args.output ? path.resolve(String(args.output)) : null,
    apply: Boolean(args.apply),
  });
  console.log(JSON.stringify(report, null, 2));
}

module.exports = { applySync, inspectSync, loadExpectedManifest, projectionFor, runSync };
