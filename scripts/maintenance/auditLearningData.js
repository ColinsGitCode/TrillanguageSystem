#!/usr/bin/env node
'use strict';

const fs = require('node:fs');
const path = require('node:path');
const Database = require('better-sqlite3');
const {
  RULE_VERSION,
  analyzeMarkdown,
  contentHash,
  inferLanguage,
  inferSource,
  inferTestCandidate,
  normalizeTagValue,
  resolveRecordPath,
  sha256,
} = require('../../services/dataPreparation/rules');

function parseArgs(argv) {
  const result = {};
  for (const arg of argv) {
    if (!arg.startsWith('--')) continue;
    const [key, ...rest] = arg.slice(2).split('=');
    result[key] = rest.length ? rest.join('=') : true;
  }
  return result;
}

function walkFiles(root, output = []) {
  if (!fs.existsSync(root)) return output;
  for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
    const fullPath = path.join(root, entry.name);
    if (entry.isDirectory()) walkFiles(fullPath, output);
    else if (entry.isFile()) output.push(fullPath);
  }
  return output;
}

function readFileInfo(filePath) {
  if (!filePath || !fs.existsSync(filePath)) return { exists: false, hash: null, bytes: null };
  const data = fs.readFileSync(filePath);
  return { exists: true, hash: sha256(data), bytes: data.length };
}

function csvValue(value) {
  if (value == null) return '';
  const text = typeof value === 'string' ? value : JSON.stringify(value);
  return `"${text.replaceAll('"', '""')}"`;
}

function writeCsv(filePath, rows, columns) {
  const lines = [columns.map(csvValue).join(',')];
  rows.forEach((row) => lines.push(columns.map((column) => csvValue(row[column])).join(',')));
  fs.writeFileSync(filePath, `${lines.join('\n')}\n`);
}

function countBy(rows, selector) {
  const map = new Map();
  rows.forEach((row) => {
    const key = String(selector(row));
    map.set(key, (map.get(key) || 0) + 1);
  });
  return Object.fromEntries([...map.entries()].sort((a, b) => b[1] - a[1]));
}

function buildAudit({ dbPath, recordsPath }) {
  const db = new Database(dbPath, { readonly: true, fileMustExist: true });
  try {
    db.pragma('query_only = ON');
    const generations = db.prepare('SELECT * FROM generations ORDER BY id').all();
    const audioRows = db.prepare('SELECT * FROM audio_files ORDER BY id').all();
    const annotations = db.prepare(`
      SELECT * FROM card_annotations
      WHERE status = 'active'
      ORDER BY target_kind, target_id, position_start, id
    `).all();
    const schemaSql = db.prepare("SELECT sql FROM sqlite_master WHERE sql IS NOT NULL ORDER BY type, name").all()
      .map((row) => row.sql).join('\n');
    const physicalAudio = walkFiles(recordsPath).filter((filePath) => /\.(wav|mp3|m4a)$/i.test(filePath));
    const physicalAudioSet = new Set(physicalAudio.map((filePath) => path.resolve(filePath)));
    const registeredAudioSet = new Set(audioRows.map((row) => path.resolve(resolveRecordPath(row.file_path, recordsPath))));

    const records = generations.map((generation) => {
      const mdPath = resolveRecordPath(generation.md_file_path, recordsPath);
      const htmlPath = resolveRecordPath(generation.html_file_path, recordsPath);
      const metaPath = resolveRecordPath(generation.meta_file_path, recordsPath);
      const mdInfo = readFileInfo(mdPath);
      const htmlInfo = readFileInfo(htmlPath);
      const metaInfo = readFileInfo(metaPath);
      const fileMarkdown = mdInfo.exists ? fs.readFileSync(mdPath, 'utf8') : '';
      const structure = analyzeMarkdown(generation, mdInfo.exists ? fileMarkdown : generation.markdown_content);
      const language = inferLanguage(generation);
      const source = inferSource(generation);
      const testCandidate = inferTestCandidate(generation);
      const audioSources = mdInfo.exists
        ? [...fileMarkdown.matchAll(/<audio\b[^>]*\bsrc=["']([^"']+)["']/gi)].map((match) => match[1])
        : [];
      const resolvedAudio = audioSources.map((sourcePath) => path.resolve(path.dirname(mdPath), sourcePath));
      const existingAudio = resolvedAudio.filter((filePath) => physicalAudioSet.has(filePath));
      const folderDate = /^\d{8}$/.test(generation.folder_name || '')
        ? `${generation.folder_name.slice(0, 4)}-${generation.folder_name.slice(4, 6)}-${generation.folder_name.slice(6, 8)}`
        : null;

      return {
        generationId: generation.id,
        cardType: generation.card_type,
        phrase: generation.phrase,
        folderName: generation.folder_name,
        folderDate,
        generationDate: generation.generation_date,
        sourceMode: generation.source_mode,
        legacyPhraseLanguage: generation.phrase_language,
        inferredLanguage: language.value,
        inferredLanguageRule: language.ruleKey,
        inferredSource: source.value,
        inferredSourceRule: source.ruleKey,
        testCandidate: Boolean(testCandidate),
        testCandidateRule: testCandidate?.ruleKey || null,
        mdPath,
        mdExists: mdInfo.exists,
        mdFileHash: mdInfo.hash,
        mdDbHash: contentHash(generation.markdown_content),
        contentDrift: mdInfo.exists && contentHash(fileMarkdown) !== contentHash(generation.markdown_content),
        htmlExists: htmlInfo.exists,
        htmlHash: htmlInfo.hash,
        metaExists: metaInfo.exists,
        metaHash: metaInfo.hash,
        structure,
        audioReferences: audioSources.length,
        audioExisting: existingAudio.length,
        audioMissing: audioSources.length - existingAudio.length,
      };
    });

    const duplicateMap = new Map();
    generations.forEach((generation) => {
      const key = `${generation.card_type}\u0000${normalizeTagValue(generation.phrase)}`;
      const values = duplicateMap.get(key) || [];
      values.push(generation.id);
      duplicateMap.set(key, values);
    });
    const duplicateGroups = [...duplicateMap.values()].filter((ids) => ids.length > 1);
    const stateRows = generations.map((generation) => ({
      id: generation.id,
      requestId: generation.request_id,
      updatedAt: generation.updated_at,
      dbContentHash: contentHash(generation.markdown_content),
    }));
    const databaseFileInfo = readFileInfo(dbPath);

    return {
      run: {
        generatedAt: new Date().toISOString(),
        dbPath,
        recordsPath,
        ruleVersion: RULE_VERSION,
        databaseFileHash: databaseFileInfo.hash,
        stateHash: sha256(JSON.stringify({ schemaSql, stateRows })),
        readOnly: true,
      },
      database: {
        integrity: db.pragma('integrity_check', { simple: true }),
        foreignKeyViolations: db.pragma('foreign_key_check').length,
        generations: generations.length,
        fts: db.prepare('SELECT count(*) AS count FROM generations_fts').get().count,
        audioRows: audioRows.length,
        highlights: new Set(annotations
          .filter((row) => row.annotation_kind === 'highlight')
          .map((row) => `${row.target_kind}:${row.target_id}`)).size,
        highlightMarks: annotations.filter((row) => row.annotation_kind === 'highlight').length,
      },
      summary: {
        cardTypes: countBy(generations, (row) => row.card_type),
        sourceModes: countBy(generations, (row) => row.source_mode || '<NULL>'),
        inferredLanguages: countBy(records, (row) => row.inferredLanguage),
        inferredSources: countBy(records, (row) => row.inferredSource),
        contentDrift: records.filter((row) => row.contentDrift).length,
        dateMismatch: records.filter((row) => row.folderDate && row.folderDate !== row.generationDate).length,
        contentReview: records.filter((row) => row.structure.reviewRequired).length,
        missingMarkdown: records.filter((row) => !row.mdExists).length,
        duplicateGroups: duplicateGroups.length,
        duplicateRows: duplicateGroups.reduce((sum, ids) => sum + ids.length, 0),
        testCandidates: records.filter((row) => row.testCandidate).length,
        physicalAudio: physicalAudio.length,
        registeredAudio: audioRows.length,
        physicalAudioUnregistered: physicalAudio.filter((filePath) => !registeredAudioSet.has(path.resolve(filePath))).length,
        audioReferences: records.reduce((sum, row) => sum + row.audioReferences, 0),
        audioReferencesExisting: records.reduce((sum, row) => sum + row.audioExisting, 0),
        cardsAudioComplete: records.filter((row) => row.audioReferences > 0 && row.audioMissing === 0).length,
      },
      duplicateGroups,
      records,
    };
  } finally {
    db.close();
  }
}

function writeAudit(audit, outputDir) {
  fs.mkdirSync(outputDir, { recursive: true });
  fs.writeFileSync(path.join(outputDir, 'manifest.json'), `${JSON.stringify(audit, null, 2)}\n`);
  const commonColumns = [
    'generationId', 'cardType', 'phrase', 'folderName', 'folderDate', 'generationDate',
    'sourceMode', 'legacyPhraseLanguage', 'inferredLanguage', 'inferredSource',
  ];
  writeCsv(path.join(outputDir, 'records.csv'), audit.records, [
    ...commonColumns, 'mdExists', 'contentDrift', 'audioReferences', 'audioExisting', 'audioMissing',
  ]);
  writeCsv(path.join(outputDir, 'content-drift.csv'), audit.records.filter((row) => row.contentDrift), [
    ...commonColumns, 'mdFileHash', 'mdDbHash', 'mdPath',
  ]);
  writeCsv(path.join(outputDir, 'date-mismatch.csv'), audit.records.filter(
    (row) => row.folderDate && row.folderDate !== row.generationDate
  ), [...commonColumns]);
  writeCsv(path.join(outputDir, 'content-review.csv'), audit.records.filter(
    (row) => row.structure.reviewRequired
  ).map((row) => ({ ...row, structure: row.structure })), [...commonColumns, 'structure']);
  writeCsv(path.join(outputDir, 'test-artifact-candidates.csv'), audit.records.filter(
    (row) => row.testCandidate
  ), [...commonColumns, 'testCandidateRule']);
  writeCsv(path.join(outputDir, 'audio-reconciliation.csv'), audit.records.filter(
    (row) => row.audioReferences === 0 || row.audioMissing > 0
  ), [...commonColumns, 'audioReferences', 'audioExisting', 'audioMissing']);
  writeCsv(path.join(outputDir, 'duplicate-groups.csv'), audit.duplicateGroups.map((ids) => ({
    generationIds: ids,
  })), ['generationIds']);

  const summary = [
    '# Learning data audit',
    '',
    `- Generated: ${audit.run.generatedAt}`,
    `- Read only: ${audit.run.readOnly}`,
    `- State hash: \`${audit.run.stateHash}\``,
    `- Integrity: ${audit.database.integrity}`,
    `- Generations / FTS: ${audit.database.generations} / ${audit.database.fts}`,
    `- Content drift: ${audit.summary.contentDrift}`,
    `- Date mismatch: ${audit.summary.dateMismatch}`,
    `- Content review: ${audit.summary.contentReview}`,
    `- Duplicate groups / rows: ${audit.summary.duplicateGroups} / ${audit.summary.duplicateRows}`,
    `- Test candidates: ${audit.summary.testCandidates}`,
    `- Physical / registered audio: ${audit.summary.physicalAudio} / ${audit.summary.registeredAudio}`,
    `- Existing audio references: ${audit.summary.audioReferencesExisting}/${audit.summary.audioReferences}`,
    '',
  ];
  fs.writeFileSync(path.join(outputDir, 'summary.md'), summary.join('\n'));
}

if (require.main === module) {
  const args = parseArgs(process.argv.slice(2));
  const runId = String(args['run-id'] || new Date().toISOString().replace(/[:.]/g, '-'));
  const outputDir = path.resolve(String(args.output || path.join('.tmp', 'data-preparation', runId)));
  const audit = buildAudit({
    dbPath: path.resolve(String(args.db || process.env.DB_PATH || './data/trilingual_records.db')),
    recordsPath: path.resolve(String(args.records || process.env.RECORDS_PATH || './trilingual_records')),
  });
  writeAudit(audit, outputDir);
  console.log(JSON.stringify({ outputDir, stateHash: audit.run.stateHash, summary: audit.summary }, null, 2));
}

module.exports = { buildAudit, parseArgs, writeAudit };
