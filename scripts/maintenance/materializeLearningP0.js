#!/usr/bin/env node
'use strict';

const fs = require('node:fs');
const path = require('node:path');
const Database = require('better-sqlite3');
const { parseArgs } = require('./auditLearningData');
const { materializeLearningP0 } = require('../../services/learning/application/materializeStudyItems');

function main(argv = process.argv.slice(2)) {
  const args = parseArgs(argv);
  if (!args.eligibility) throw new Error('--eligibility is required');
  const eligibilityPath = path.resolve(String(args.eligibility));
  const dbPath = path.resolve(String(args.db || process.env.DB_PATH || './data/trilingual_records.db'));
  const report = JSON.parse(fs.readFileSync(eligibilityPath, 'utf8'));
  const apply = Boolean(args.apply);
  const db = new Database(dbPath, { readonly: !apply, fileMustExist: true });
  try {
    db.pragma('foreign_keys = ON');
    if (!apply) db.pragma('query_only = ON');
    const result = materializeLearningP0(db, { report, apply });
    const output = `${JSON.stringify(result, null, 2)}\n`;
    if (args.output) {
      const outputPath = path.resolve(String(args.output));
      fs.mkdirSync(path.dirname(outputPath), { recursive: true });
      fs.writeFileSync(outputPath, output);
    }
    process.stdout.write(output);
    return result;
  } finally {
    db.close();
  }
}

if (require.main === module) main();

module.exports = { main };
