'use strict';

// Keep the module-load singleton off disk — when the package is required,
// `module.exports = new DatabaseService()` runs immediately and would
// otherwise create ./data/trilingual_records.db. An in-memory connection
// costs nothing and isolates test environment from a real local DB.
process.env.DB_PATH = ':memory:';
process.env.LOG_SILENT = '1';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const { DatabaseService } = require('../../services/storage/databaseService');

function freshDb() {
  return new DatabaseService(':memory:');
}

function buildScenarioMarkdown(count = 20) {
  return [
    '# 场景测试',
    '## 1. 场景说明',
    '- fixture',
    '## 2. 常用表达',
    ...Array.from({ length: count }, (_value, index) => (
      `### ${String(index + 1).padStart(2, '0')}.\n- **中文**: fixture`
    )),
  ].join('\n');
}

// Minimal fixture matching insertGeneration's expected shape. Tests override
// the fields they care about; everything else is deterministic.
function buildGenerationFixture(overrides = {}) {
  const generation = {
    phrase: 'hello',
    phraseLanguage: 'en',
    cardType: 'trilingual',
    sourceMode: 'input',
    llmProvider: 'deepseek',
    llmModel: 'deepseek-v4-pro',
    folderName: '20260101',
    baseFilename: 'hello',
    mdFilePath: '/tmp/hello.md',
    htmlFilePath: '/tmp/hello.html',
    metaFilePath: '/tmp/hello.meta.json',
    markdownContent: '# hello\nfoo bar',
    enTranslation: 'hello',
    jaTranslation: 'こんにちは',
    zhTranslation: '你好',
    generationDate: '2026-01-01',
    requestId: `req_${Math.random().toString(36).slice(2)}`,
    ...overrides.generation,
  };
  const observability = {
    tokensInput: 100,
    tokensOutput: 200,
    tokensTotal: 300,
    tokensCached: 0,
    costInput: 0,
    costOutput: 0,
    costTotal: 0,
    costCurrency: 'USD',
    quotaUsed: 0,
    quotaLimit: 0,
    quotaRemaining: 0,
    quotaResetAt: null,
    quotaPercentage: 0,
    performanceTotalMs: 1000,
    performancePhases: null,
    qualityScore: 90,
    qualityChecks: null,
    qualityDimensions: null,
    qualityWarnings: null,
    promptFull: 'prompt text',
    promptParsed: null,
    llmOutput: 'output',
    llmFinishReason: 'stop',
    metadata: null,
    ...overrides.observability,
  };
  const audioFiles = overrides.audioFiles || [];
  return { generation, observability, audioFiles };
}

test.describe('databaseService — generations CRUD', () => {
  test.it('insertGeneration + getGenerationById round-trip', () => {
    const db = freshDb();
    try {
      const id = db.insertGeneration(buildGenerationFixture());
      assert.ok(id > 0);
      const got = db.getGenerationById(id);
      assert.ok(got);
      assert.equal(got.phrase, 'hello');
      assert.equal(got.en_translation, 'hello');
      assert.equal(got.observability.tokens_total, 300);
      assert.deepEqual(got.audioFiles, []);
    } finally { db.close(); }
  });

  test.it('getGenerationById returns null for an unknown id', () => {
    const db = freshDb();
    try {
      assert.equal(db.getGenerationById(99999), null);
    } finally { db.close(); }
  });

  test.it('insertGeneration persists audio_files when provided', () => {
    const db = freshDb();
    try {
      const id = db.insertGeneration(buildGenerationFixture({
        audioFiles: [
          { language: 'en', text: 'hello', filenameSuffix: '_en_1', filePath: '/tmp/hello_en_1.mp3', ttsProvider: 'kokoro', ttsModel: 'k', ttsVoice: 'af_bella', status: 'ready' },
          { language: 'ja', text: 'こんにちは', filenameSuffix: '_ja_1', filePath: '/tmp/hello_ja_1.wav', ttsProvider: 'voicevox', ttsModel: 'v', ttsVoice: 'speaker:2', status: 'ready' },
        ],
      }));
      const got = db.getGenerationById(id);
      assert.equal(got.audioFiles.length, 2);
      const langs = got.audioFiles.map((a) => a.language).sort();
      assert.deepEqual(langs, ['en', 'ja']);
      assert.deepEqual(
        got.audioFiles.map((a) => [a.language, a.tts_provider, a.tts_model, a.tts_voice]).sort(),
        [
          ['en', 'kokoro', 'k', 'af_bella'],
          ['ja', 'voicevox', 'v', 'speaker:2'],
        ]
      );
    } finally { db.close(); }
  });

  test.it('inserts content hash and admission tags in the generation transaction', () => {
    const db = freshDb();
    try {
      const fixture = buildGenerationFixture();
      fixture.cardTags = [
        {
          namespace: 'lang', value: 'en', normalizedValue: 'en',
          ruleVersion: 'tagrules-v1', ruleKey: 'lang.characters.latin', evidenceJson: '{}',
        },
        {
          namespace: 'src', value: 'input', normalizedValue: 'input',
          ruleVersion: 'tagrules-v1', ruleKey: 'src.source-mode.input', evidenceJson: '{}',
        },
      ];
      fixture.learningAdmission = {
        status: 'eligible',
        contentHash: 'a'.repeat(64),
        reasons: ['online-admission-passed'],
        decisionVersion: 'card-admission-v1',
        stateVersion: 'learning-admission-v1',
        disposition: 'create-items',
      };
      fixture.generation.contentHash = fixture.learningAdmission.contentHash;
      const id = db.insertGeneration(fixture);
      const generation = db.getGenerationById(id);
      assert.match(generation.content_hash, /^[a-f0-9]{64}$/);
      assert.deepEqual(db.listCardTags(id).map((tag) => `${tag.namespace}:${tag.value}`), ['lang:en', 'src:input']);
      const learningAdmission = db.db.prepare(
        'SELECT * FROM learning_source_admissions WHERE generation_id = ?'
      ).get(id);
      assert.equal(learningAdmission.status, 'eligible');
      assert.equal(learningAdmission.materialization_disposition, 'create-items');
      assert.equal(learningAdmission.identity_anchor_generation_id, id);
      assert.equal(learningAdmission.admission_source, 'online');
      assert.deepEqual(
        db.db.prepare('SELECT unit_key, unit_kind FROM study_items WHERE generation_id = ? ORDER BY unit_key').all(id),
        [
          { unit_key: 'en', unit_kind: 'trilingual_en' },
          { unit_key: 'ja', unit_kind: 'trilingual_ja' },
        ]
      );
      assert.equal(
        db.db.prepare("SELECT COUNT(*) AS count FROM kg_source_sync_jobs WHERE operation='active'").get().count,
        2
      );
      assert.throws(
        () => db.db.prepare('UPDATE generations SET content_hash = NULL WHERE id = ?').run(id),
        /content_hash must be a SHA-256 hash/
      );
    } finally { db.close(); }
  });

  test.it('rolls back the generation when an admission tag is invalid', () => {
    const db = freshDb();
    try {
      const fixture = buildGenerationFixture();
      fixture.cardTags = [{
        namespace: 'invalid', value: 'bad', normalizedValue: 'bad',
        ruleVersion: 'tagrules-v1', ruleKey: 'invalid', evidenceJson: '{}',
      }];
      assert.throws(() => db.insertGeneration(fixture), /CHECK constraint failed/);
      assert.equal(db.getTotalCount(), 0);
    } finally { db.close(); }
  });

  test.it('materializes all 20 scenario Study Items in the online generation transaction', () => {
    const db = freshDb();
    try {
      const fixture = buildGenerationFixture({
        generation: {
          cardType: 'scenario_phrase',
          markdownContent: buildScenarioMarkdown(),
        },
      });
      fixture.learningAdmission = {
        status: 'eligible',
        contentHash: 'b'.repeat(64),
        reasons: ['online-admission-passed'],
        decisionVersion: 'card-admission-v1',
        stateVersion: 'learning-admission-v1',
        disposition: 'create-items',
      };
      fixture.generation.contentHash = fixture.learningAdmission.contentHash;
      const id = db.insertGeneration(fixture);
      const items = db.db.prepare(`
        SELECT unit_key, unit_kind FROM study_items WHERE generation_id = ? ORDER BY unit_key
      `).all(id);
      assert.equal(items.length, 20);
      assert.deepEqual(items[0], { unit_key: 'scenario:01', unit_kind: 'scenario_bilingual' });
      assert.deepEqual(items.at(-1), { unit_key: 'scenario:20', unit_kind: 'scenario_bilingual' });
    } finally { db.close(); }
  });

  test.it('rolls back the generation when the learning admission hash is stale', () => {
    const db = freshDb();
    try {
      const fixture = buildGenerationFixture();
      fixture.learningAdmission = {
        status: 'eligible',
        contentHash: '0'.repeat(64),
        reasons: ['online-admission-passed'],
        decisionVersion: 'card-admission-v1',
        stateVersion: 'learning-admission-v1',
        disposition: 'create-items',
      };
      assert.throws(() => db.insertGeneration(fixture), /must match generation content hash/u);
      assert.equal(db.getTotalCount(), 0);
      assert.equal(db.db.prepare('SELECT COUNT(*) AS count FROM learning_source_admissions').get().count, 0);
      assert.equal(db.db.prepare('SELECT COUNT(*) AS count FROM study_items').get().count, 0);
    } finally { db.close(); }
  });

  test.it('deleteGeneration removes the row and cascades audio files', () => {
    const db = freshDb();
    try {
      const id = db.insertGeneration(buildGenerationFixture({
        audioFiles: [{ language: 'en', text: 'x', filenameSuffix: '_en_1', filePath: '/tmp/x.mp3', ttsProvider: 't', ttsModel: 't', status: 'ready' }],
      }));
      const changes = db.deleteGeneration(id);
      assert.equal(changes, 1);
      assert.equal(db.getGenerationById(id), null);
      // Cascade: audio_files row also gone.
      const remaining = db.db.prepare('SELECT COUNT(*) AS c FROM audio_files WHERE generation_id = ?').get(id);
      assert.equal(remaining.c, 0);
    } finally { db.close(); }
  });

  test.it('archives Study Items before deleting their current generation pointer', () => {
    const db = freshDb();
    try {
      const id = db.insertGeneration(buildGenerationFixture());
      const now = '2026-07-14T00:00:00.000Z';
      const itemId = Number(db.db.prepare(`
        INSERT INTO study_items(
          generation_id, source_generation_id, unit_key, unit_kind, unit_locator_json,
          content_hash, lifecycle, created_at_utc, updated_at_utc
        ) VALUES (?, ?, 'en', 'trilingual_en', '{}', ?, 'active', ?, ?)
      `).run(id, id, db.getGenerationById(id).content_hash, now, now).lastInsertRowid);
      db.db.prepare(`
        INSERT INTO card_annotations(
          id, target_kind, target_id, target_revision, projection_version,
          quote_exact, quote_prefix, quote_suffix, position_start, position_end,
          annotation_kind, color, status, source_content_hash, created_at_utc, updated_at_utc
        ) VALUES (
          '018f0f96-5a90-7d75-a2c6-86559b5de911', 'generation', ?, ?,
          'card-visible-text-v1', 'word', '', '', 0, 4,
          'highlight', 'red', 'active', ?, ?, ?
        )
      `).run(id, db.getGenerationById(id).content_hash, db.getGenerationById(id).content_hash, now, now);

      const result = db.deleteGenerationWithLearningState(id);
      assert.deepEqual(result, { deleted: 1, archivedStudyItems: 1, deletedAnnotations: 1 });
      assert.equal(db.getGenerationById(id), null);
      const item = db.db.prepare('SELECT * FROM study_items WHERE id = ?').get(itemId);
      assert.equal(item.generation_id, null);
      assert.equal(item.source_generation_id, id);
      assert.equal(item.lifecycle, 'archived');
      assert.equal(item.lifecycle_reason, 'source-deleted');
      assert.equal(
        db.db.prepare('SELECT status FROM card_annotations WHERE target_id = ?').get(id).status,
        'deleted'
      );
      assert.equal(
        db.db.prepare("SELECT COUNT(*) AS count FROM kg_source_sync_jobs WHERE operation='absent' AND source_ref_id=?").get(itemId).count,
        1
      );
    } finally { db.close(); }
  });

  test.it('getRecentGenerations returns inserted records', () => {
    const db = freshDb();
    try {
      const id1 = db.insertGeneration(buildGenerationFixture({ generation: { phrase: 'first' } }));
      const id2 = db.insertGeneration(buildGenerationFixture({ generation: { phrase: 'second' } }));
      const recent = db.getRecentGenerations(10);
      // SQLite CURRENT_TIMESTAMP has second precision, so two near-simultaneous
      // inserts may tie. Just assert both are present.
      const ids = recent.map((r) => r.id);
      assert.ok(ids.includes(id1));
      assert.ok(ids.includes(id2));
    } finally { db.close(); }
  });
});

test.describe('databaseService — query / search / count', () => {
  test.it('getTotalCount reflects inserts and respects provider filter', () => {
    const db = freshDb();
    try {
      assert.equal(db.getTotalCount({}), 0);
      db.insertGeneration(buildGenerationFixture({ generation: { llmProvider: 'deepseek', llmModel: 'deepseek-v4-pro' } }));
      db.insertGeneration(buildGenerationFixture({ generation: { llmProvider: 'local' } }));
      assert.equal(db.getTotalCount({}), 2);
      assert.equal(db.getTotalCount({ provider: 'deepseek' }), 1);
      assert.equal(db.getTotalCount({ provider: 'local' }), 1);
    } finally { db.close(); }
  });

  test.it('queryGenerations respects pagination limits', () => {
    const db = freshDb();
    try {
      for (let i = 0; i < 5; i += 1) {
        db.insertGeneration(buildGenerationFixture({ generation: { phrase: `phrase-${i}` } }));
      }
      const page1 = db.queryGenerations({ page: 1, limit: 2 });
      const page2 = db.queryGenerations({ page: 2, limit: 2 });
      assert.equal(page1.length, 2);
      assert.equal(page2.length, 2);
      const ids = new Set([...page1, ...page2].map((r) => r.id));
      assert.equal(ids.size, 4); // no overlap between pages
    } finally { db.close(); }
  });

  test.it('fullTextSearch finds a record by phrase', () => {
    const db = freshDb();
    try {
      db.insertGeneration(buildGenerationFixture({ generation: { phrase: 'persistent highlight' } }));
      db.insertGeneration(buildGenerationFixture({ generation: { phrase: 'unrelated card' } }));
      const hits = db.fullTextSearch('persistent', 10);
      assert.ok(hits.length >= 1);
      assert.ok(hits.some((h) => h.phrase === 'persistent highlight'));
    } finally { db.close(); }
  });

  test.it('keeps the external-content FTS index consistent across updates and deletes', () => {
    const db = freshDb();
    try {
      const id = db.insertGeneration(buildGenerationFixture({ generation: { phrase: 'before update' } }));
      db.db.prepare('UPDATE generations SET phrase = ? WHERE id = ?').run('after update', id);
      assert.equal(db.fullTextSearch('before', 10).length, 0);
      assert.ok(db.fullTextSearch('after', 10).some((row) => row.id === id));
      db.deleteGeneration(id);
      assert.equal(db.fullTextSearch('after', 10).length, 0);
      db.db.prepare("INSERT INTO generations_fts(generations_fts) VALUES ('integrity-check')").run();
    } finally { db.close(); }
  });
});

test.describe('databaseService — errors table', () => {
  test.it('insertError appends an error record', () => {
    const db = freshDb();
    try {
      const result = db.insertError({
        phrase: 'x',
        llmProvider: 'deepseek',
        requestId: 'req_err_1',
        errorType: 'timeout',
        errorMessage: 'boom',
        errorStack: null,
        prompt: 'prompt',
        llmResponse: null,
        validationErrors: null,
      });
      assert.ok(result.changes === 1);
      const row = db.db.prepare('SELECT * FROM generation_errors WHERE request_id = ?').get('req_err_1');
      assert.ok(row);
      assert.equal(row.error_type, 'timeout');
      assert.equal(row.error_message, 'boom');
    } finally { db.close(); }
  });
});

test.describe('databaseService — card tags', () => {
  test.it('persists active and suppressed tags without duplicating a value', () => {
    const db = freshDb();
    try {
      const generationId = db.insertGeneration(buildGenerationFixture());
      const payload = {
        generationId,
        namespace: 'tag',
        value: 'N2',
        normalizedValue: 'n2',
        source: 'user',
        status: 'active',
      };
      db.setCardTag(payload);
      assert.equal(db.listCardTags(generationId).length, 1);
      db.setCardTag({ ...payload, status: 'suppressed' });
      assert.equal(db.listCardTags(generationId).length, 0);
      assert.equal(db.listCardTags(generationId, { includeSuppressed: true }).length, 1);
    } finally { db.close(); }
  });
});

// -- generation_jobs ---------------------------------------------------------

function buildJobPayload(overrides = {}) {
  return {
    jobType: 'trilingual',
    phraseRaw: 'hello',
    phraseNormalized: 'hello',
    sourceMode: 'input',
    provider: 'deepseek',
    llmModel: 'deepseek-v4-pro',
    maxRetries: 2,
    sourceContext: {},
    requestPayload: { phrase: 'hello' },
    ...overrides,
  };
}

test.describe('databaseService — generation_jobs lifecycle', () => {
  test.it('configures a bounded SQLite busy timeout', () => {
    const db = freshDb();
    try {
      assert.equal(db.db.pragma('busy_timeout', { simple: true }), 5000);
    } finally { db.close(); }
  });

  test.it('fresh schema defaults generation_jobs.llm_provider to DeepSeek', () => {
    const db = freshDb();
    try {
      const columns = db.db.prepare('PRAGMA table_info(generation_jobs)').all();
      const providerColumn = columns.find((column) => column.name === 'llm_provider');
      assert.ok(providerColumn, 'llm_provider column expected');
      assert.equal(providerColumn.dflt_value, "'deepseek'");
    } finally { db.close(); }
  });

  test.it('createGenerationJob returns the full job row with status=queued, attempts=0', () => {
    const db = freshDb();
    try {
      const job = db.createGenerationJob(buildJobPayload());
      assert.ok(job);
      assert.equal(job.status, 'queued');
      assert.equal(job.attempts, 0);
      assert.equal(job.provider, 'deepseek');
      assert.equal(job.llmModel, 'deepseek-v4-pro');
      assert.equal(job.phraseNormalized, 'hello');
      assert.deepEqual(job.sourceContext, {});
    } finally { db.close(); }
  });

  test.it('createGenerationJob defaults missing provider metadata to DeepSeek', () => {
    const db = freshDb();
    try {
      const job = db.createGenerationJob(buildJobPayload({ provider: undefined, llmModel: undefined }));
      assert.ok(job);
      assert.equal(job.provider, 'deepseek');
      assert.equal(job.llmModel, '');
    } finally { db.close(); }
  });

  test.it('getGenerationJobById returns null for an unknown id', () => {
    const db = freshDb();
    try {
      assert.equal(db.getGenerationJobById(99999), null);
    } finally { db.close(); }
  });

  test.it('listGenerationJobs returns active jobs newest-first and hides cleared', () => {
    const db = freshDb();
    try {
      const j1 = db.createGenerationJob(buildJobPayload({ phraseNormalized: 'a' }));
      const j2 = db.createGenerationJob(buildJobPayload({ phraseNormalized: 'b' }));
      const j3 = db.createGenerationJob(buildJobPayload({ phraseNormalized: 'c' }));
      db.updateGenerationJob(j1.id, { status: 'success', clearedAt: new Date().toISOString() });
      const listed = db.listGenerationJobs(10);
      const ids = listed.map((j) => j.id);
      assert.ok(!ids.includes(j1.id), 'cleared job should be hidden');
      // Active jobs newest-first.
      assert.equal(ids[0], j3.id);
      assert.equal(ids[1], j2.id);
    } finally { db.close(); }
  });

  test.it('getGenerationJobSummary counts by status', () => {
    const db = freshDb();
    try {
      db.createGenerationJob(buildJobPayload({ phraseNormalized: 'a' }));
      const j2 = db.createGenerationJob(buildJobPayload({ phraseNormalized: 'b' }));
      db.updateGenerationJob(j2.id, { status: 'failed', errorMessage: 'boom' });
      const summary = db.getGenerationJobSummary();
      assert.equal(summary.total, 2);
      assert.equal(summary.queued, 1);
      assert.equal(summary.failed, 1);
    } finally { db.close(); }
  });

  test.it('hasActiveDuplicateGenerationJob matches phrase + type, ignores cleared', () => {
    const db = freshDb();
    try {
      db.createGenerationJob(buildJobPayload({ phraseNormalized: 'dup' }));
      assert.equal(db.hasActiveDuplicateGenerationJob('dup', 'trilingual'), true);
      assert.equal(db.hasActiveDuplicateGenerationJob('other', 'trilingual'), false);
      assert.equal(db.hasActiveDuplicateGenerationJob('dup', 'grammar_ja'), false);
    } finally { db.close(); }
  });

  test.it('updateGenerationJob patches the requested fields only', () => {
    const db = freshDb();
    try {
      const job = db.createGenerationJob(buildJobPayload());
      const updated = db.updateGenerationJob(job.id, { status: 'running', startedAt: '2026-05-15 10:00:00' });
      assert.equal(updated.status, 'running');
      // attempts wasn't touched by the patch.
      assert.equal(updated.attempts, 0);
    } finally { db.close(); }
  });

  test.it('takeNextQueuedGenerationJob FIFO-pulls and flips status to running with attempts+1', () => {
    const db = freshDb();
    try {
      const j1 = db.createGenerationJob(buildJobPayload({ phraseNormalized: 'first' }));
      db.createGenerationJob(buildJobPayload({ phraseNormalized: 'second' }));
      const taken = db.takeNextQueuedGenerationJob();
      assert.equal(taken.id, j1.id);
      assert.equal(taken.status, 'running');
      assert.equal(taken.attempts, 1);
    } finally { db.close(); }
  });

  test.it('retryGenerationJob only re-queues a failed job', () => {
    const db = freshDb();
    try {
      const job = db.createGenerationJob(buildJobPayload());
      // queued -> retry is a no-op (returns null)
      assert.equal(db.retryGenerationJob(job.id), null);
      // failed -> retry flips it back to queued
      db.updateGenerationJob(job.id, { status: 'failed' });
      const retried = db.retryGenerationJob(job.id);
      assert.ok(retried);
      assert.equal(retried.status, 'queued');
    } finally { db.close(); }
  });

  test.it('cancelGenerationJob only cancels a queued job', () => {
    const db = freshDb();
    try {
      const job = db.createGenerationJob(buildJobPayload());
      const cancelled = db.cancelGenerationJob(job.id);
      assert.equal(cancelled.status, 'cancelled');
      // Cancelling a running job is a no-op.
      const job2 = db.createGenerationJob(buildJobPayload({ phraseNormalized: 'b' }));
      db.updateGenerationJob(job2.id, { status: 'running' });
      assert.equal(db.cancelGenerationJob(job2.id), null);
    } finally { db.close(); }
  });

  test.it('clearCompletedGenerationJobs hides success + cancelled jobs', () => {
    const db = freshDb();
    try {
      const j1 = db.createGenerationJob(buildJobPayload({ phraseNormalized: 'a' }));
      const j2 = db.createGenerationJob(buildJobPayload({ phraseNormalized: 'b' }));
      const j3 = db.createGenerationJob(buildJobPayload({ phraseNormalized: 'c' }));
      db.updateGenerationJob(j1.id, { status: 'success' });
      db.cancelGenerationJob(j2.id);
      const cleared = db.clearCompletedGenerationJobs();
      assert.ok(cleared >= 2);
      const remaining = db.listGenerationJobs(20).map((j) => j.id);
      assert.deepEqual(remaining, [j3.id]);
    } finally { db.close(); }
  });

  test.it('appendGenerationJobEvent + listGenerationJobEvents round-trip in insertion order', () => {
    const db = freshDb();
    try {
      const job = db.createGenerationJob(buildJobPayload());
      db.appendGenerationJobEvent(job.id, 'queued', { note: 'a' });
      db.appendGenerationJobEvent(job.id, 'running', { note: 'b' });
      db.appendGenerationJobEvent(job.id, 'success', { note: 'c' });
      const events = db.listGenerationJobEvents({ jobId: job.id, limit: 10 });
      assert.equal(events.length, 3);
      assert.deepEqual(events.map((e) => e.eventType), ['queued', 'running', 'success']);
    } finally { db.close(); }
  });

  test.it('atomically claims a queued job across two SQLite connections', () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'generation-claim-'));
    const dbPath = path.join(tempDir, 'jobs.db');
    const first = new DatabaseService(dbPath);
    const second = new DatabaseService(dbPath);
    try {
      const queued = first.createGenerationJob(buildJobPayload({ phraseNormalized: 'atomic-claim' }));
      const claims = [
        first.takeNextQueuedGenerationJob(),
        second.takeNextQueuedGenerationJob(),
      ].filter(Boolean);

      assert.equal(claims.length, 1);
      assert.equal(claims[0].id, queued.id);
      assert.equal(claims[0].status, 'running');
      assert.equal(claims[0].attempts, 1);
    } finally {
      first.close();
      second.close();
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });

  test.it('requeues stale running jobs and records a restart recovery event', () => {
    const db = freshDb();
    try {
      const queued = db.createGenerationJob(buildJobPayload({ phraseNormalized: 'restart-recovery' }));
      const running = db.takeNextQueuedGenerationJob();
      assert.equal(running.id, queued.id);
      assert.equal(running.status, 'running');

      assert.equal(db.recoverStaleRunningGenerationJobs(), 1);
      const recovered = db.getGenerationJobById(queued.id);
      assert.equal(recovered.status, 'queued');
      assert.equal(recovered.startedAt, null);
      const events = db.listGenerationJobEvents({ jobId: queued.id, limit: 10 });
      assert.deepEqual(events.map((event) => event.eventType), ['recovered']);
      assert.equal(events[0].payload.reason, 'process_restart');
      assert.equal(events[0].payload.attempts, 1);
    } finally { db.close(); }
  });
});

// -- test reset --------------------------------------------------------------

test.describe('databaseService — truncateAllForTests', () => {
  test.it('wipes generations + dependent child rows', () => {
    const db = freshDb();
    try {
      const id = db.insertGeneration(buildGenerationFixture({
        audioFiles: [{
          language: 'en', text: 'hi', filenameSuffix: '_en_1', filePath: '/tmp/x.mp3',
          ttsProvider: 't', ttsModel: 't', status: 'ready'
        }]
      }));
      db.createGenerationJob(buildJobPayload());
      db.appendCardAnnotationMigrationEvent({
        migrationPlanHash: 'a'.repeat(64),
        legacyHighlightId: 1,
        legacyRunOrdinal: 1,
        annotationId: null,
        outcome: 'skipped',
        reasonCode: 'fixture',
        sourceFingerprint: 'b'.repeat(64),
        createdAtUtc: '2026-07-27T00:00:00.000Z',
      });
      assert.ok(id > 0);
      assert.ok(db.getGenerationById(id));

      db.truncateAllForTests();

      const count = (table) => db.db.prepare(`SELECT COUNT(*) AS count FROM ${table}`).get().count;
      for (const table of [
        'generations',
        'audio_files',
        'observability_metrics',
        'generation_jobs',
        'generation_job_events',
        'card_highlights',
        'card_annotations',
        'card_annotation_migration_events'
      ]) {
        assert.equal(count(table), 0, `expected ${table} to be empty after truncate`);
      }
    } finally { db.close(); }
  });

  test.it('resets AUTOINCREMENT so the next insert gets id=1', () => {
    const db = freshDb();
    try {
      const id1 = db.insertGeneration(buildGenerationFixture());
      assert.ok(id1 >= 1);
      db.truncateAllForTests();
      const id2 = db.insertGeneration(buildGenerationFixture());
      assert.equal(id2, 1);
    } finally { db.close(); }
  });
});
