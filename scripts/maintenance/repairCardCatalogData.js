#!/usr/bin/env node
'use strict';

const fs = require('node:fs');
const path = require('node:path');
const Database = require('better-sqlite3');
const { parseTrilingualMarkdown } = require('../../services/generation/markdownParser');
const { renderHtmlFromMarkdown, buildAudioTasksFromMarkdown } = require('../../services/generation/htmlRenderer');
const {
  contentHash,
  folderNameToGenerationDate,
  normalizeMarkdown,
  repairMarkdownStructure,
  resolveRecordPath,
} = require('../../services/dataPreparation/rules');
const { ensureGenerationsFtsInfrastructure } = require('../../services/storage/db/ftsInfrastructure');
const { buildAudit, parseArgs } = require('./auditLearningData');

function loadJson(filePath, label) {
  if (!filePath) throw new Error(`--${label} is required`);
  return JSON.parse(fs.readFileSync(path.resolve(filePath), 'utf8'));
}

function currentContentHash(record) {
  return record.content_hash || contentHash(record.markdown_content);
}

function buildPlan({ dbPath, recordsPath, decisions }) {
  const db = new Database(dbPath, { readonly: true, fileMustExist: true });
  try {
    const records = db.prepare('SELECT * FROM generations ORDER BY id').all();
    const byId = new Map(records.map((record) => [Number(record.id), record]));
    const dateUpdates = records.flatMap((record) => {
      const nextDate = folderNameToGenerationDate(record.folder_name);
      return nextDate && nextDate !== record.generation_date
        ? [{ generationId: record.id, from: record.generation_date, to: nextDate }]
        : [];
    });
    const contentDecisions = decisions.content_anomalies || [];
    const content = contentDecisions.map((decision) => {
      const record = byId.get(Number(decision.generation_id));
      if (!record) throw new Error(`decision references missing generation ${decision.generation_id}`);
      const actualHash = currentContentHash(record);
      const isApplied = decision.result_content_hash && actualHash === decision.result_content_hash;
      if (!isApplied && actualHash !== decision.content_hash) {
        throw new Error(`stale content decision for generation ${record.id}: expected ${decision.content_hash}, got ${actualHash}`);
      }
      if (decision.decision !== 'repair') {
        return { generationId: record.id, decision: decision.decision, action: 'disposition-only', contentHash: actualHash };
      }
      const mdPath = resolveRecordPath(record.md_file_path, recordsPath);
      if (!mdPath || !fs.existsSync(mdPath)) throw new Error(`repair source missing for generation ${record.id}`);
      const currentMarkdown = normalizeMarkdown(fs.readFileSync(mdPath, 'utf8'));
      const repaired = repairMarkdownStructure(record, currentMarkdown, decision.strategy);
      const nextHash = contentHash(repaired);
      if (decision.result_content_hash && decision.result_content_hash !== nextHash) {
        throw new Error(`repair result hash mismatch for generation ${record.id}`);
      }
      return {
        generationId: record.id,
        decision: decision.decision,
        strategy: decision.strategy,
        action: isApplied ? 'already-applied' : 'repair',
        mdPath,
        htmlPath: resolveRecordPath(record.html_file_path, recordsPath),
        baseFilename: record.base_filename,
        cardType: record.card_type,
        previousHash: actualHash,
        nextHash,
        markdown: repaired,
      };
    });
    return { dateUpdates, content };
  } finally {
    db.close();
  }
}

function projections(record, markdown) {
  if (record.card_type !== 'trilingual') return null;
  const parsed = parseTrilingualMarkdown(markdown);
  return {
    enTranslation: parsed.sections.en.translation || null,
    jaTranslation: parsed.sections.ja.translation || null,
    zhTranslation: parsed.sections.zh.translation || null,
  };
}

function atomicWrite(filePath, content) {
  const tempPath = `${filePath}.data-prep-${process.pid}.tmp`;
  fs.writeFileSync(tempPath, content, 'utf8');
  fs.renameSync(tempPath, filePath);
}

async function applyPlan({ dbPath, plan }) {
  const repairs = plan.content.filter((item) => item.action === 'repair');
  const originals = [];
  for (const item of repairs) {
    const audioTasks = buildAudioTasksFromMarkdown(item.markdown);
    const html = await renderHtmlFromMarkdown(item.markdown, {
      baseName: item.baseFilename,
      audioTasks,
      prepared: true,
    });
    originals.push({
      mdPath: item.mdPath,
      markdown: fs.readFileSync(item.mdPath, 'utf8'),
      htmlPath: item.htmlPath,
      html: item.htmlPath && fs.existsSync(item.htmlPath) ? fs.readFileSync(item.htmlPath, 'utf8') : null,
    });
    atomicWrite(item.mdPath, item.markdown);
    if (item.htmlPath) atomicWrite(item.htmlPath, html);
  }

  const db = new Database(dbPath);
  try {
    db.pragma('foreign_keys = ON');
    ensureGenerationsFtsInfrastructure(db);
    const updateDate = db.prepare('UPDATE generations SET generation_date = ? WHERE id = ?');
    const updateContent = db.prepare(`
      UPDATE generations
      SET markdown_content = @markdown,
          content_hash = @contentHash,
          en_translation = @enTranslation,
          ja_translation = @jaTranslation,
          zh_translation = @zhTranslation,
          updated_at = CURRENT_TIMESTAMP
      WHERE id = @generationId
    `);
    const tx = db.transaction(() => {
      plan.dateUpdates.forEach((item) => updateDate.run(item.to, item.generationId));
      repairs.forEach((item) => {
        const record = db.prepare('SELECT * FROM generations WHERE id = ?').get(item.generationId);
        const projected = projections(record, item.markdown) || {
          enTranslation: record.en_translation,
          jaTranslation: record.ja_translation,
          zhTranslation: record.zh_translation,
        };
        updateContent.run({
          generationId: item.generationId,
          markdown: item.markdown,
          contentHash: item.nextHash,
          enTranslation: projected.enTranslation || null,
          jaTranslation: projected.jaTranslation || null,
          zhTranslation: projected.zhTranslation || null,
        });
      });
    });
    tx.immediate();
    db.prepare("INSERT INTO generations_fts(generations_fts) VALUES ('integrity-check')").run();
    return {
      datesUpdated: plan.dateUpdates.length,
      contentRepaired: repairs.length,
      integrity: db.pragma('integrity_check', { simple: true }),
      foreignKeys: db.pragma('foreign_key_check').length,
    };
  } catch (error) {
    originals.forEach((item) => {
      atomicWrite(item.mdPath, item.markdown);
      if (item.htmlPath && item.html !== null) atomicWrite(item.htmlPath, item.html);
    });
    throw error;
  } finally {
    db.close();
  }
}

async function run(options) {
  const expected = loadJson(options.expectedManifest, 'expected-manifest');
  const decisions = loadJson(options.decisions, 'decisions');
  const current = buildAudit({ dbPath: options.dbPath, recordsPath: options.recordsPath });
  if (current.run.stateHash !== expected.run.stateHash) {
    throw new Error(`state hash mismatch: expected ${expected.run.stateHash}, got ${current.run.stateHash}`);
  }
  const plan = buildPlan({ ...options, decisions });
  const result = options.apply ? await applyPlan({ dbPath: options.dbPath, plan }) : null;
  const report = {
    generatedAt: new Date().toISOString(),
    mode: options.apply ? 'apply' : 'dry-run',
    expectedStateHash: expected.run.stateHash,
    summary: {
      dateUpdates: plan.dateUpdates.length,
      contentRepairs: plan.content.filter((item) => item.action === 'repair').length,
      wholeCard: plan.content.filter((item) => item.decision === 'keep-as-whole-card').length,
      quarantined: plan.content.filter((item) => item.decision === 'quarantine').length,
    },
    dateUpdates: plan.dateUpdates,
    content: plan.content.map(({ markdown: _markdown, ...item }) => item),
    result,
  };
  if (options.output) fs.writeFileSync(path.resolve(options.output), `${JSON.stringify(report, null, 2)}\n`);
  return report;
}

if (require.main === module) {
  const args = parseArgs(process.argv.slice(2));
  const options = {
    dbPath: path.resolve(String(args.db || process.env.DB_PATH || './data/trilingual_records.db')),
    recordsPath: path.resolve(String(args.records || process.env.RECORDS_PATH || './trilingual_records')),
    expectedManifest: args['expected-manifest'],
    decisions: args.decisions,
    output: args.output,
    apply: Boolean(args.apply),
  };
  run(options).then((report) => console.log(JSON.stringify(report, null, 2))).catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
}

module.exports = { applyPlan, buildPlan, run };
