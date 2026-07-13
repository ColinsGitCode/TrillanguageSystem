#!/usr/bin/env node
'use strict';

const fs = require('node:fs');
const path = require('node:path');
const Database = require('better-sqlite3');
const { RULE_VERSION } = require('../../services/dataPreparation/rules');
const {
  buildTagProposals,
  summarizeTagProposals,
} = require('../../services/dataPreparation/cardTagging');
const cardTags = require('../../services/storage/db/cardTags');
const { buildAudit, parseArgs } = require('./auditLearningData');

function run(options) {
  const db = new Database(options.dbPath, options.createSchema || options.apply
    ? { fileMustExist: true }
    : { readonly: true, fileMustExist: true });
  try {
    if (options.expectedManifest) {
      const expected = JSON.parse(fs.readFileSync(path.resolve(options.expectedManifest), 'utf8'));
      const current = buildAudit({ dbPath: options.dbPath, recordsPath: options.recordsPath });
      if (current.run.stateHash !== expected.run.stateHash) {
        throw new Error(`state hash mismatch: expected ${expected.run.stateHash}, got ${current.run.stateHash}`);
      }
    }
    if (options.createSchema) cardTags.ensureSchema(db);
    const records = db.prepare('SELECT * FROM generations ORDER BY id').all();
    const proposals = buildTagProposals(records);
    let inserted = 0;
    if (options.apply) {
      cardTags.ensureSchema(db);
      const tx = db.transaction(() => {
        proposals.forEach((proposal) => {
          inserted += Number(cardTags.insertRuleIfMissing(db, proposal).changes || 0);
        });
      });
      tx.immediate();
    }
    const report = {
      mode: options.createSchema ? 'create-schema' : options.apply ? 'apply' : 'dry-run',
      ruleVersion: RULE_VERSION,
      summary: summarizeTagProposals(proposals),
      existingRows: db.prepare("SELECT COUNT(*) AS count FROM card_tags").get().count,
      inserted,
      proposals,
    };
    if (options.output) fs.writeFileSync(path.resolve(options.output), `${JSON.stringify(report, null, 2)}\n`);
    return report;
  } finally {
    db.close();
  }
}

if (require.main === module) {
  const args = parseArgs(process.argv.slice(2));
  const report = run({
    dbPath: path.resolve(String(args.db || process.env.DB_PATH || './data/trilingual_records.db')),
    recordsPath: path.resolve(String(args.records || process.env.RECORDS_PATH || './trilingual_records')),
    expectedManifest: args['expected-manifest'],
    output: args.output,
    createSchema: Boolean(args['create-schema']),
    apply: Boolean(args.apply),
  });
  console.log(JSON.stringify({ ...report, proposals: `[${report.proposals.length} proposals]` }, null, 2));
}

module.exports = {
  buildProposals: buildTagProposals,
  run,
  summarize: summarizeTagProposals,
};
