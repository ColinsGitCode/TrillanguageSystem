#!/usr/bin/env node
'use strict';

const fs = require('node:fs');
const path = require('node:path');
const Database = require('better-sqlite3');
const { buildAudioTasksFromMarkdown, renderHtmlFromMarkdown } = require('../../services/generation/htmlRenderer');
const { contentHash, normalizeMarkdown, resolveRecordPath } = require('../../services/dataPreparation/rules');
const { ensureGenerationsFtsInfrastructure } = require('../../services/storage/db/ftsInfrastructure');
const { buildAudit, parseArgs } = require('./auditLearningData');

function listAudioFiles(root) {
  const output = [];
  const visit = (dir) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const filePath = path.join(dir, entry.name);
      if (entry.isDirectory()) visit(filePath);
      else if (/\.(?:wav|mp3|m4a)$/iu.test(entry.name)) output.push(path.resolve(filePath));
    }
  };
  visit(root);
  return output.sort();
}

function extractAudioSources(markdown) {
  return [...String(markdown || '').matchAll(/<audio\b[^>]*\bsrc=["']([^"']+)["'][^>]*>/giu)]
    .map((match) => match[1]);
}

function parseAudioIdentity(baseFilename, filePath) {
  const extension = path.extname(filePath).slice(1).toLowerCase();
  const filename = path.basename(filePath, path.extname(filePath));
  if (!filename.startsWith(baseFilename)) return null;
  const suffix = filename.slice(baseFilename.length);
  const match = suffix.match(/^_(en|ja)_(\d+)$/u);
  if (!match) return null;
  return { suffix, language: match[1], format: extension };
}

function applyReferenceRepair(record, decision) {
  let markdown = normalizeMarkdown(record.markdown_content);
  for (const replacement of decision.replacements || []) {
    if (!markdown.includes(replacement.from)) {
      if (decision.result_content_hash && contentHash(markdown) === decision.result_content_hash) continue;
      throw new Error(`audio reference repair source missing for generation ${record.id}`);
    }
    markdown = markdown.split(replacement.from).join(replacement.to);
  }
  return markdown;
}

function buildCanonicalMap(decisions) {
  const map = new Map();
  for (const group of decisions.duplicate_groups || []) {
    if (group.decision !== 'canonical') continue;
    for (const member of group.members || []) map.set(Number(member.generation_id), Number(group.canonical_generation_id));
  }
  return map;
}

function buildPlan({ dbPath, recordsPath, decisions }) {
  const db = new Database(dbPath, { readonly: true, fileMustExist: true });
  try {
    const records = db.prepare('SELECT * FROM generations ORDER BY id').all();
    const byId = new Map(records.map((record) => [Number(record.id), record]));
    const repairs = (decisions.audio_reference_repairs || []).map((decision) => {
      const record = byId.get(Number(decision.generation_id));
      if (!record) throw new Error(`audio repair references missing generation ${decision.generation_id}`);
      const actualHash = record.content_hash || contentHash(record.markdown_content);
      if (actualHash !== decision.content_hash && actualHash !== decision.result_content_hash) {
        throw new Error(`stale audio reference repair for generation ${record.id}`);
      }
      const markdown = applyReferenceRepair(record, decision);
      const nextHash = contentHash(markdown);
      if (decision.result_content_hash && decision.result_content_hash !== nextHash) {
        throw new Error(`audio reference repair result hash mismatch for generation ${record.id}`);
      }
      return { generationId: record.id, markdown, previousHash: actualHash, nextHash, action: actualHash === nextHash ? 'already-applied' : 'repair' };
    });
    const repairMap = new Map(repairs.map((item) => [item.generationId, item.markdown]));
    const existingRows = db.prepare('SELECT * FROM audio_files ORDER BY id').all();
    const existingByKey = new Map(existingRows.map((row) => [`${row.generation_id}:${row.filename_suffix}`, row]));
    const existingByPath = new Map(existingRows.map((row) => [path.resolve(row.file_path), row]));
    const canonicalMap = buildCanonicalMap(decisions);
    const references = [];

    for (const record of records) {
      const markdown = repairMap.get(record.id) || record.markdown_content;
      const mdPath = resolveRecordPath(record.md_file_path, recordsPath);
      const taskMap = new Map(buildAudioTasksFromMarkdown(markdown).map((task) => [task.filename_suffix, task.text]));
      for (const source of extractAudioSources(markdown)) {
        const filePath = path.resolve(path.dirname(mdPath), source);
        const identity = parseAudioIdentity(record.base_filename, filePath);
        references.push({
          generationId: record.id,
          baseFilename: record.base_filename,
          source,
          filePath,
          identity,
          text: identity ? taskMap.get(identity.suffix) || null : null,
          exists: fs.existsSync(filePath),
        });
      }
    }

    const byPath = new Map();
    for (const reference of references) {
      const values = byPath.get(reference.filePath) || [];
      values.push(reference);
      byPath.set(reference.filePath, values);
    }
    const proposals = [];
    const unresolved = [];
    let alreadyRegistered = 0;
    for (const [filePath, refs] of [...byPath.entries()].sort(([a], [b]) => a.localeCompare(b))) {
      if (!refs[0].exists) {
        unresolved.push({ filePath, reason: 'missing-file', generationIds: refs.map((item) => item.generationId) });
        continue;
      }
      const existingPathRow = existingByPath.get(filePath);
      const ids = [...new Set(refs.map((item) => item.generationId))];
      const canonicalIds = [...new Set(ids.map((id) => canonicalMap.get(id)).filter(Boolean))];
      const ownerId = existingPathRow?.generation_id || (ids.length === 1 ? ids[0] : canonicalIds.length === 1 ? canonicalIds[0] : null);
      const ownerRef = refs.find((item) => item.generationId === ownerId) || refs[0];
      if (!ownerId || !ownerRef.identity) {
        unresolved.push({ filePath, reason: !ownerId ? 'ambiguous-owner' : 'invalid-suffix', generationIds: ids });
        continue;
      }
      const key = `${ownerId}:${ownerRef.identity.suffix}`;
      const existingKeyRow = existingByKey.get(key);
      if (existingKeyRow) {
        if (path.resolve(existingKeyRow.file_path) !== filePath) {
          unresolved.push({ filePath, reason: 'registry-path-conflict', generationIds: ids, existingPath: existingKeyRow.file_path });
        } else {
          alreadyRegistered += 1;
        }
        continue;
      }
      if (!ownerRef.text) {
        unresolved.push({ filePath, reason: 'spoken-text-unavailable', generationIds: ids });
        continue;
      }
      const stat = fs.statSync(filePath);
      proposals.push({
        generationId: ownerId,
        language: ownerRef.identity.language,
        text: ownerRef.text,
        filenameSuffix: ownerRef.identity.suffix,
        filePath,
        format: ownerRef.identity.format,
        fileSize: stat.size,
      });
    }

    const physicalAudio = listAudioFiles(recordsPath);
    const referencedPaths = new Set([...byPath.keys()]);
    return {
      repairs,
      proposals,
      unresolved,
      existingRows: existingRows.length,
      alreadyRegistered,
      referenceCount: references.length,
      uniqueReferencedPaths: referencedPaths.size,
      physicalAudio: physicalAudio.length,
      unreferencedPhysical: physicalAudio.filter((filePath) => !referencedPaths.has(filePath)),
    };
  } finally {
    db.close();
  }
}

function atomicWrite(filePath, content) {
  const tempPath = `${filePath}.data-prep-${process.pid}.tmp`;
  fs.writeFileSync(tempPath, content, 'utf8');
  fs.renameSync(tempPath, filePath);
}

async function applyPlan({ dbPath, recordsPath, plan }) {
  const originals = [];
  for (const repair of plan.repairs.filter((item) => item.action === 'repair')) {
    const db = new Database(dbPath, { readonly: true, fileMustExist: true });
    const record = db.prepare('SELECT * FROM generations WHERE id = ?').get(repair.generationId);
    db.close();
    const mdPath = resolveRecordPath(record.md_file_path, recordsPath);
    const htmlPath = resolveRecordPath(record.html_file_path, recordsPath);
    const html = await renderHtmlFromMarkdown(repair.markdown, {
      baseName: record.base_filename,
      audioTasks: buildAudioTasksFromMarkdown(repair.markdown),
      prepared: true,
    });
    originals.push({ mdPath, markdown: fs.readFileSync(mdPath, 'utf8'), htmlPath, html: fs.readFileSync(htmlPath, 'utf8') });
    atomicWrite(mdPath, repair.markdown);
    atomicWrite(htmlPath, html);
  }

  const db = new Database(dbPath, { fileMustExist: true });
  try {
    db.pragma('foreign_keys = ON');
    ensureGenerationsFtsInfrastructure(db);
    const duplicateKeys = db.prepare(`
      SELECT generation_id, filename_suffix, COUNT(*) AS count
      FROM audio_files GROUP BY generation_id, filename_suffix HAVING COUNT(*) > 1
    `).all();
    if (duplicateKeys.length) throw new Error('existing audio registry contains duplicate generation/suffix keys');
    const update = db.prepare(`UPDATE generations SET markdown_content=?, content_hash=?, updated_at=CURRENT_TIMESTAMP WHERE id=?`);
    const insert = db.prepare(`
      INSERT OR IGNORE INTO audio_files (
        generation_id, language, text, filename_suffix, file_path,
        tts_provider, tts_model, tts_voice, file_size, format, status
      ) VALUES (?, ?, ?, ?, ?, 'legacy-unknown', NULL, NULL, ?, ?, 'generated')
    `);
    let inserted = 0;
    const tx = db.transaction(() => {
      plan.repairs.filter((item) => item.action === 'repair').forEach((repair) => {
        update.run(repair.markdown, repair.nextHash, repair.generationId);
      });
      plan.proposals.forEach((proposal) => {
        inserted += Number(insert.run(
          proposal.generationId,
          proposal.language,
          proposal.text,
          proposal.filenameSuffix,
          proposal.filePath,
          proposal.fileSize,
          proposal.format
        ).changes || 0);
      });
      db.exec('CREATE UNIQUE INDEX IF NOT EXISTS idx_audio_generation_suffix ON audio_files(generation_id, filename_suffix)');
    });
    tx.immediate();
    db.prepare("INSERT INTO generations_fts(generations_fts) VALUES ('integrity-check')").run();
    return {
      inserted,
      registryRows: db.prepare('SELECT COUNT(*) AS count FROM audio_files').get().count,
      integrity: db.pragma('integrity_check', { simple: true }),
      foreignKeys: db.pragma('foreign_key_check').length,
    };
  } catch (error) {
    originals.forEach((item) => {
      atomicWrite(item.mdPath, item.markdown);
      atomicWrite(item.htmlPath, item.html);
    });
    throw error;
  } finally {
    db.close();
  }
}

async function run(options) {
  const expected = JSON.parse(fs.readFileSync(path.resolve(options.expectedManifest), 'utf8'));
  const decisions = JSON.parse(fs.readFileSync(path.resolve(options.decisions), 'utf8'));
  const current = buildAudit({ dbPath: options.dbPath, recordsPath: options.recordsPath });
  if (current.run.stateHash !== expected.run.stateHash) {
    throw new Error(`state hash mismatch: expected ${expected.run.stateHash}, got ${current.run.stateHash}`);
  }
  const plan = buildPlan({ ...options, decisions });
  const result = options.apply ? await applyPlan({ ...options, plan }) : null;
  const report = {
    mode: options.apply ? 'apply' : 'dry-run',
    summary: {
      referenceRepairs: plan.repairs.filter((item) => item.action === 'repair').length,
      referenceCount: plan.referenceCount,
      uniqueReferencedPaths: plan.uniqueReferencedPaths,
      existingRegistryRows: plan.existingRows,
      alreadyRegistered: plan.alreadyRegistered,
      proposedRegistryRows: plan.proposals.length,
      unresolved: plan.unresolved.length,
      physicalAudio: plan.physicalAudio,
      unreferencedPhysical: plan.unreferencedPhysical.length,
    },
    repairs: plan.repairs.map(({ markdown: _markdown, ...repair }) => repair),
    unresolved: plan.unresolved,
    unreferencedPhysical: plan.unreferencedPhysical,
    proposals: plan.proposals,
    result,
  };
  if (options.output) fs.writeFileSync(path.resolve(options.output), `${JSON.stringify(report, null, 2)}\n`);
  return report;
}

if (require.main === module) {
  const args = parseArgs(process.argv.slice(2));
  run({
    dbPath: path.resolve(String(args.db || process.env.DB_PATH || './data/trilingual_records.db')),
    recordsPath: path.resolve(String(args.records || process.env.RECORDS_PATH || './trilingual_records')),
    expectedManifest: args['expected-manifest'],
    decisions: args.decisions,
    output: args.output,
    apply: Boolean(args.apply),
  }).then((report) => console.log(JSON.stringify({ ...report, proposals: `[${report.proposals.length} proposals]` }, null, 2))).catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
}

module.exports = { applyReferenceRepair, buildPlan, extractAudioSources, parseAudioIdentity, run };
