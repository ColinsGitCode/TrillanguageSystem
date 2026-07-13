#!/usr/bin/env node
'use strict';

const fs = require('node:fs');
const path = require('node:path');
const Database = require('better-sqlite3');
const { contentHash, normalizeTagValue, resolveRecordPath } = require('../../services/dataPreparation/rules');
const cardTags = require('../../services/storage/db/cardTags');
const { ensureGenerationsFtsInfrastructure } = require('../../services/storage/db/ftsInfrastructure');
const { buildAudit, parseArgs } = require('./auditLearningData');

function canonicalHash(record) {
  return record?.content_hash || contentHash(record?.markdown_content || '');
}

function assertDecisionHash(record, expectedHash, label, alternateHash = null) {
  if (!record) throw new Error(`${label} references a missing generation`);
  const actual = canonicalHash(record);
  if (actual !== expectedHash && actual !== alternateHash) {
    throw new Error(`${label} is stale: expected ${expectedHash}, got ${actual}`);
  }
}

function buildDecisionPlan({ dbPath, recordsPath, decisions }) {
  const db = new Database(dbPath, { readonly: true, fileMustExist: true });
  try {
    const records = db.prepare('SELECT * FROM generations ORDER BY id').all();
    const byId = new Map(records.map((record) => [Number(record.id), record]));

    (decisions.content_anomalies || []).forEach((decision) => {
      assertDecisionHash(
        byId.get(Number(decision.generation_id)),
        decision.content_hash,
        `content decision ${decision.generation_id}`,
        decision.result_content_hash || null
      );
    });
    (decisions.test_candidates || []).forEach((decision) => {
      assertDecisionHash(byId.get(Number(decision.generation_id)), decision.content_hash, `test decision ${decision.generation_id}`);
    });
    (decisions.regression_expectations || []).forEach((decision) => {
      assertDecisionHash(byId.get(Number(decision.generation_id)), decision.content_hash, `regression expectation ${decision.generation_id}`);
    });

    const duplicateActions = [];
    (decisions.duplicate_groups || []).forEach((group) => {
      (group.members || []).forEach((member) => {
        const record = byId.get(Number(member.generation_id));
        if (!record && (group.delete_generation_ids || []).includes(Number(member.generation_id))) return;
        assertDecisionHash(record, member.content_hash, `duplicate decision ${member.generation_id}`);
      });
      duplicateActions.push({
        decision: group.decision,
        members: (group.members || []).map((item) => Number(item.generation_id)),
        canonicalGenerationId: group.canonical_generation_id || null,
        quarantineAlternates: group.quarantine_alternates || [],
        deleteGenerationIds: group.delete_generation_ids || [],
      });
    });

    const deletions = duplicateActions.flatMap((item) => item.deleteGenerationIds).map(Number);
    const deletionFiles = deletions.map((generationId) => {
      const record = byId.get(generationId);
      if (!record) return { generationId, action: 'already-deleted', existingFiles: [] };
      const paths = [record.md_file_path, record.html_file_path, record.meta_file_path]
        .map((filePath) => resolveRecordPath(filePath, recordsPath))
        .filter(Boolean);
      const existingFiles = paths.filter((filePath) => fs.existsSync(filePath));
      if (existingFiles.length) {
        throw new Error(`generation ${generationId} still has files and cannot be deleted by the no-file decision`);
      }
      return { generationId, action: 'delete', existingFiles };
    });

    return {
      testDecisions: decisions.test_candidates || [],
      duplicateActions,
      deletionFiles,
      wholeCard: (decisions.content_anomalies || []).filter((item) => item.decision === 'keep-as-whole-card').map((item) => item.generation_id),
      quarantined: (decisions.content_anomalies || []).filter((item) => item.decision === 'quarantine').map((item) => item.generation_id),
      topicLongTail: decisions.topic_long_tail,
    };
  } finally {
    db.close();
  }
}

function applyDecisionPlan({ dbPath, plan, decisions }) {
  const db = new Database(dbPath, { fileMustExist: true });
  try {
    db.pragma('foreign_keys = ON');
    cardTags.ensureSchema(db);
    ensureGenerationsFtsInfrastructure(db);
    let tagChanges = 0;
    let deleted = 0;
    const tx = db.transaction(() => {
      for (const decision of plan.testDecisions) {
        const generationId = Number(decision.generation_id);
        const candidate = db.prepare(`
          SELECT * FROM card_tags
          WHERE generation_id = ? AND namespace = 'qa' AND normalized_value = 'test-artifact-candidate'
        `).get(generationId);
        if (candidate) {
          tagChanges += Number(cardTags.setTag(db, {
            generationId,
            namespace: 'qa',
            value: candidate.value,
            normalizedValue: candidate.normalized_value,
            source: candidate.source,
            status: 'suppressed',
            ruleVersion: candidate.rule_version,
            ruleKey: candidate.rule_key,
            evidenceJson: candidate.evidence_json,
          }).changes || 0);
        }
        if (decision.decision === 'confirm') {
          tagChanges += Number(cardTags.setTag(db, {
            generationId,
            namespace: 'qa',
            value: 'test-artifact',
            normalizedValue: normalizeTagValue('test-artifact'),
            source: 'user',
            status: 'active',
            ruleVersion: null,
            ruleKey: 'qa.review.confirmed',
            evidenceJson: JSON.stringify({
              reason: decision.reason,
              reviewedAt: decisions.reviewed_at,
              reviewedBy: decisions.reviewed_by,
            }),
          }).changes || 0);
        }
      }

      plan.deletionFiles.filter((item) => item.action === 'delete').forEach((item) => {
        deleted += Number(db.prepare('DELETE FROM generations WHERE id = ?').run(item.generationId).changes || 0);
      });
    });
    tx.immediate();
    db.prepare("INSERT INTO generations_fts(generations_fts) VALUES ('integrity-check')").run();
    const activeQaConflict = db.prepare(`
      SELECT generation_id
      FROM card_tags
      WHERE namespace = 'qa' AND status = 'active'
        AND normalized_value IN ('test-artifact-candidate', 'test-artifact')
      GROUP BY generation_id
      HAVING COUNT(DISTINCT normalized_value) > 1
    `).all();
    if (activeQaConflict.length) throw new Error('candidate and confirmed QA tags are simultaneously active');
    return {
      tagChanges,
      deleted,
      tagRows: db.prepare('SELECT COUNT(*) AS count FROM card_tags').get().count,
      activeTestArtifacts: db.prepare("SELECT COUNT(*) AS count FROM card_tags WHERE namespace='qa' AND normalized_value='test-artifact' AND status='active'").get().count,
      activeTestCandidates: db.prepare("SELECT COUNT(*) AS count FROM card_tags WHERE namespace='qa' AND normalized_value='test-artifact-candidate' AND status='active'").get().count,
      integrity: db.pragma('integrity_check', { simple: true }),
      foreignKeys: db.pragma('foreign_key_check').length,
    };
  } finally {
    db.close();
  }
}

function run(options) {
  const expected = JSON.parse(fs.readFileSync(path.resolve(options.expectedManifest), 'utf8'));
  const decisions = JSON.parse(fs.readFileSync(path.resolve(options.decisions), 'utf8'));
  const current = buildAudit({ dbPath: options.dbPath, recordsPath: options.recordsPath });
  if (current.run.stateHash !== expected.run.stateHash) {
    throw new Error(`state hash mismatch: expected ${expected.run.stateHash}, got ${current.run.stateHash}`);
  }
  const plan = buildDecisionPlan({ ...options, decisions });
  const result = options.apply ? applyDecisionPlan({ dbPath: options.dbPath, plan, decisions }) : null;
  const report = {
    mode: options.apply ? 'apply' : 'dry-run',
    decisionVersion: decisions.version,
    summary: {
      testsConfirmed: plan.testDecisions.filter((item) => item.decision === 'confirm').length,
      testsRejected: plan.testDecisions.filter((item) => item.decision === 'reject').length,
      duplicateGroups: plan.duplicateActions.length,
      deletions: plan.deletionFiles.filter((item) => item.action === 'delete').length,
      alreadyDeleted: plan.deletionFiles.filter((item) => item.action === 'already-deleted').length,
      wholeCard: plan.wholeCard.length,
      quarantined: plan.quarantined.length,
    },
    plan,
    result,
  };
  if (options.output) fs.writeFileSync(path.resolve(options.output), `${JSON.stringify(report, null, 2)}\n`);
  return report;
}

if (require.main === module) {
  const args = parseArgs(process.argv.slice(2));
  const report = run({
    dbPath: path.resolve(String(args.db || process.env.DB_PATH || './data/trilingual_records.db')),
    recordsPath: path.resolve(String(args.records || process.env.RECORDS_PATH || './trilingual_records')),
    expectedManifest: args['expected-manifest'],
    decisions: args.decisions,
    output: args.output,
    apply: Boolean(args.apply),
  });
  console.log(JSON.stringify(report, null, 2));
}

module.exports = { applyDecisionPlan, assertDecisionHash, buildDecisionPlan, canonicalHash, run };
