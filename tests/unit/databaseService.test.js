'use strict';

// Keep the module-load singleton off disk — when the package is required,
// `module.exports = new DatabaseService()` runs immediately and would
// otherwise create ./data/trilingual_records.db. An in-memory connection
// costs nothing and isolates test environment from a real local DB.
process.env.DB_PATH = ':memory:';
process.env.LOG_SILENT = '1';

const test = require('node:test');
const assert = require('node:assert/strict');

const { DatabaseService } = require('../../services/databaseService');

function freshDb() {
  return new DatabaseService(':memory:');
}

// Minimal fixture matching insertGeneration's expected shape. Tests override
// the fields they care about; everything else is deterministic.
function buildGenerationFixture(overrides = {}) {
  const generation = {
    phrase: 'hello',
    phraseLanguage: 'en',
    cardType: 'trilingual',
    sourceMode: 'input',
    llmProvider: 'gemini',
    llmModel: 'gemini-test',
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
          { language: 'en', text: 'hello', filenameSuffix: '_en_1', filePath: '/tmp/hello_en_1.mp3', ttsProvider: 'kokoro', ttsModel: 'k', status: 'ready' },
          { language: 'ja', text: 'こんにちは', filenameSuffix: '_ja_1', filePath: '/tmp/hello_ja_1.wav', ttsProvider: 'voicevox', ttsModel: 'v', status: 'ready' },
        ],
      }));
      const got = db.getGenerationById(id);
      assert.equal(got.audioFiles.length, 2);
      const langs = got.audioFiles.map((a) => a.language).sort();
      assert.deepEqual(langs, ['en', 'ja']);
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
      db.insertGeneration(buildGenerationFixture());
      db.insertGeneration(buildGenerationFixture({ generation: { llmProvider: 'local' } }));
      assert.equal(db.getTotalCount({}), 2);
      assert.equal(db.getTotalCount({ provider: 'gemini' }), 1);
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
});

test.describe('databaseService — errors table', () => {
  test.it('insertError appends an error record', () => {
    const db = freshDb();
    try {
      const result = db.insertError({
        phrase: 'x',
        llmProvider: 'gemini',
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

test.describe('databaseService — card highlights CRUD', () => {
  test.it('upsertCardHighlight inserts then updates a row keyed on (folder, base, sourceHash)', () => {
    const db = freshDb();
    try {
      const first = db.upsertCardHighlight({
        folderName: '20260101', baseFilename: 'hello', sourceHash: 'h1',
        htmlContent: '<mark class="study-highlight-red">word</mark> extra',
      });
      assert.equal(first.markCount, 1);
      const second = db.upsertCardHighlight({
        folderName: '20260101', baseFilename: 'hello', sourceHash: 'h1',
        htmlContent: '<mark class="study-highlight-red">word</mark> <mark class="study-highlight-red">two</mark>',
      });
      assert.equal(second.markCount, 2);
      assert.ok(second.highlightedChars >= second.markCount);
    } finally { db.close(); }
  });

  test.it('getCardHighlightByFile returns the saved row, or null if absent', () => {
    const db = freshDb();
    try {
      assert.equal(db.getCardHighlightByFile('20260101', 'absent', 'h0'), null);
      db.upsertCardHighlight({
        folderName: '20260101', baseFilename: 'hello', sourceHash: 'h2',
        htmlContent: '<mark class="study-highlight-red">hi</mark>',
      });
      const got = db.getCardHighlightByFile('20260101', 'hello', 'h2');
      assert.ok(got);
      assert.equal(got.folderName, '20260101');
      assert.equal(got.baseFilename, 'hello');
    } finally { db.close(); }
  });

  test.it('deleteCardHighlightByFile removes one or all versions', () => {
    const db = freshDb();
    try {
      db.upsertCardHighlight({ folderName: 'f', baseFilename: 'b', sourceHash: 'a', htmlContent: '<mark class="study-highlight-red">x</mark>' });
      db.upsertCardHighlight({ folderName: 'f', baseFilename: 'b', sourceHash: 'b', htmlContent: '<mark class="study-highlight-red">y</mark>' });
      const dropOne = db.deleteCardHighlightByFile('f', 'b', 'a');
      assert.equal(dropOne, 1);
      const dropRest = db.deleteCardHighlightByFile('f', 'b');
      assert.equal(dropRest, 1);
    } finally { db.close(); }
  });
});

test.describe('databaseService — card training assets', () => {
  test.it('upsertCardTrainingAsset + getCardTrainingAssetByGenerationId round-trip', () => {
    const db = freshDb();
    try {
      const id = db.insertGeneration(buildGenerationFixture());
      const saved = db.upsertCardTrainingAsset({
        generationId: id,
        folderName: '20260101',
        baseFilename: 'hello',
        cardType: 'trilingual',
        status: 'ready',
        source: 'llm',
        providerUsed: 'gemini',
        modelUsed: 'gemini-test',
        promptVersion: 'v1',
        schemaVersion: 'training_pack_v1',
        qualityScore: 80,
        selfConfidence: 0.9,
        coverageScore: 0.8,
        validationErrors: [],
        fallbackReason: null,
        tokensInput: 100, tokensOutput: 200, tokensTotal: 300,
        costTotal: 0,
        latencyMs: 500,
        payload: { hello: 'world' },
        sidecarFilePath: '/tmp/hello.training.v1.json',
      });
      assert.ok(saved);
      const got = db.getCardTrainingAssetByGenerationId(id);
      assert.ok(got);
      assert.equal(got.status, 'ready');
      assert.equal(got.qualityScore, 80);
      // The payload JSON should round-trip through the mapper.
      assert.deepEqual(got.payload, { hello: 'world' });
    } finally { db.close(); }
  });

  test.it('getCardTrainingAssetByGenerationId returns null when absent', () => {
    const db = freshDb();
    try {
      assert.equal(db.getCardTrainingAssetByGenerationId(99999), null);
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
    provider: 'gemini',
    llmModel: 'gemini-test',
    maxRetries: 2,
    sourceContext: {},
    requestPayload: { phrase: 'hello' },
    ...overrides,
  };
}

test.describe('databaseService — generation_jobs lifecycle', () => {
  test.it('createGenerationJob returns the full job row with status=queued, attempts=0', () => {
    const db = freshDb();
    try {
      const job = db.createGenerationJob(buildJobPayload());
      assert.ok(job);
      assert.equal(job.status, 'queued');
      assert.equal(job.attempts, 0);
      assert.equal(job.phraseNormalized, 'hello');
      assert.deepEqual(job.sourceContext, {});
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
});

// -- knowledge_jobs lifecycle -----------------------------------------------

test.describe('databaseService — knowledge_jobs lifecycle', () => {
  test.it('createKnowledgeJob returns a queued job with the supplied scope', () => {
    const db = freshDb();
    try {
      const job = db.createKnowledgeJob({
        jobType: 'index',
        scope: { folders: ['20260101'] },
        batchSize: 25,
        engineVersion: 'local-v1',
        triggeredBy: 'test',
      });
      assert.ok(job);
      assert.equal(job.status, 'queued');
      assert.equal(job.jobType, 'index');
      assert.deepEqual(job.scope, { folders: ['20260101'] });
      assert.equal(job.batchSize, 25);
    } finally { db.close(); }
  });

  test.it('getKnowledgeJobById returns null for an unknown id', () => {
    const db = freshDb();
    try {
      assert.equal(db.getKnowledgeJobById(99999), null);
    } finally { db.close(); }
  });

  test.it('updateKnowledgeJobStatus patches only the supplied fields', () => {
    const db = freshDb();
    try {
      const job = db.createKnowledgeJob({ jobType: 'index', scope: {} });
      const updated = db.updateKnowledgeJobStatus(job.id, {
        status: 'running',
        totalBatches: 5,
        doneBatches: 1,
      });
      assert.equal(updated.status, 'running');
      assert.equal(updated.totalBatches, 5);
      assert.equal(updated.doneBatches, 1);
      // errorBatches not patched.
      assert.equal(updated.errorBatches, 0);
    } finally { db.close(); }
  });

  test.it('listKnowledgeJobs returns newest first', () => {
    const db = freshDb();
    try {
      const j1 = db.createKnowledgeJob({ jobType: 'index', scope: {} });
      const j2 = db.createKnowledgeJob({ jobType: 'cluster', scope: {} });
      const j3 = db.createKnowledgeJob({ jobType: 'summary', scope: {} });
      const ids = db.listKnowledgeJobs(10).map((j) => j.id);
      assert.deepEqual(ids.slice(0, 3), [j3.id, j2.id, j1.id]);
    } finally { db.close(); }
  });

  test.it('cancelKnowledgeJob only cancels queued/running jobs', () => {
    const db = freshDb();
    try {
      const job = db.createKnowledgeJob({ jobType: 'index', scope: {} });
      assert.equal(db.cancelKnowledgeJob(job.id), true);
      // Cancelling again (now status='cancelled') should be a no-op.
      assert.equal(db.cancelKnowledgeJob(job.id), false);
    } finally { db.close(); }
  });

  test.it('upsertKnowledgeSynonymJobMeta + getKnowledgeSynonymJobMeta round-trip', () => {
    const db = freshDb();
    try {
      const job = db.createKnowledgeJob({ jobType: 'synonym_boundary', scope: {} });
      db.upsertKnowledgeSynonymJobMeta(job.id, {
        model: 'gemini-test',
        promptVersion: 'v1',
        schemaVersion: 'v1',
        llmEnabled: true,
        candidateCount: 100,
        successCount: 80,
        failedCount: 20,
        jsonParseRate: 0.95,
        avgLatencyMs: 1500,
        p95LatencyMs: 3000,
        options: { foo: 'bar' },
      });
      const meta = db.getKnowledgeSynonymJobMeta(job.id);
      assert.ok(meta);
      assert.equal(meta.model, 'gemini-test');
      assert.equal(meta.llmEnabled, true);
      assert.equal(meta.candidateCount, 100);
      assert.deepEqual(meta.options, { foo: 'bar' });
    } finally { db.close(); }
  });

  test.it('synonym_boundary jobs surface synonymMeta on getKnowledgeJobById', () => {
    const db = freshDb();
    try {
      const job = db.createKnowledgeJob({ jobType: 'synonym_boundary', scope: {} });
      db.upsertKnowledgeSynonymJobMeta(job.id, { model: 'm', llmEnabled: false });
      const got = db.getKnowledgeJobById(job.id);
      assert.ok(got.synonymMeta);
      assert.equal(got.synonymMeta.model, 'm');
      // Non-synonym jobs should NOT have synonymMeta attached.
      const other = db.createKnowledgeJob({ jobType: 'index', scope: {} });
      const otherRow = db.getKnowledgeJobById(other.id);
      assert.equal(otherRow.synonymMeta, null);
    } finally { db.close(); }
  });
});

// -- experiments / few-shot --------------------------------------------------

test.describe('databaseService — experiments + few-shot', () => {
  test.it('getFewShotRuns + getFewShotExamples return [] for unknown experiment', () => {
    const db = freshDb();
    try {
      assert.deepEqual(db.getFewShotRuns('exp_missing'), []);
      assert.deepEqual(db.getFewShotExamples([]), []);
    } finally { db.close(); }
  });

  test.it('upsertExperimentRound inserts then updates on conflict (experiment_id, round_number)', () => {
    const db = freshDb();
    try {
      db.upsertExperimentRound({
        experimentId: 'exp_a',
        roundNumber: 1,
        roundName: 'first',
        variant: 'A',
        llmModel: 'gemini-test',
        fewshotEnabled: true,
        fewshotCount: 3,
      });
      // Re-upsert the same (experimentId, roundNumber) with a different name.
      db.upsertExperimentRound({
        experimentId: 'exp_a',
        roundNumber: 1,
        roundName: 'first-updated',
        variant: 'A',
        llmModel: 'gemini-test',
        fewshotEnabled: true,
        fewshotCount: 5,
      });
      const trend = db.getExperimentRoundTrend('exp_a');
      assert.equal(trend.length, 1);
      assert.equal(trend[0].roundName, 'first-updated');
      assert.equal(trend[0].fewshotCount, 5);
    } finally { db.close(); }
  });

  test.it('insertExperimentSample returns an id and getExperimentSamples roundtrips qualityDimensions JSON', () => {
    const db = freshDb();
    try {
      db.upsertExperimentRound({ experimentId: 'exp_b', roundNumber: 0, roundName: 'baseline' });
      const id = db.insertExperimentSample({
        experimentId: 'exp_b',
        roundNumber: 0,
        phrase: 'hello',
        provider: 'gemini',
        variant: 'A',
        qualityScore: 88,
        qualityDimensions: { authenticity: 5, length: 4 },
        tokensTotal: 1500,
        latencyMs: 800,
      });
      assert.ok(id > 0);
      const samples = db.getExperimentSamples('exp_b');
      assert.equal(samples.length, 1);
      assert.deepEqual(samples[0].qualityDimensions, { authenticity: 5, length: 4 });
      assert.equal(samples[0].success, 1);
    } finally { db.close(); }
  });

  test.it('upsertTeacherReference deduplicates on (experiment_id, round_number, phrase)', () => {
    const db = freshDb();
    try {
      db.upsertExperimentRound({ experimentId: 'exp_c', roundNumber: 0 });
      db.upsertTeacherReference({
        experimentId: 'exp_c', roundNumber: 0, phrase: 'hello',
        provider: 'gemini', qualityScore: 90, outputText: 'first',
      });
      db.upsertTeacherReference({
        experimentId: 'exp_c', roundNumber: 0, phrase: 'hello',
        provider: 'gemini', qualityScore: 95, outputText: 'second',
      });
      const refs = db.getTeacherReferences('exp_c');
      assert.equal(refs.length, 1);
      assert.equal(refs[0].qualityScore, 95);
      assert.equal(refs[0].outputText, 'second');
    } finally { db.close(); }
  });

  test.it('recomputeExperimentRoundStats rolls up sample averages onto the round row', () => {
    const db = freshDb();
    try {
      db.upsertExperimentRound({ experimentId: 'exp_d', roundNumber: 0 });
      db.insertExperimentSample({ experimentId: 'exp_d', roundNumber: 0, phrase: 'a', qualityScore: 80, tokensTotal: 1000, latencyMs: 500 });
      db.insertExperimentSample({ experimentId: 'exp_d', roundNumber: 0, phrase: 'b', qualityScore: 90, tokensTotal: 2000, latencyMs: 700 });
      db.recomputeExperimentRoundStats('exp_d', 0);
      const trend = db.getExperimentRoundTrend('exp_d');
      assert.equal(trend.length, 1);
      assert.equal(trend[0].sampleCount, 2);
      assert.equal(trend[0].avgQualityScore, 85);
      assert.equal(trend[0].avgTokensTotal, 1500);
    } finally { db.close(); }
  });

  test.it('getExperimentSamples / getTeacherReferences return [] for empty experiment id', () => {
    const db = freshDb();
    try {
      assert.deepEqual(db.getExperimentSamples(''), []);
      assert.deepEqual(db.getTeacherReferences(''), []);
      assert.deepEqual(db.getExperimentRoundTrend(''), []);
    } finally { db.close(); }
  });

  test.it('teacher samples (isTeacher=1) are excluded from round average', () => {
    const db = freshDb();
    try {
      db.upsertExperimentRound({ experimentId: 'exp_e', roundNumber: 0 });
      // Teacher-flagged sample should not contribute to avg_quality_score.
      db.insertExperimentSample({ experimentId: 'exp_e', roundNumber: 0, phrase: 't', qualityScore: 100, isTeacher: true });
      db.insertExperimentSample({ experimentId: 'exp_e', roundNumber: 0, phrase: 'a', qualityScore: 80 });
      db.recomputeExperimentRoundStats('exp_e', 0);
      const [round] = db.getExperimentRoundTrend('exp_e');
      assert.equal(round.sampleCount, 1);
      assert.equal(round.avgQualityScore, 80);
    } finally { db.close(); }
  });
});

// -- knowledge_issues --------------------------------------------------------

test.describe('databaseService — knowledge_issues', () => {
  function freshJobId(db, jobType = 'issues_audit') {
    return db.createKnowledgeJob({ jobType }).id;
  }

  test.it('replaceKnowledgeIssues inserts and returns the count', () => {
    const db = freshDb();
    try {
      const jobId = freshJobId(db);
      const count = db.replaceKnowledgeIssues([
        { issueType: 'duplicate_phrase', severity: 'high', fingerprint: 'fp1', phrase: 'hello', detail: { dup: 2 } },
        { issueType: 'audio_missing', severity: 'low', fingerprint: 'fp2', phrase: 'world' }
      ], jobId);
      assert.equal(count, 2);
      const rows = db.getKnowledgeIssues();
      assert.equal(rows.length, 2);
      assert.equal(rows[0].lastJobId, jobId);
      const dup = rows.find((r) => r.fingerprint === 'fp1');
      assert.deepEqual(dup.detail, { dup: 2 });
      assert.equal(dup.resolved, false);
    } finally { db.close(); }
  });

  test.it('replaceKnowledgeIssues with a jobId clears that jobs prior rows first', () => {
    const db = freshDb();
    try {
      const jobId = freshJobId(db);
      db.replaceKnowledgeIssues([
        { issueType: 'format_anomaly', severity: 'medium', fingerprint: 'old1' }
      ], jobId);
      assert.equal(db.getKnowledgeIssues().length, 1);
      // Re-run for the same job with a different fingerprint — the old row
      // must be cleared.
      db.replaceKnowledgeIssues([
        { issueType: 'format_anomaly', severity: 'medium', fingerprint: 'new1' }
      ], jobId);
      const rows = db.getKnowledgeIssues();
      assert.equal(rows.length, 1);
      assert.equal(rows[0].fingerprint, 'new1');
    } finally { db.close(); }
  });

  test.it('replaceKnowledgeIssues UPSERTs on (issue_type, fingerprint) and resets resolved=0', () => {
    const db = freshDb();
    try {
      const j1 = freshJobId(db);
      const j2 = freshJobId(db);
      db.replaceKnowledgeIssues([
        { issueType: 'duplicate_phrase', severity: 'low', fingerprint: 'sameFp', detail: { v: 1 } }
      ], j1);
      // Manually mark resolved=1 to verify the upsert resets it.
      db.db.prepare(`UPDATE knowledge_issues SET resolved = 1 WHERE fingerprint = 'sameFp'`).run();
      assert.equal(db.getKnowledgeIssues({ resolved: true }).length, 1);

      // Re-emit with same (issue_type, fingerprint) but different severity / detail.
      db.replaceKnowledgeIssues([
        { issueType: 'duplicate_phrase', severity: 'high', fingerprint: 'sameFp', detail: { v: 2 } }
      ], j2);
      const rows = db.getKnowledgeIssues();
      assert.equal(rows.length, 1);
      assert.equal(rows[0].severity, 'high');
      assert.deepEqual(rows[0].detail, { v: 2 });
      assert.equal(rows[0].resolved, false);
      assert.equal(rows[0].lastJobId, j2);
    } finally { db.close(); }
  });

  test.it('getKnowledgeIssues filters by issueType / severity / resolved', () => {
    const db = freshDb();
    try {
      const jobId = freshJobId(db);
      db.replaceKnowledgeIssues([
        { issueType: 'duplicate_phrase', severity: 'high', fingerprint: 'a' },
        { issueType: 'duplicate_phrase', severity: 'low', fingerprint: 'b' },
        { issueType: 'audio_missing', severity: 'high', fingerprint: 'c' }
      ], jobId);

      assert.equal(db.getKnowledgeIssues({ issueType: 'duplicate_phrase' }).length, 2);
      assert.equal(db.getKnowledgeIssues({ severity: 'high' }).length, 2);
      assert.equal(
        db.getKnowledgeIssues({ issueType: 'duplicate_phrase', severity: 'high' }).length,
        1
      );
      assert.equal(db.getKnowledgeIssues({ resolved: false }).length, 3);
      assert.equal(db.getKnowledgeIssues({ resolved: true }).length, 0);
    } finally { db.close(); }
  });

  test.it('getKnowledgeIssues honours the limit (clamped to >=1)', () => {
    const db = freshDb();
    try {
      const jobId = freshJobId(db);
      db.replaceKnowledgeIssues([
        { issueType: 't', severity: 'low', fingerprint: 'x1' },
        { issueType: 't', severity: 'low', fingerprint: 'x2' },
        { issueType: 't', severity: 'low', fingerprint: 'x3' }
      ], jobId);
      assert.equal(db.getKnowledgeIssues({ limit: 2 }).length, 2);
      // Falsy / missing limit falls back to the default of 100.
      assert.equal(db.getKnowledgeIssues({ limit: 0 }).length, 3);
      assert.equal(db.getKnowledgeIssues().length, 3);
    } finally { db.close(); }
  });

  test.it('replaceKnowledgeIssues synthesises a fingerprint when omitted', () => {
    const db = freshDb();
    try {
      const jobId = freshJobId(db);
      db.replaceKnowledgeIssues([
        { issueType: 'duplicate_phrase', severity: 'low' },
        { issueType: 'duplicate_phrase', severity: 'low' }
      ], jobId);
      const rows = db.getKnowledgeIssues();
      assert.equal(rows.length, 2);
      // Synthesised fingerprints are non-empty and distinct.
      assert.ok(rows[0].fingerprint && rows[1].fingerprint);
      assert.notEqual(rows[0].fingerprint, rows[1].fingerprint);
    } finally { db.close(); }
  });
});

// -- knowledge_grammar -------------------------------------------------------

test.describe('databaseService — knowledge_grammar', () => {
  function newJobId(db) {
    return db.createKnowledgeJob({ jobType: 'grammar_link' }).id;
  }

  test.it('replaceKnowledgeGrammarData inserts patterns + refs and returns count', () => {
    const db = freshDb();
    try {
      const jobId = newJobId(db);
      const genId = db.insertGeneration({
        generation: buildGenerationFixture().generation,
        observability: buildGenerationFixture().observability,
        audioFiles: []
      });
      const n = db.replaceKnowledgeGrammarData([
        {
          pattern: 'be + V-ing',
          explanationZh: '进行时',
          confidence: 0.91,
          exampleRefs: [{ generationId: genId, sentence: 'I am working.' }]
        },
        {
          pattern: 'have + p.p.',
          explanationZh: '完成时',
          confidence: 0.85
        }
      ], jobId);
      assert.equal(n, 2);

      const rows = db.getKnowledgeGrammarPatterns();
      assert.equal(rows.length, 2);
      const beIng = rows.find((r) => r.pattern === 'be + V-ing');
      assert.equal(beIng.explanationZh, '进行时');
      assert.equal(beIng.refs.length, 1);
      assert.equal(beIng.refs[0].generationId, genId);
      assert.equal(beIng.refs[0].sentence, 'I am working.');
    } finally { db.close(); }
  });

  test.it('replaceKnowledgeGrammarData deactivates the prior active version', () => {
    const db = freshDb();
    try {
      const j1 = newJobId(db);
      db.replaceKnowledgeGrammarData([{ pattern: 'old', explanationZh: '旧', confidence: 0.5 }], j1);
      assert.equal(db.getKnowledgeGrammarPatterns().length, 1);

      // A second job replaces the active version with new rows.
      const j2 = newJobId(db);
      db.replaceKnowledgeGrammarData([
        { pattern: 'new-a', explanationZh: 'a', confidence: 0.9 },
        { pattern: 'new-b', explanationZh: 'b', confidence: 0.8 }
      ], j2);
      const active = db.getKnowledgeGrammarPatterns();
      assert.equal(active.length, 2);
      assert.ok(active.every((r) => r.pattern.startsWith('new-')));
    } finally { db.close(); }
  });

  test.it('replaceKnowledgeGrammarData rerunning the same jobId clears the prior rows for that job', () => {
    const db = freshDb();
    try {
      const j = newJobId(db);
      db.replaceKnowledgeGrammarData([{ pattern: 'p1', explanationZh: 'x', confidence: 0.5 }], j);
      // Re-run with the same job id and a different pattern set — old row gone.
      db.replaceKnowledgeGrammarData([
        { pattern: 'p2', explanationZh: 'y', confidence: 0.6 }
      ], j);
      const rows = db.getKnowledgeGrammarPatterns();
      assert.equal(rows.length, 1);
      assert.equal(rows[0].pattern, 'p2');
    } finally { db.close(); }
  });

  test.it('getKnowledgeGrammarPatterns filters by pattern substring (LIKE)', () => {
    const db = freshDb();
    try {
      const j = newJobId(db);
      db.replaceKnowledgeGrammarData([
        { pattern: 'be + V-ing', explanationZh: 'a', confidence: 0.5 },
        { pattern: 'have + p.p.', explanationZh: 'b', confidence: 0.5 },
        { pattern: 'should + V', explanationZh: 'c', confidence: 0.5 }
      ], j);

      const beish = db.getKnowledgeGrammarPatterns({ pattern: 'be' });
      assert.equal(beish.length, 1);
      assert.equal(beish[0].pattern, 'be + V-ing');

      const plus = db.getKnowledgeGrammarPatterns({ pattern: '+' });
      assert.equal(plus.length, 3); // all contain '+'
    } finally { db.close(); }
  });

  test.it('getKnowledgeGrammarPatterns honours limit', () => {
    const db = freshDb();
    try {
      const j = newJobId(db);
      db.replaceKnowledgeGrammarData([
        { pattern: 'a', explanationZh: '', confidence: 0.1 },
        { pattern: 'b', explanationZh: '', confidence: 0.1 },
        { pattern: 'c', explanationZh: '', confidence: 0.1 }
      ], j);
      assert.equal(db.getKnowledgeGrammarPatterns({ limit: 2 }).length, 2);
    } finally { db.close(); }
  });

  test.it('getKnowledgeGrammarPatterns groups refs by pattern id', () => {
    const db = freshDb();
    try {
      const j = newJobId(db);
      const g1 = db.insertGeneration({
        generation: buildGenerationFixture({ generation: { phrase: 'one', baseFilename: 'one', requestId: 'rid_one' } }).generation,
        observability: buildGenerationFixture().observability,
        audioFiles: []
      });
      const g2 = db.insertGeneration({
        generation: buildGenerationFixture({ generation: { phrase: 'two', baseFilename: 'two', requestId: 'rid_two' } }).generation,
        observability: buildGenerationFixture().observability,
        audioFiles: []
      });

      db.replaceKnowledgeGrammarData([
        {
          pattern: 'P',
          explanationZh: '',
          confidence: 0.5,
          exampleRefs: [
            { generationId: g1, sentence: 'first' },
            { generationId: g2, sentence: 'second' }
          ]
        }
      ], j);

      const [row] = db.getKnowledgeGrammarPatterns();
      assert.equal(row.refs.length, 2);
      assert.deepEqual(row.refs.map((r) => r.sentence).sort(), ['first', 'second']);
    } finally { db.close(); }
  });
});

// -- knowledge_clusters ------------------------------------------------------

test.describe('databaseService — knowledge_clusters', () => {
  function newJobId(db) {
    return db.createKnowledgeJob({ jobType: 'cluster' }).id;
  }

  test.it('replaceKnowledgeClusterData inserts clusters + cards and returns count', () => {
    const db = freshDb();
    try {
      const jobId = newJobId(db);
      const genId = db.insertGeneration({
        generation: buildGenerationFixture().generation,
        observability: buildGenerationFixture().observability,
        audioFiles: []
      });
      const n = db.replaceKnowledgeClusterData([
        {
          clusterKey: 'greetings',
          label: 'Greetings',
          description: 'hi family',
          keywords: ['hello', 'hi'],
          confidence: 0.8,
          cards: [{ generationId: genId, score: 0.91 }]
        },
        {
          clusterKey: 'farewells',
          label: 'Farewells',
          confidence: 0.7
        }
      ], jobId);
      assert.equal(n, 2);

      const rows = db.getKnowledgeClusters();
      assert.equal(rows.length, 2);
      // Sorted by confidence desc, so greetings (0.8) precedes farewells (0.7).
      assert.equal(rows[0].clusterKey, 'greetings');
      assert.deepEqual(rows[0].keywords, ['hello', 'hi']);
      assert.equal(rows[0].cards.length, 1);
      assert.equal(rows[0].cards[0].generationId, genId);
      assert.equal(rows[0].cards[0].score, 0.91);
      assert.equal(rows[1].cards.length, 0);
    } finally { db.close(); }
  });

  test.it('replaceKnowledgeClusterData deactivates the prior active version', () => {
    const db = freshDb();
    try {
      const j1 = newJobId(db);
      db.replaceKnowledgeClusterData([{ clusterKey: 'old', label: 'Old', confidence: 0.5 }], j1);
      assert.equal(db.getKnowledgeClusters().length, 1);

      const j2 = newJobId(db);
      db.replaceKnowledgeClusterData([
        { clusterKey: 'new-a', label: 'A', confidence: 0.9 },
        { clusterKey: 'new-b', label: 'B', confidence: 0.8 }
      ], j2);
      const active = db.getKnowledgeClusters();
      assert.equal(active.length, 2);
      assert.ok(active.every((r) => r.clusterKey.startsWith('new-')));
    } finally { db.close(); }
  });

  test.it('replaceKnowledgeClusterData rerunning the same jobId clears prior rows for that job', () => {
    const db = freshDb();
    try {
      const j = newJobId(db);
      db.replaceKnowledgeClusterData([{ clusterKey: 'c1', label: 'C1', confidence: 0.5 }], j);
      db.replaceKnowledgeClusterData([
        { clusterKey: 'c2', label: 'C2', confidence: 0.6 }
      ], j);
      const rows = db.getKnowledgeClusters();
      assert.equal(rows.length, 1);
      assert.equal(rows[0].clusterKey, 'c2');
    } finally { db.close(); }
  });

  test.it('getKnowledgeClusters orders by confidence desc and respects limit', () => {
    const db = freshDb();
    try {
      const j = newJobId(db);
      db.replaceKnowledgeClusterData([
        { clusterKey: 'low', label: 'L', confidence: 0.1 },
        { clusterKey: 'high', label: 'H', confidence: 0.9 },
        { clusterKey: 'mid', label: 'M', confidence: 0.5 }
      ], j);

      const all = db.getKnowledgeClusters();
      assert.deepEqual(all.map((r) => r.clusterKey), ['high', 'mid', 'low']);

      const top2 = db.getKnowledgeClusters(2);
      assert.deepEqual(top2.map((r) => r.clusterKey), ['high', 'mid']);
    } finally { db.close(); }
  });

  test.it('getKnowledgeClusters sorts cards within a cluster by score desc', () => {
    const db = freshDb();
    try {
      const j = newJobId(db);
      const g1 = db.insertGeneration({
        generation: buildGenerationFixture({ generation: { phrase: 'one', baseFilename: 'one', requestId: 'rid_cl_1' } }).generation,
        observability: buildGenerationFixture().observability,
        audioFiles: []
      });
      const g2 = db.insertGeneration({
        generation: buildGenerationFixture({ generation: { phrase: 'two', baseFilename: 'two', requestId: 'rid_cl_2' } }).generation,
        observability: buildGenerationFixture().observability,
        audioFiles: []
      });
      db.replaceKnowledgeClusterData([
        {
          clusterKey: 'k',
          label: 'L',
          confidence: 0.5,
          cards: [
            { generationId: g1, score: 0.3 },
            { generationId: g2, score: 0.9 }
          ]
        }
      ], j);
      const [row] = db.getKnowledgeClusters();
      assert.equal(row.cards.length, 2);
      assert.equal(row.cards[0].score, 0.9);
      assert.equal(row.cards[1].score, 0.3);
    } finally { db.close(); }
  });
});
