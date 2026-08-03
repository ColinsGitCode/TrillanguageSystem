'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const Database = require('better-sqlite3');
const { classify } = require('./auditPronunciationMigrationEligibility');
const {
  ANALYZER_VERSION,
  PROJECTION_VERSION,
  buildTokens,
  stripMarkdownToJapaneseText,
  locateJapaneseSegments,
  japaneseMarkupForLegacyReader,
  documentHash,
} = require('../../services/pronunciation/pronunciationService');
const { createDictionaryReader } = require('../../services/pronunciation/pronunciationPorts');

function sha256(value) {
  return crypto.createHash('sha256').update(String(value || '')).digest('hex');
}

async function buildManifest(dbPath, { limit = null } = {}) {
  const db = new Database(dbPath, { readonly: true, fileMustExist: true });
  try {
    const rows = db.prepare(`
      SELECT id, phrase, card_type, folder_name, base_filename, content_hash,
             markdown_content, llm_model, created_at
      FROM generations ORDER BY id ASC
    `).all();
    const dictionaryReader = createDictionaryReader();
    const entries = [];
    for (const row of rows) {
      const eligibility = classify(row);
      if (eligibility.status !== 'eligible') continue;
      if (limit !== null && entries.length >= limit) break;
      const plainText = stripMarkdownToJapaneseText(row.markdown_content);
      const japaneseSegments = locateJapaneseSegments(row.markdown_content, plainText);
      const built = await buildTokens(plainText, {
        dictionaryReader,
        japaneseSegments,
        legacyMarkdown: japaneseMarkupForLegacyReader(row.markdown_content),
      });
      entries.push({
        generationId: row.id,
        contentHash: row.content_hash,
        markdownSha256: sha256(row.markdown_content),
        status: built.status,
        plainTextSha256: sha256(plainText),
        sourceTextLength: Array.from(plainText).length,
        tokenCount: built.tokens.length,
        unresolvedCount: built.tokens.filter((token) => token.status === 'unresolved').length,
        analyzerVersion: ANALYZER_VERSION,
        projectionVersion: PROJECTION_VERSION,
        documentHash: documentHash(plainText, built.tokens),
      });
    }
    return {
      schemaVersion: 'pronunciation-migration-manifest/v1',
      readOnly: true,
      source: { dbPath: path.basename(dbPath) },
      eligibilityRuleVersion: 'pronunciation-content-quality-v1',
      analyzerVersion: ANALYZER_VERSION,
      projectionVersion: PROJECTION_VERSION,
      counts: {
        eligible: entries.length,
        ready: entries.filter((entry) => entry.status === 'ready').length,
        partial: entries.filter((entry) => entry.status === 'partial').length,
        unresolvedTokens: entries.reduce((sum, entry) => sum + entry.unresolvedCount, 0),
      },
      entries,
      manifestHash: sha256(JSON.stringify(entries)),
    };
  } finally {
    db.close();
  }
}

function parseArgs(argv) {
  const args = { db: process.env.DB_PATH || './data/trilingual_records.db', output: null, limit: null };
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] === '--db') args.db = argv[++i];
    if (argv[i] === '--output') args.output = argv[++i];
    if (argv[i] === '--limit') args.limit = Number(argv[++i]);
  }
  return args;
}

if (require.main === module) {
  const args = parseArgs(process.argv.slice(2));
  buildManifest(args.db, { limit: Number.isSafeInteger(args.limit) && args.limit > 0 ? args.limit : null })
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

module.exports = { buildManifest };
