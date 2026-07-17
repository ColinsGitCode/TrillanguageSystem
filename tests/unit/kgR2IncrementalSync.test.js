'use strict';

process.env.DB_PATH = ':memory:';
process.env.LOG_SILENT = '1';

const assert = require('node:assert/strict');
const test = require('node:test');
const databaseModule = require('../../services/storage/databaseService');
const { DatabaseService } = databaseModule;
const jobs = require('../../services/storage/db/kgSourceSyncJobs');
const { buildKnowledgeSyncPlan } = require('../../services/kg/application/buildKnowledgeSyncPlan');
const { processKnowledgeSyncJob } = require('../../services/kg/application/processKnowledgeSyncJob');
const { buildKnowledgePointIdentity, buildSurfaceIdentity } = require('../../services/kg/domain/knowledgeIdentity');
const { buildEvidence, EVIDENCE_RULE_VERSION } = require('../../services/kg/domain/knowledgeEvidence');
const { KgSourceSyncService } = require('../../services/kg/kgSourceSyncService');

const NOW = '2026-07-17T06:00:00.000Z';
const HASH_A = 'a'.repeat(64);
const HASH_B = 'b'.repeat(64);

function seedEligiblePair(db) {
  const generationId = Number(db.prepare(`
    INSERT INTO generations(
      phrase, phrase_language, card_type, source_mode, llm_provider, llm_model,
      folder_name, base_filename, md_file_path, html_file_path, meta_file_path,
      markdown_content, content_hash, generation_date, request_id, en_translation, ja_translation
    ) VALUES ('handoff', 'en', 'trilingual', 'input', 'deepseek', 'deepseek-v4-pro',
      '20260717', 'kg-r2', '/tmp/kg-r2.md', '/tmp/kg-r2.html', '/tmp/kg-r2.json',
      '# handoff', ?, '2026-07-17', 'kg-r2-fixture', 'handoff', '引き継ぐ')
  `).run(HASH_A).lastInsertRowid);
  db.prepare(`
    INSERT INTO learning_source_admissions(
      generation_id, status, content_hash, reasons_json, decision_version, state_version,
      materialization_disposition, identity_anchor_generation_id, admission_source,
      evaluated_at_utc, created_at_utc, updated_at_utc
    ) VALUES (?, 'eligible', ?, '[]', 'fixture-v1', 'fixture-v1',
      'create-items', ?, 'manual', ?, ?, ?)
  `).run(generationId, HASH_A, generationId, NOW, NOW, NOW);
  const insert = db.prepare(`
    INSERT INTO study_items(
      generation_id, source_generation_id, unit_key, unit_kind, unit_locator_json,
      content_hash, content_revision, lifecycle, created_at_utc, updated_at_utc
    ) VALUES (?, ?, ?, ?, '{}', ?, 1, 'active', ?, ?)
  `);
  const enId = Number(insert.run(generationId, generationId, 'en', 'trilingual_en', HASH_A, NOW, NOW).lastInsertRowid);
  const jaId = Number(insert.run(generationId, generationId, 'ja', 'trilingual_ja', HASH_A, NOW, NOW).lastInsertRowid);
  return { generationId, enId, jaId };
}

async function resolvedJapanese(text) {
  const pointIdentity = buildKnowledgePointIdentity({
    kpKind: 'lexeme', language: 'ja', canonicalForm: text, canonicalReading: 'ひきつぐ',
  });
  return {
    status: 'resolved',
    normalizedInput: text,
    canonicalForm: text,
    lemmaReading: 'ひきつぐ',
    surfaceReading: 'ひきつぐ',
    pointIdentity,
    surfaceIdentity: buildSurfaceIdentity({ language: 'ja', surfaceText: text, reading: 'ひきつぐ' }),
    relation: { linkKind: 'canonical', formKind: 'dictionary' },
    analyzer: { id: 'fixture', version: '1', ruleVersion: 'fixture-v1' },
    tokens: [],
    lemmaTokens: [],
  };
}

test.after(() => databaseModule.close());

test('KG-R2 Evidence v2 keeps EN and JA identities distinct for one bilingual Study Item', () => {
  const base = {
    sourceKind: 'study_item', sourceRefId: 12, sourceRevision: 1,
    sourceContentHash: HASH_A, locator: { unitKey: 'scenario:01' }, sourceText: 'same',
  };
  const en = buildEvidence({ ...base, language: 'en' });
  const ja = buildEvidence({ ...base, language: 'ja' });
  assert.equal(EVIDENCE_RULE_VERSION, 'kg-evidence-v2');
  assert.notEqual(en.evidenceKey, ja.evidenceKey);
});

test('KG-R2 outbox is idempotent, FIFO, retryable, and restart-recoverable', () => {
  const database = new DatabaseService(':memory:');
  try {
    const descriptor = {
      operation: 'active', sourceKind: 'study_item', sourceRefId: 7,
      sourceRevision: 1, sourceContentHash: HASH_A,
    };
    assert.equal(jobs.enqueueJob(database.db, descriptor, { now: NOW }).inserted, true);
    assert.equal(jobs.enqueueJob(database.db, descriptor, { now: NOW }).inserted, false);
    const claimed = jobs.claimNextJob(database.db, { now: NOW, nowMs: Date.parse(NOW) });
    assert.equal(claimed.id, 1);
    assert.equal(claimed.attempts, 1);
    const retried = jobs.failJob(database.db, claimed.id, new Error('temporary'), {
      retryAfterTs: Date.parse(NOW) + 1000,
      now: NOW,
    });
    assert.equal(retried.status, 'queued');
    assert.equal(jobs.claimNextJob(database.db, { nowMs: Date.parse(NOW) }), null);
    const reclaimed = jobs.claimNextJob(database.db, { nowMs: Date.parse(NOW) + 1000 });
    assert.equal(reclaimed.attempts, 2);
    database.db.prepare('UPDATE kg_source_sync_jobs SET started_at_utc = ? WHERE id = ?')
      .run('2026-07-17T05:00:00.000Z', reclaimed.id);
    assert.equal(jobs.recoverStaleRunningJobs(database.db, {
      now: NOW,
      nowMs: Date.parse(NOW),
      staleAfterMs: 60_000,
    }), 1);
    assert.equal(jobs.summary(database.db).queued, 1);
  } finally {
    database.close();
  }
});

test('KG-R2 worker drains a durable job without enabling the feature globally', async () => {
  const database = new DatabaseService(':memory:');
  try {
    database.enqueueKgSourceSyncJob({
      operation: 'active', sourceKind: 'study_item', sourceRefId: 9,
      sourceRevision: 1, sourceContentHash: HASH_A,
    });
    const worker = new KgSourceSyncService({
      dbService: database,
      enabled: true,
      pollIntervalMs: 60_000,
      processor: async (job) => ({ terminalStatus: 'succeeded', sourceRefId: job.sourceRefId }),
    });
    await worker.processQueue();
    assert.deepEqual(database.getKgSourceSyncSummary(), {
      queued: 0, running: 0, succeeded: 1, failed: 0, superseded: 0, total: 1,
    });
    assert.equal((await worker.shutdown()).drained, true);
  } finally {
    database.close();
  }
});

test('KG-R2 reconciles missing facts, supersedes changed evidence, and orphans deleted sources', async () => {
  const database = new DatabaseService(':memory:');
  try {
    const source = seedEligiblePair(database.db);
    const initial = buildKnowledgeSyncPlan({ db: database.db });
    assert.equal(initial.summary.activeJobs, 2);
    assert.equal(initial.summary.absentJobs, 0);

    for (const descriptor of initial.descriptors) {
      const result = await processKnowledgeSyncJob({
        db: database.db,
        job: descriptor,
        now: NOW,
        analyzeJapanese: resolvedJapanese,
      });
      assert.equal(result.terminalStatus, 'succeeded');
    }
    assert.equal(database.db.prepare("SELECT COUNT(*) AS count FROM kg_evidence WHERE lifecycle='active'").get().count, 2);
    assert.equal(buildKnowledgeSyncPlan({ db: database.db }).descriptors.length, 0);

    database.db.prepare(`
      UPDATE study_items SET content_hash = ?, content_revision = 2, updated_at_utc = ? WHERE id = ?
    `).run(HASH_B, NOW, source.enId);
    const changed = buildKnowledgeSyncPlan({ db: database.db });
    assert.equal(changed.descriptors.length, 1);
    assert.equal(changed.descriptors[0].sourceContentHash, HASH_B);
    const updated = await processKnowledgeSyncJob({ db: database.db, job: changed.descriptors[0], now: NOW });
    assert.equal(updated.detachedEvidence, 1);
    assert.deepEqual(
      database.db.prepare('SELECT lifecycle FROM kg_evidence WHERE source_ref_id = ? ORDER BY id').all(source.enId),
      [{ lifecycle: 'superseded' }, { lifecycle: 'active' }]
    );

    database.db.prepare(`
      UPDATE study_items SET lifecycle='archived', lifecycle_reason='fixture-delete', updated_at_utc=? WHERE id=?
    `).run(NOW, source.enId);
    const absent = buildKnowledgeSyncPlan({ db: database.db });
    assert.equal(absent.descriptors.length, 1);
    assert.equal(absent.descriptors[0].operation, 'absent');
    const removed = await processKnowledgeSyncJob({ db: database.db, job: absent.descriptors[0], now: NOW });
    assert.equal(removed.terminalStatus, 'superseded');
    assert.equal(database.db.prepare(`
      SELECT lifecycle FROM kg_evidence WHERE source_ref_id = ? ORDER BY id DESC LIMIT 1
    `).get(source.enId).lifecycle, 'orphaned');
    assert.equal(database.db.prepare("SELECT COUNT(*) AS count FROM kg_resolution_events WHERE action='evidence-detached'").get().count, 2);
    assert.equal(database.db.prepare('SELECT COUNT(*) AS count FROM learning_review_events').get().count, 0);
    assert.equal(database.db.prepare('SELECT COUNT(*) AS count FROM learning_schedule_states').get().count, 0);
  } finally {
    database.close();
  }
});
