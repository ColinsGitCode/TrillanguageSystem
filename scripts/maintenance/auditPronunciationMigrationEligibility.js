'use strict';

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const Database = require('better-sqlite3');

const TITLE_RE = /^#{1,6}\s+\S+/u;
const TOOL_RE = /(?:<tool|tool_call|function_call|google_web_search|search_redis_documents|X-Generation-Job-Worker)/iu;

function sha256(value) {
  return crypto.createHash('sha256').update(String(value || '')).digest('hex');
}

function classify(row) {
  const markdown = String(row.markdown_content || '');
  const reasons = [];
  const hasTitle = TITLE_RE.test(markdown.trimStart());
  if (!hasTitle) reasons.push('missing-title');
  if (TOOL_RE.test(markdown)) reasons.push('model-planning-or-tool-residue');
  if (/\b(?:test|fixture|artifact)\b/iu.test(`${row.folder_name} ${row.base_filename}`)) reasons.push('test-artifact-path');
  if (row.card_type === 'test-artifact') reasons.push('test-artifact-card-type');
  const status = reasons.includes('missing-title') || reasons.includes('model-planning-or-tool-residue')
    ? 'needs-review'
    : reasons.length ? 'excluded' : 'eligible';
  return {
    generationId: row.id,
    contentHash: row.content_hash,
    phrase: row.phrase,
    cardType: row.card_type,
    folderName: row.folder_name,
    baseFilename: row.base_filename,
    llmModel: row.llm_model,
    createdAt: row.created_at,
    status,
    reasons,
    markdownSha256: sha256(markdown),
    hasTitle,
    hasToolResidue: TOOL_RE.test(markdown),
  };
}

function auditDatabase(dbPath) {
  const db = new Database(dbPath, { readonly: true, fileMustExist: true });
  try {
    const rows = db.prepare(`
      SELECT id, phrase, card_type, folder_name, base_filename, content_hash,
             markdown_content, llm_model, created_at
      FROM generations ORDER BY id ASC
    `).all();
    const entries = rows.map(classify);
    return {
      schemaVersion: 'pronunciation-migration-eligibility/v1',
      readOnly: true,
      source: { dbPath: path.basename(dbPath) },
      ruleVersion: 'pronunciation-content-quality-v1',
      counts: entries.reduce((acc, entry) => {
        acc[entry.status] = (acc[entry.status] || 0) + 1;
        return acc;
      }, { eligible: 0, 'needs-review': 0, excluded: 0 }),
      structureCandidateCount: entries.filter((entry) => entry.reasons.includes('missing-title')).length,
      toolResidueCount: entries.filter((entry) => entry.reasons.includes('model-planning-or-tool-residue')).length,
      entries,
      manifestHash: sha256(JSON.stringify(entries)),
    };
  } finally {
    db.close();
  }
}

function parseArgs(argv) {
  const args = { db: process.env.DB_PATH || './data/trilingual_records.db', output: null };
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] === '--db') args.db = argv[++i];
    if (argv[i] === '--output') args.output = argv[++i];
  }
  return args;
}

if (require.main === module) {
  const args = parseArgs(process.argv.slice(2));
  const serialized = `${JSON.stringify(auditDatabase(args.db), null, 2)}\n`;
  if (args.output) {
    fs.mkdirSync(path.dirname(path.resolve(args.output)), { recursive: true });
    fs.writeFileSync(args.output, serialized, 'utf8');
  } else process.stdout.write(serialized);
}

module.exports = { classify, auditDatabase };
