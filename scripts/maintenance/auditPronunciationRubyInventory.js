'use strict';

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const Database = require('better-sqlite3');

const { parseRuby, adjacentRubyGroups } = require('../../services/pronunciation/rubyParser');

function sha256(value) {
  return crypto.createHash('sha256').update(value).digest('hex');
}

function auditDatabase(dbPath) {
  const db = new Database(dbPath, { readonly: true, fileMustExist: true });
  try {
    const rows = db.prepare(`
      SELECT id, phrase, card_type, content_hash, markdown_content, llm_model, created_at
      FROM generations
      ORDER BY id ASC
    `).all();
    const withRuby = [];
    const distinctBases = new Set();
    const distinctAdjacentCombos = new Set();
    let rubyTags = 0;
    let adjacentGroupCount = 0;
    let adjacentTagCount = 0;
    for (const row of rows) {
      const tags = parseRuby(row.markdown_content);
      if (!tags.length) continue;
      const groups = adjacentRubyGroups(row.markdown_content);
      tags.forEach((tag) => distinctBases.add(tag.base));
      groups.forEach((group) => {
        adjacentGroupCount += 1;
        adjacentTagCount += group.length;
        distinctAdjacentCombos.add(group.map((tag) => `${tag.base}=${tag.reading}`).join('|'));
      });
      rubyTags += tags.length;
      withRuby.push({
        id: row.id,
        phrase: row.phrase,
        cardType: row.card_type,
        contentHash: row.content_hash,
        rubyCount: tags.length,
        adjacentGroupCount: groups.length,
        llmModel: row.llm_model,
        createdAt: row.created_at,
      });
    }
    const manifest = {
      schemaVersion: 'pronunciation-ruby-inventory/v1',
      readOnly: true,
      source: { dbPath: path.basename(dbPath) },
      counts: {
        generations: rows.length,
        generationsWithRuby: withRuby.length,
        rubyTags,
        distinctRubyBases: distinctBases.size,
        adjacentRubyGroups: adjacentGroupCount,
        adjacentRubyTags: adjacentTagCount,
        distinctAdjacentCombinations: distinctAdjacentCombos.size,
      },
      generations: withRuby,
      contentHash: sha256(JSON.stringify(withRuby)),
    };
    return manifest;
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
  const result = auditDatabase(args.db);
  const serialized = `${JSON.stringify(result, null, 2)}\n`;
  if (args.output) {
    fs.mkdirSync(path.dirname(path.resolve(args.output)), { recursive: true });
    fs.writeFileSync(args.output, serialized, 'utf8');
  } else {
    process.stdout.write(serialized);
  }
}

module.exports = { parseRuby, adjacentRubyGroups, auditDatabase };
