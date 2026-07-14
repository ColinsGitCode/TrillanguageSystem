#!/usr/bin/env node
'use strict';

const fs = require('node:fs');
const path = require('node:path');
const Database = require('better-sqlite3');
const { contentHash } = require('../../services/dataPreparation/rules');
const { LEARNING_P0_TABLES } = require('../../services/storage/db/migrationRunner');
const { buildAudit, parseArgs } = require('./auditLearningData');

const FORBIDDEN_LEARNING_TABLES = new Set([
  'study_items',
  'study_plans',
  'study_sessions',
  'review_events',
  'review_queue',
  'card_srs',
  'card_reviews',
  'user_preferences',
]);

function safeJson(value) {
  if (!value) return null;
  try {
    return JSON.parse(value);
  } catch {
    return { parseError: true, raw: value };
  }
}

function determineEligibility({ unresolvedReasons, quarantineReasons, wholeCardReason }) {
  if (unresolvedReasons.length) return { status: 'unresolved', reasons: unresolvedReasons };
  if (quarantineReasons.length) return { status: 'quarantined', reasons: quarantineReasons };
  if (wholeCardReason) return { status: 'whole-card-only', reasons: [wholeCardReason] };
  return { status: 'eligible', reasons: ['data-preparation-gates-passed'] };
}

function decisionIndex(decisions) {
  const content = new Map((decisions.content_anomalies || []).map((item) => [Number(item.generation_id), item]));
  const tests = new Map((decisions.test_candidates || []).map((item) => [Number(item.generation_id), item]));
  const duplicate = new Map();
  for (const group of decisions.duplicate_groups || []) {
    for (const member of group.members || []) duplicate.set(Number(member.generation_id), group);
  }
  return { content, tests, duplicate };
}

function canonicalHash(record) {
  return record.content_hash || contentHash(record.markdown_content || '');
}

function isForbiddenLearningTable(tableName, allowLearningP0Tables = false) {
  if (allowLearningP0Tables && LEARNING_P0_TABLES.includes(tableName)) return false;
  return FORBIDDEN_LEARNING_TABLES.has(tableName) || /^study_/u.test(tableName);
}

function assertDecisionState({ generations, tags, audit, decisions, tableNames, allowLearningP0Tables = false }) {
  const errors = [];
  const byId = new Map(generations.map((item) => [Number(item.id), item]));
  const tagsById = new Map();
  for (const tag of tags) {
    const values = tagsById.get(Number(tag.generation_id)) || [];
    values.push(tag);
    tagsById.set(Number(tag.generation_id), values);
  }

  for (const tableName of tableNames) {
    if (isForbiddenLearningTable(tableName, allowLearningP0Tables)) {
      errors.push(`forbidden pre-LA-D2 table exists: ${tableName}`);
    }
  }
  if (audit.database.integrity !== 'ok') errors.push(`integrity_check=${audit.database.integrity}`);
  if (audit.database.foreignKeyViolations !== 0) errors.push(`foreign_key_violations=${audit.database.foreignKeyViolations}`);
  if (audit.database.generations !== audit.database.fts) errors.push('generation/FTS count mismatch');
  if (audit.summary.contentDrift !== 0) errors.push(`content_drift=${audit.summary.contentDrift}`);
  if (audit.summary.dateMismatch !== 0) errors.push(`date_mismatch=${audit.summary.dateMismatch}`);
  if (audit.summary.missingMarkdown !== 0) errors.push(`missing_markdown=${audit.summary.missingMarkdown}`);
  if (audit.summary.audioReferencesExisting !== audit.summary.audioReferences) errors.push('missing referenced audio');

  for (const generation of generations) {
    const active = tagsById.get(Number(generation.id)) || [];
    for (const namespace of ['lang', 'src']) {
      const matches = active.filter((tag) => tag.namespace === namespace);
      if (matches.length !== 1) errors.push(`generation ${generation.id} has ${matches.length} active ${namespace} tags`);
    }
  }
  for (const decision of decisions.content_anomalies || []) {
    const record = byId.get(Number(decision.generation_id));
    if (!record) {
      errors.push(`content decision references missing generation ${decision.generation_id}`);
      continue;
    }
    const expected = decision.result_content_hash || decision.content_hash;
    if (canonicalHash(record) !== expected) errors.push(`stale content decision ${decision.generation_id}`);
  }
  for (const decision of decisions.test_candidates || []) {
    const record = byId.get(Number(decision.generation_id));
    if (!record || canonicalHash(record) !== decision.content_hash) errors.push(`stale test decision ${decision.generation_id}`);
    const confirmed = (tagsById.get(Number(decision.generation_id)) || []).some(
      (tag) => tag.namespace === 'qa' && tag.normalized_value === 'test-artifact'
    );
    if (decision.decision === 'confirm' && !confirmed) errors.push(`confirmed test tag missing for ${decision.generation_id}`);
  }
  for (const expectation of decisions.regression_expectations || []) {
    const record = byId.get(Number(expectation.generation_id));
    if (!record || canonicalHash(record) !== expectation.content_hash) errors.push(`stale regression expectation ${expectation.generation_id}`);
    if (expectation.expect === 'not-test-artifact') {
      const incorrectlyTagged = (tagsById.get(Number(expectation.generation_id)) || []).some(
        (tag) => tag.namespace === 'qa' && tag.normalized_value === 'test-artifact'
      );
      if (incorrectlyTagged) errors.push(`generation ${expectation.generation_id} is incorrectly tagged as a test artifact`);
    }
  }
  for (const group of decisions.duplicate_groups || []) {
    for (const member of group.members || []) {
      const id = Number(member.generation_id);
      const deleted = (group.delete_generation_ids || []).map(Number).includes(id);
      const record = byId.get(id);
      if (deleted && record) errors.push(`generation ${id} should have been deleted`);
      if (!deleted && (!record || canonicalHash(record) !== member.content_hash)) errors.push(`stale duplicate decision ${id}`);
    }
  }
  const currentDuplicateSets = audit.duplicateGroups.map((ids) => ids.map(Number).sort((a, b) => a - b).join(','));
  const reviewedDuplicateSets = new Set((decisions.duplicate_groups || []).map((group) =>
    (group.members || []).map((item) => Number(item.generation_id)).filter((id) => byId.has(id)).sort((a, b) => a - b).join(',')
  ));
  for (const duplicateSet of currentDuplicateSets) {
    if (!reviewedDuplicateSets.has(duplicateSet)) errors.push(`unreviewed duplicate group ${duplicateSet}`);
  }

  if (errors.length) throw new Error(`DP7 gate failed:\n- ${errors.join('\n- ')}`);
}

function buildEligibilityReport({
  dbPath,
  recordsPath,
  decisions,
  expectedManifest = null,
  allowLearningP0Tables = false,
}) {
  const audit = buildAudit({ dbPath, recordsPath });
  if (expectedManifest && audit.run.stateHash !== expectedManifest.run.stateHash) {
    throw new Error(`expected state ${expectedManifest.run.stateHash}, got ${audit.run.stateHash}`);
  }

  const db = new Database(dbPath, { readonly: true, fileMustExist: true });
  try {
    db.pragma('query_only = ON');
    const generations = db.prepare('SELECT * FROM generations ORDER BY id').all();
    const tags = db.prepare("SELECT * FROM card_tags WHERE status = 'active' ORDER BY generation_id, namespace, normalized_value").all();
    const audioCounts = db.prepare('SELECT generation_id, COUNT(*) AS count FROM audio_files GROUP BY generation_id').all();
    const tableNames = db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name").all().map((row) => row.name);
    assertDecisionState({ generations, tags, audit, decisions, tableNames, allowLearningP0Tables });

    const tagMap = new Map();
    for (const tag of tags) {
      const values = tagMap.get(Number(tag.generation_id)) || [];
      values.push({
        namespace: tag.namespace,
        value: tag.value,
        normalizedValue: tag.normalized_value,
        source: tag.source,
        ruleVersion: tag.rule_version,
        ruleKey: tag.rule_key,
        evidence: safeJson(tag.evidence_json),
      });
      tagMap.set(Number(tag.generation_id), values);
    }
    const audioMap = new Map(audioCounts.map((item) => [Number(item.generation_id), Number(item.count)]));
    const auditMap = new Map(audit.records.map((item) => [Number(item.generationId), item]));
    const decisionsById = decisionIndex(decisions);

    const cards = generations.map((generation) => {
      const id = Number(generation.id);
      const auditRecord = auditMap.get(id);
      const activeTags = tagMap.get(id) || [];
      const contentDecision = decisionsById.content.get(id) || null;
      const testDecision = decisionsById.tests.get(id) || null;
      const duplicateDecision = decisionsById.duplicate.get(id) || null;
      const unresolvedReasons = [];
      const quarantineReasons = [];
      if (!generation.content_hash) unresolvedReasons.push('missing-content-hash');
      if (!auditRecord.mdExists) unresolvedReasons.push('missing-canonical-markdown');
      if (auditRecord.contentDrift) unresolvedReasons.push('canonical-content-drift');
      if (auditRecord.audioMissing > 0) unresolvedReasons.push('missing-referenced-audio');
      if (auditRecord.structure.reviewRequired && !contentDecision) unresolvedReasons.push('unreviewed-structure-anomaly');
      if (activeTags.some((tag) => tag.namespace === 'qa' && tag.normalizedValue === 'test-artifact-candidate')) {
        unresolvedReasons.push('test-artifact-review-pending');
      }
      if (contentDecision?.decision === 'quarantine') quarantineReasons.push('content-quarantine');
      if (activeTags.some((tag) => tag.namespace === 'qa' && tag.normalizedValue === 'test-artifact')) {
        quarantineReasons.push('confirmed-test-artifact');
      }
      if ((duplicateDecision?.quarantine_alternates || []).map(Number).includes(id)) {
        quarantineReasons.push(`duplicate-of-${duplicateDecision.canonical_generation_id}`);
      }
      const wholeCardReason = contentDecision?.decision === 'keep-as-whole-card'
        ? 'structure-supports-whole-card-only'
        : null;
      const recommendation = determineEligibility({ unresolvedReasons, quarantineReasons, wholeCardReason });

      return {
        generationId: id,
        cardType: generation.card_type,
        phrase: generation.phrase,
        folderName: generation.folder_name,
        generationDate: generation.generation_date,
        contentHash: canonicalHash(generation),
        files: {
          markdown: auditRecord.mdExists,
          html: auditRecord.htmlExists,
          metadata: auditRecord.metaExists,
          contentDrift: auditRecord.contentDrift,
        },
        structure: auditRecord.structure,
        tags: activeTags,
        decisions: {
          content: contentDecision ? { decision: contentDecision.decision, reason: contentDecision.reason } : null,
          test: testDecision ? { decision: testDecision.decision, reason: testDecision.reason } : null,
          duplicate: duplicateDecision ? {
            decision: duplicateDecision.decision,
            canonicalGenerationId: duplicateDecision.canonical_generation_id || null,
            reason: duplicateDecision.reason,
          } : null,
        },
        audio: {
          references: auditRecord.audioReferences,
          existingReferences: auditRecord.audioExisting,
          missingReferences: auditRecord.audioMissing,
          registeredRows: audioMap.get(id) || 0,
          requiredForEligibility: false,
        },
        recommendation,
      };
    });

    const statusCounts = Object.fromEntries(['eligible', 'whole-card-only', 'quarantined', 'unresolved'].map((status) => [
      status,
      cards.filter((card) => card.recommendation.status === status).length,
    ]));
    if (statusCounts.unresolved !== 0) throw new Error(`${statusCounts.unresolved} cards remain unresolved`);

    return {
      run: {
        generatedAt: new Date().toISOString(),
        readOnly: true,
        stateHash: audit.run.stateHash,
        decisionsVersion: decisions.version,
        laD2Materialized: allowLearningP0Tables,
      },
      summary: {
        cards: cards.length,
        statusCounts,
        activeTags: tags.length,
        audioReferences: audit.summary.audioReferences,
        audioReferencesExisting: audit.summary.audioReferencesExisting,
        registeredAudio: audit.summary.registeredAudio,
        unreferencedPhysicalAudio: audit.summary.physicalAudioUnregistered,
        highlights: audit.database.highlights,
        highlightMarks: audit.database.highlightMarks,
        forbiddenLearningTables: tableNames.filter((name) => isForbiddenLearningTable(name, allowLearningP0Tables)),
      },
      cards,
    };
  } finally {
    db.close();
  }
}

function csvCell(value) {
  const text = value == null ? '' : String(value);
  return `"${text.replaceAll('"', '""')}"`;
}

function writeReport(report, outputDir) {
  fs.mkdirSync(outputDir, { recursive: true });
  fs.writeFileSync(path.join(outputDir, 'eligibility.json'), `${JSON.stringify(report, null, 2)}\n`);
  const rows = report.cards.map((card) => [
    card.generationId,
    card.cardType,
    card.phrase,
    card.folderName,
    card.contentHash,
    card.recommendation.status,
    card.recommendation.reasons.join('|'),
    card.tags.map((tag) => `${tag.namespace}:${tag.value}`).join('|'),
    `${card.audio.existingReferences}/${card.audio.references}`,
  ]);
  const csv = [
    ['generation_id', 'card_type', 'phrase', 'folder_name', 'content_hash', 'status', 'reasons', 'active_tags', 'audio'].map(csvCell).join(','),
    ...rows.map((row) => row.map(csvCell).join(',')),
  ].join('\n');
  fs.writeFileSync(path.join(outputDir, 'eligibility.csv'), `${csv}\n`);
  const summary = [
    '# Learning Assistance 2.0 data readiness',
    '',
    `- Generated: ${report.run.generatedAt}`,
    `- Read only: ${report.run.readOnly}`,
    `- State hash: \`${report.run.stateHash}\``,
    `- Cards: ${report.summary.cards}`,
    `- Eligible: ${report.summary.statusCounts.eligible}`,
    `- Whole-card only: ${report.summary.statusCounts['whole-card-only']}`,
    `- Quarantined: ${report.summary.statusCounts.quarantined}`,
    `- Unresolved: ${report.summary.statusCounts.unresolved}`,
    `- Audio references present: ${report.summary.audioReferencesExisting}/${report.summary.audioReferences}`,
    `- Registered / unreferenced physical audio: ${report.summary.registeredAudio} / ${report.summary.unreferencedPhysicalAudio}`,
    `- Highlights / marks: ${report.summary.highlights} / ${report.summary.highlightMarks}`,
    `- LA-D2 materialized: ${report.run.laD2Materialized}`,
    '',
    'This report is a recommendation view only. It does not create study items or define review scheduling.',
    '',
  ];
  fs.writeFileSync(path.join(outputDir, 'summary.md'), summary.join('\n'));
}

if (require.main === module) {
  const args = parseArgs(process.argv.slice(2));
  if (!args.decisions) throw new Error('--decisions is required');
  const decisions = JSON.parse(fs.readFileSync(path.resolve(String(args.decisions)), 'utf8'));
  const expectedManifest = args['expected-manifest']
    ? JSON.parse(fs.readFileSync(path.resolve(String(args['expected-manifest'])), 'utf8'))
    : null;
  const report = buildEligibilityReport({
    dbPath: path.resolve(String(args.db || process.env.DB_PATH || './data/trilingual_records.db')),
    recordsPath: path.resolve(String(args.records || process.env.RECORDS_PATH || './trilingual_records')),
    decisions,
    expectedManifest,
    allowLearningP0Tables: Boolean(args['allow-learning-p0']),
  });
  const outputDir = path.resolve(String(args.output || path.join('.tmp', 'data-preparation', 'eligibility')));
  writeReport(report, outputDir);
  console.log(JSON.stringify({ outputDir, run: report.run, summary: report.summary }, null, 2));
}

module.exports = {
  FORBIDDEN_LEARNING_TABLES,
  buildEligibilityReport,
  determineEligibility,
  isForbiddenLearningTable,
  writeReport,
};
