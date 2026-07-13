'use strict';

// Keep the module-load singleton off disk — when the package is required,
// `module.exports = new DatabaseService()` runs immediately and would
// otherwise create ./data/trilingual_records.db. An in-memory connection
// costs nothing and isolates test environment from a real local DB.
process.env.DB_PATH = ':memory:';
process.env.LOG_SILENT = '1';

const test = require('node:test');
const assert = require('node:assert/strict');

const { DatabaseService } = require('../../services/storage/databaseService');

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
        'card_highlights'
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
