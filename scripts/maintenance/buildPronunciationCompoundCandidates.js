'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const Database = require('better-sqlite3');
const { adjacentRubyGroups } = require('../../services/pronunciation/rubyParser');
const { classify } = require('./auditPronunciationMigrationEligibility');

function sha256(value) {
  return crypto.createHash('sha256').update(String(value || '')).digest('hex');
}

function candidateFromGroup(group) {
  return {
    surface: group.map((tag) => tag.base).join(''),
    reading: group.map((tag) => tag.reading).join(''),
    components: group.map((tag) => ({ surface: tag.base, reading: tag.reading })),
  };
}

function buildCandidates(dbPath) {
  const db = new Database(dbPath, { readonly: true, fileMustExist: true });
  try {
    const rows = db.prepare(`
      SELECT id, phrase, card_type, content_hash, markdown_content
      FROM generations ORDER BY id ASC
    `).all();
    const grouped = new Map();
    for (const row of rows) {
      for (const group of adjacentRubyGroups(row.markdown_content)) {
        const candidate = candidateFromGroup(group);
        const componentKey = candidate.components.map((item) => `${item.surface}=${item.reading}`).join('|');
        const key = `${candidate.surface}\u0000${candidate.reading}\u0000${componentKey}`;
        const existing = grouped.get(key) || {
          ...candidate,
          occurrenceCount: 0,
          eligibleOccurrenceCount: 0,
          generationIds: [],
          needsReviewGenerationIds: [],
          cardTypes: [],
          review: {
            classification: 'unreviewed',
            acceptedSource: null,
            estimatedMinutes: null,
            reviewer: null,
            reason: null,
          },
        };
        existing.occurrenceCount += 1;
        if (classify(row).status === 'eligible') existing.eligibleOccurrenceCount += 1;
        if (!existing.generationIds.includes(row.id)) existing.generationIds.push(row.id);
        if (classify(row).status !== 'eligible' && !existing.needsReviewGenerationIds.includes(row.id)) {
          existing.needsReviewGenerationIds.push(row.id);
        }
        if (!existing.cardTypes.includes(row.card_type)) existing.cardTypes.push(row.card_type);
        grouped.set(key, existing);
      }
    }
    const candidates = [...grouped.values()]
      .sort((a, b) => b.occurrenceCount - a.occurrenceCount || a.surface.localeCompare(b.surface));
    return {
      schemaVersion: 'pronunciation-compound-candidates/v1',
      readOnly: true,
      source: { dbPath: path.basename(dbPath) },
      counts: {
        distinctCandidates: candidates.length,
        occurrences: candidates.reduce((sum, item) => sum + item.occurrenceCount, 0),
        eligibleOccurrences: candidates.reduce((sum, item) => sum + item.eligibleOccurrenceCount, 0),
      },
      candidates,
      manifestHash: sha256(JSON.stringify(candidates)),
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
  const serialized = `${JSON.stringify(buildCandidates(args.db), null, 2)}\n`;
  if (args.output) {
    fs.mkdirSync(path.dirname(path.resolve(args.output)), { recursive: true });
    fs.writeFileSync(args.output, serialized, 'utf8');
  } else process.stdout.write(serialized);
}

module.exports = { buildCandidates, candidateFromGroup };
