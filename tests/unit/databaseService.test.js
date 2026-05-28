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

// -- knowledge_terms_index ---------------------------------------------------

test.describe('databaseService — knowledge_terms_index', () => {
  function newGenId(db, overrides = {}) {
    return db.insertGeneration({
      generation: buildGenerationFixture({ generation: overrides }).generation,
      observability: buildGenerationFixture().observability,
      audioFiles: []
    });
  }
  function newJobId(db) {
    return db.createKnowledgeJob({ jobType: 'index' }).id;
  }

  test.it('upsertKnowledgeTermsIndex returns 0 for empty / non-array input', () => {
    const db = freshDb();
    try {
      assert.equal(db.upsertKnowledgeTermsIndex([], 1), 0);
      assert.equal(db.upsertKnowledgeTermsIndex(null, 1), 0);
      assert.equal(db.upsertKnowledgeTermsIndex(undefined), 0);
    } finally { db.close(); }
  });

  test.it('upsertKnowledgeTermsIndex inserts rows and getKnowledgeIndex returns them', () => {
    const db = freshDb();
    try {
      const g1 = newGenId(db, { phrase: 'hello', baseFilename: 'hello', requestId: 'rid_ti_1' });
      const g2 = newGenId(db, { phrase: 'bonjour', baseFilename: 'bonjour', requestId: 'rid_ti_2' });
      const jobId = newJobId(db);

      const n = db.upsertKnowledgeTermsIndex([
        {
          generationId: g1, phrase: 'hello',
          enHeadword: 'hello', jaHeadword: 'こんにちは', zhHeadword: '你好',
          aliases: ['hi'], tags: ['greeting'], score: 0.9
        },
        { generationId: g2, phrase: 'bonjour', enHeadword: 'good day', score: 0.7 }
      ], jobId);
      assert.equal(n, 2);

      const all = db.getKnowledgeIndex();
      assert.equal(all.length, 2);
      const hello = all.find((r) => r.generationId === g1);
      assert.deepEqual(hello.aliases, ['hi']);
      assert.deepEqual(hello.tags, ['greeting']);
      assert.equal(hello.jaHeadword, 'こんにちは');
    } finally { db.close(); }
  });

  test.it('upsertKnowledgeTermsIndex UPSERTs on generation_id (one row per generation)', () => {
    const db = freshDb();
    try {
      const g = newGenId(db, { phrase: 'pet', baseFilename: 'pet', requestId: 'rid_ti_up' });
      const job = newJobId(db);
      db.upsertKnowledgeTermsIndex([
        { generationId: g, phrase: 'pet', enHeadword: 'pet', score: 0.5, tags: ['v1'] }
      ], job);
      db.upsertKnowledgeTermsIndex([
        { generationId: g, phrase: 'pet (revised)', enHeadword: 'PET', score: 0.95, tags: ['v2'] }
      ], job);

      const rows = db.getKnowledgeIndex();
      assert.equal(rows.length, 1);
      assert.equal(rows[0].phrase, 'pet (revised)');
      assert.equal(rows[0].enHeadword, 'PET');
      assert.equal(rows[0].score, 0.95);
      assert.deepEqual(rows[0].tags, ['v2']);
    } finally { db.close(); }
  });

  test.it('getKnowledgeIndex matches query across phrase / en / ja / zh headwords', () => {
    const db = freshDb();
    try {
      const g1 = newGenId(db, { phrase: 'apple', baseFilename: 'apple', requestId: 'rid_idx_a' });
      const g2 = newGenId(db, { phrase: 'p1', baseFilename: 'p1', requestId: 'rid_idx_b' });
      const g3 = newGenId(db, { phrase: 'p2', baseFilename: 'p2', requestId: 'rid_idx_c' });
      const g4 = newGenId(db, { phrase: 'p3', baseFilename: 'p3', requestId: 'rid_idx_d' });

      db.upsertKnowledgeTermsIndex([
        { generationId: g1, phrase: 'apple', enHeadword: 'apple' },
        { generationId: g2, phrase: 'unrelated', enHeadword: 'pineapple' }, // matches via en
        { generationId: g3, phrase: 'fruit', enHeadword: 'x', jaHeadword: 'りんごapple', zhHeadword: 'x' }, // matches via ja
        { generationId: g4, phrase: 'other', enHeadword: 'x', jaHeadword: 'x', zhHeadword: '苹apple果' } // matches via zh
      ], newJobId(db));

      const hits = db.getKnowledgeIndex({ query: 'apple' });
      const gens = hits.map((h) => h.generationId).sort();
      assert.deepEqual(gens, [g1, g2, g3, g4].sort());
    } finally { db.close(); }
  });

  test.it('getKnowledgeIndex honours limit (clamped >=1) and falls back to default on falsy', () => {
    const db = freshDb();
    try {
      const ids = [
        newGenId(db, { phrase: 'a', baseFilename: 'a', requestId: 'rid_lim_a' }),
        newGenId(db, { phrase: 'b', baseFilename: 'b', requestId: 'rid_lim_b' }),
        newGenId(db, { phrase: 'c', baseFilename: 'c', requestId: 'rid_lim_c' })
      ];
      db.upsertKnowledgeTermsIndex(ids.map((id) => ({ generationId: id, phrase: 'p' })), newJobId(db));

      assert.equal(db.getKnowledgeIndex({ limit: 2 }).length, 2);
      // limit:0 → falls back to default 50, returns all 3
      assert.equal(db.getKnowledgeIndex({ limit: 0 }).length, 3);
    } finally { db.close(); }
  });

  test.it('getKnowledgeIndex returns empty when nothing matches the query', () => {
    const db = freshDb();
    try {
      const g = newGenId(db);
      db.upsertKnowledgeTermsIndex([
        { generationId: g, phrase: 'something', enHeadword: 'something' }
      ], newJobId(db));
      assert.deepEqual(db.getKnowledgeIndex({ query: '__no_such_token__' }), []);
    } finally { db.close(); }
  });
});

// -- knowledge_synonyms ------------------------------------------------------

test.describe('databaseService — knowledge_synonyms', () => {
  function newGenId(db, overrides = {}) {
    return db.insertGeneration({
      generation: buildGenerationFixture({ generation: overrides }).generation,
      observability: buildGenerationFixture().observability,
      audioFiles: []
    });
  }
  function newJobId(db) {
    return db.createKnowledgeJob({ jobType: 'synonym_boundary' }).id;
  }

  test.it('saveKnowledgeSynonymCandidates returns 0 for falsy jobId', () => {
    const db = freshDb();
    try {
      assert.equal(db.saveKnowledgeSynonymCandidates(0, [{ pairKey: 'a||b' }]), 0);
      assert.equal(db.saveKnowledgeSynonymCandidates(null, []), 0);
    } finally { db.close(); }
  });

  test.it('saveKnowledgeSynonymCandidates inserts then upserts on (job_id, pair_key)', () => {
    const db = freshDb();
    try {
      const jobId = newJobId(db);
      const n1 = db.saveKnowledgeSynonymCandidates(jobId, [
        { pairKey: 'a||b', termA: 'a', termB: 'b', candidateScore: 0.5, status: 'queued' },
        { pairKey: 'c||d', termA: 'c', termB: 'd', candidateScore: 0.7, status: 'queued' }
      ]);
      assert.equal(n1, 2);

      // Re-run with same job + same pairKey but new score/status — should replace the row.
      const n2 = db.saveKnowledgeSynonymCandidates(jobId, [
        { pairKey: 'a||b', termA: 'a', termB: 'b', candidateScore: 0.9, status: 'done' }
      ]);
      assert.equal(n2, 1);

      // The DELETE-then-INSERT pattern means a re-run wipes the previous rows.
      const row = db.db.prepare(`SELECT COUNT(*) AS c FROM knowledge_synonym_candidates WHERE job_id = ?`).get(jobId);
      assert.equal(row.c, 1);
    } finally { db.close(); }
  });

  test.it('replaceKnowledgeSynonymData inserts a group and its members, returning count', () => {
    const db = freshDb();
    try {
      const jobId = newJobId(db);
      const g1 = newGenId(db, { phrase: 'one', baseFilename: 'one', requestId: 'rid_syn_1' });
      const g2 = newGenId(db, { phrase: 'two', baseFilename: 'two', requestId: 'rid_syn_2' });
      const n = db.replaceKnowledgeSynonymData([
        {
          pairKey: 'big||large',
          termA: 'big',
          termB: 'large',
          riskLevel: 'medium',
          confidence: 0.88,
          recommendation: 'context-sensitive',
          members: [
            { generationId: g1, term: 'big', lang: 'en' },
            { generationId: g2, term: 'large', lang: 'en' }
          ]
        }
      ], jobId);
      assert.equal(n, 1);

      const hits = db.getKnowledgeSynonymsByPhrase('big');
      assert.equal(hits.length, 1);
      assert.equal(hits[0].pairKey, 'big||large');
      assert.equal(hits[0].confidence, 0.88);
      assert.equal(hits[0].members.length, 2);
    } finally { db.close(); }
  });

  test.it('replaceKnowledgeSynonymData deactivates the prior active version', () => {
    const db = freshDb();
    try {
      const j1 = newJobId(db);
      db.replaceKnowledgeSynonymData([{ pairKey: 'old||pair', termA: 'old', termB: 'pair', confidence: 0.5 }], j1);
      assert.equal(db.listKnowledgeSynonymBoundaries().total, 1);

      const j2 = newJobId(db);
      db.replaceKnowledgeSynonymData([{ pairKey: 'new||pair', termA: 'new', termB: 'pair', confidence: 0.7 }], j2);
      const list = db.listKnowledgeSynonymBoundaries();
      assert.equal(list.total, 1);
      assert.equal(list.items[0].pairKey, 'new||pair');
    } finally { db.close(); }
  });

  test.it('replaceKnowledgeSynonymData re-emit replaces members on the same group', () => {
    const db = freshDb();
    try {
      const jobId = newJobId(db);
      const g1 = newGenId(db, { phrase: 'x', baseFilename: 'x', requestId: 'rid_syn_x' });
      const g2 = newGenId(db, { phrase: 'y', baseFilename: 'y', requestId: 'rid_syn_y' });

      db.replaceKnowledgeSynonymData([
        {
          pairKey: 'p||q', termA: 'p', termB: 'q',
          evidenceHash: 'hash1', schemaVersion: '1.0.0',
          members: [{ generationId: g1, term: 'p', lang: 'en' }]
        }
      ], jobId);

      db.replaceKnowledgeSynonymData([
        {
          pairKey: 'p||q', termA: 'p', termB: 'q',
          evidenceHash: 'hash1', schemaVersion: '1.0.0',
          members: [{ generationId: g2, term: 'q', lang: 'en' }]
        }
      ], jobId);

      const [hit] = db.getKnowledgeSynonymsByPhrase('p');
      assert.equal(hit.members.length, 1);
      assert.equal(hit.members[0].generationId, g2);
      assert.equal(hit.members[0].term, 'q');
    } finally { db.close(); }
  });

  test.it('listKnowledgeSynonymBoundaries paginates + risk-orders + filters by query/riskLevel/jobId', () => {
    const db = freshDb();
    try {
      const jobId = newJobId(db);
      db.replaceKnowledgeSynonymData([
        { pairKey: 'low||a', termA: 'low', termB: 'a', riskLevel: 'low', confidence: 0.1 },
        { pairKey: 'high||a', termA: 'high', termB: 'a', riskLevel: 'high', confidence: 0.9 },
        { pairKey: 'med||a', termA: 'med', termB: 'a', riskLevel: 'medium', confidence: 0.5 }
      ], jobId);

      const all = db.listKnowledgeSynonymBoundaries();
      assert.equal(all.total, 3);
      // Risk-level desc (high > medium > low)
      assert.deepEqual(all.items.map((r) => r.riskLevel), ['high', 'medium', 'low']);

      const onlyHigh = db.listKnowledgeSynonymBoundaries({ riskLevel: 'high' });
      assert.equal(onlyHigh.total, 1);
      assert.equal(onlyHigh.items[0].pairKey, 'high||a');

      const byQuery = db.listKnowledgeSynonymBoundaries({ query: 'med' });
      assert.equal(byQuery.total, 1);
      assert.equal(byQuery.items[0].pairKey, 'med||a');

      const paged = db.listKnowledgeSynonymBoundaries({ page: 1, pageSize: 2 });
      assert.equal(paged.total, 3);
      assert.equal(paged.items.length, 2);
      const page2 = db.listKnowledgeSynonymBoundaries({ page: 2, pageSize: 2 });
      assert.equal(page2.items.length, 1);

      // Filtering by jobId returns rows for *that* job regardless of is_active.
      const byJob = db.listKnowledgeSynonymBoundaries({ jobId });
      assert.equal(byJob.total, 3);
    } finally { db.close(); }
  });

  test.it('getKnowledgeSynonymBoundaryDetail returns null for empty pairKey', () => {
    const db = freshDb();
    try {
      assert.equal(db.getKnowledgeSynonymBoundaryDetail({}), null);
      assert.equal(db.getKnowledgeSynonymBoundaryDetail({ pairKey: '   ' }), null);
    } finally { db.close(); }
  });

  test.it('getKnowledgeSynonymBoundaryDetail looks up by pair_key (case-insensitive) and inflates members + candidate', () => {
    const db = freshDb();
    try {
      const jobId = newJobId(db);
      db.saveKnowledgeSynonymCandidates(jobId, [
        { pairKey: 'pp||qq', termA: 'pp', termB: 'qq', candidateScore: 0.77, evidenceHash: 'ev1', status: 'done' }
      ]);
      db.replaceKnowledgeSynonymData([
        {
          pairKey: 'pp||qq', termA: 'pp', termB: 'qq',
          confidence: 0.8, recommendation: 'reco',
          members: [{ term: 'pp', lang: 'en' }]
        }
      ], jobId);

      const detail = db.getKnowledgeSynonymBoundaryDetail({ pairKey: 'PP||QQ' });
      assert.ok(detail);
      assert.equal(detail.pairKey, 'pp||qq');
      assert.equal(detail.recommendation, 'reco');
      assert.equal(detail.members.length, 1);
      assert.equal(detail.candidate?.candidateScore, 0.77);
      assert.equal(detail.candidate?.status, 'done');
    } finally { db.close(); }
  });

  test.it('getKnowledgeSynonymBoundaryDetail supports id: lookup', () => {
    const db = freshDb();
    try {
      const jobId = newJobId(db);
      db.replaceKnowledgeSynonymData([
        { pairKey: 'k1||k2', termA: 'k1', termB: 'k2', confidence: 0.5 }
      ], jobId);
      const row = db.db.prepare(`SELECT id FROM knowledge_synonym_groups LIMIT 1`).get();
      const detail = db.getKnowledgeSynonymBoundaryDetail({ pairKey: `id:${row.id}` });
      assert.ok(detail);
      assert.equal(detail.id, row.id);
      assert.equal(detail.pairKey, 'k1||k2');
    } finally { db.close(); }
  });
});

// -- knowledge_relations / overview / summary --------------------------------

test.describe('databaseService — knowledge_relations + overview + summary', () => {
  function newGenId(db, overrides = {}) {
    return db.insertGeneration({
      generation: buildGenerationFixture({ generation: overrides }).generation,
      observability: buildGenerationFixture().observability,
      audioFiles: []
    });
  }

  test.it('insertKnowledgeRawOutput appends a row scoped to a job', () => {
    const db = freshDb();
    try {
      const job = db.createKnowledgeJob({ jobType: 'summary' }).id;
      db.insertKnowledgeRawOutput(job, 1, {
        input: { foo: 'bar' },
        output: { result: 'hello' },
        status: 'ok'
      });
      const row = db.db.prepare(`SELECT * FROM knowledge_outputs_raw WHERE job_id = ?`).get(job);
      assert.ok(row);
      assert.equal(row.batch_no, 1);
      assert.equal(row.status, 'ok');
      const parsed = JSON.parse(row.output_json);
      assert.equal(parsed.result, 'hello');
      // input_digest is the sha1 of the input.
      assert.ok(/^[0-9a-f]{40}$/.test(row.input_digest));
    } finally { db.close(); }
  });

  test.it('getLatestKnowledgeSummary returns null when no summary exists, then the latest result', () => {
    const db = freshDb();
    try {
      assert.equal(db.getLatestKnowledgeSummary(), null);

      const job = db.createKnowledgeJob({ jobType: 'summary' }).id;
      db.updateKnowledgeJobStatus(job, { status: 'success', finishedAt: '2026-05-17T00:00:00Z' });
      db.insertKnowledgeRawOutput(job, 1, {
        input: {},
        output: { result: { headline: 'all good', counts: { terms: 3 } } },
        status: 'ok'
      });

      const summary = db.getLatestKnowledgeSummary();
      assert.deepEqual(summary, { headline: 'all good', counts: { terms: 3 } });
    } finally { db.close(); }
  });

  test.it('getKnowledgeSourceCards filters by folderFrom/folderTo + cardTypes + limit', () => {
    const db = freshDb();
    try {
      newGenId(db, { folderName: '20260101', cardType: 'trilingual', requestId: 'rid_src_a' });
      newGenId(db, { folderName: '20260201', cardType: 'grammar_ja', requestId: 'rid_src_b' });
      newGenId(db, { folderName: '20260301', cardType: 'trilingual', requestId: 'rid_src_c' });

      const all = db.getKnowledgeSourceCards({});
      assert.equal(all.length, 3);

      const ranged = db.getKnowledgeSourceCards({ folderFrom: '20260201', folderTo: '20260201' });
      assert.equal(ranged.length, 1);
      assert.equal(ranged[0].folder_name, '20260201');

      const onlyTri = db.getKnowledgeSourceCards({ cardTypes: ['trilingual'] });
      assert.equal(onlyTri.length, 2);

      const limited = db.getKnowledgeSourceCards({ limit: 1 });
      assert.equal(limited.length, 1);
    } finally { db.close(); }
  });

  test.it('getKnowledgeOverview returns zero counts on an empty db and tops after data loads', () => {
    const db = freshDb();
    try {
      const empty = db.getKnowledgeOverview();
      assert.equal(empty.counts.termCount, 0);
      assert.equal(empty.counts.grammarPatternCount, 0);
      assert.equal(empty.counts.clusterCount, 0);
      assert.equal(empty.counts.openIssueCount, 0);
      assert.deepEqual(empty.topTerms, []);

      const job = db.createKnowledgeJob({ jobType: 'index' }).id;
      const g = newGenId(db, { phrase: 'one', baseFilename: 'one', requestId: 'rid_ov_1' });
      db.upsertKnowledgeTermsIndex([{ generationId: g, phrase: 'one', score: 0.9 }], job);
      db.replaceKnowledgeGrammarData([{ pattern: 'P', explanationZh: '', confidence: 0.8 }], job);
      db.replaceKnowledgeClusterData([{ clusterKey: 'k', label: 'L', confidence: 0.7 }], job);
      db.replaceKnowledgeIssues([{ issueType: 'duplicate_phrase', severity: 'high', fingerprint: 'f1' }], job);

      const full = db.getKnowledgeOverview();
      assert.equal(full.counts.termCount, 1);
      assert.equal(full.counts.grammarPatternCount, 1);
      assert.equal(full.counts.clusterCount, 1);
      assert.equal(full.counts.openIssueCount, 1);
      assert.equal(full.topTerms[0].phrase, 'one');
      assert.equal(full.topPatterns[0].pattern, 'P');
      assert.equal(full.topClusters[0].clusterKey, 'k');
      assert.equal(full.topIssues[0].issueType, 'duplicate_phrase');
    } finally { db.close(); }
  });

  test.it('_aggregateKnowledgeByGenerationIds returns empty {patterns,clusters,issues} for [] input', () => {
    const db = freshDb();
    try {
      assert.deepEqual(db._aggregateKnowledgeByGenerationIds([]), { patterns: [], clusters: [], issues: [] });
      assert.deepEqual(db._aggregateKnowledgeByGenerationIds(null), { patterns: [], clusters: [], issues: [] });
    } finally { db.close(); }
  });

  test.it('getKnowledgeCardRelations returns null for unknown / falsy id', () => {
    const db = freshDb();
    try {
      assert.equal(db.getKnowledgeCardRelations(0), null);
      assert.equal(db.getKnowledgeCardRelations(99999), null);
    } finally { db.close(); }
  });

  test.it('getKnowledgeCardRelations stitches together term/grammar/cluster/issues for a card', () => {
    const db = freshDb();
    try {
      const job = db.createKnowledgeJob({ jobType: 'index' }).id;
      const g = newGenId(db, { phrase: 'subject', baseFilename: 'subject', requestId: 'rid_rel_1' });

      db.upsertKnowledgeTermsIndex([
        { generationId: g, phrase: 'subject', enHeadword: 'subject', score: 0.9 }
      ], job);
      db.replaceKnowledgeGrammarData([
        { pattern: 'pat', explanationZh: 'x', confidence: 0.8, exampleRefs: [{ generationId: g, sentence: 's' }] }
      ], job);
      db.replaceKnowledgeClusterData([
        { clusterKey: 'k', label: 'L', confidence: 0.7, cards: [{ generationId: g, score: 0.9 }] }
      ], job);
      db.replaceKnowledgeIssues([
        { issueType: 'duplicate_phrase', severity: 'high', fingerprint: 'f1', generationId: g }
      ], job);

      const rel = db.getKnowledgeCardRelations(g);
      assert.ok(rel);
      assert.equal(rel.card.generationId, g);
      assert.equal(rel.term.phrase, 'subject');
      assert.equal(rel.grammarHits.length, 1);
      assert.equal(rel.clusters.length, 1);
      assert.equal(rel.issues.length, 1);
      assert.equal(rel.issues[0].severity, 'high');
    } finally { db.close(); }
  });

  test.it('getKnowledgeTermRelations returns empty shape for empty keyword and matches otherwise', () => {
    const db = freshDb();
    try {
      assert.deepEqual(db.getKnowledgeTermRelations(''), {
        term: '', matchedEntries: [], patterns: [], clusters: [], issues: [], relatedCards: []
      });

      const job = db.createKnowledgeJob({ jobType: 'index' }).id;
      const g = newGenId(db, { phrase: 'p', baseFilename: 'p', requestId: 'rid_tr_1' });
      db.upsertKnowledgeTermsIndex([
        { generationId: g, phrase: 'apple', enHeadword: 'apple', score: 0.5 }
      ], job);

      const r = db.getKnowledgeTermRelations('apple');
      assert.equal(r.term, 'apple');
      assert.equal(r.matchedEntries.length, 1);
      assert.equal(r.relatedCards.length, 1);
      assert.deepEqual(r.relatedCards[0].reasons, ['term']);
    } finally { db.close(); }
  });

  test.it('getKnowledgePatternRelations returns shape with pattern:null when nothing matches', () => {
    const db = freshDb();
    try {
      const empty = db.getKnowledgePatternRelations('');
      assert.equal(empty.pattern, null);

      const job = db.createKnowledgeJob({ jobType: 'grammar_link' }).id;
      const g = newGenId(db, { phrase: 'p', baseFilename: 'p', requestId: 'rid_pat_1' });
      db.replaceKnowledgeGrammarData([
        { pattern: 'be V-ing', explanationZh: 'x', confidence: 0.9, exampleRefs: [{ generationId: g, sentence: 's' }] }
      ], job);

      const hit = db.getKnowledgePatternRelations('be V');
      assert.ok(hit.pattern);
      assert.equal(hit.pattern.pattern, 'be V-ing');
      assert.equal(hit.refs.length, 1);
      assert.equal(hit.refs[0].generationId, g);
    } finally { db.close(); }
  });

  test.it('getKnowledgeClusterRelations: empty key + no-match return null cluster; exact key returns cards', () => {
    const db = freshDb();
    try {
      assert.equal(db.getKnowledgeClusterRelations('').cluster, null);
      assert.equal(db.getKnowledgeClusterRelations('does-not-exist').cluster, null);

      const job = db.createKnowledgeJob({ jobType: 'cluster' }).id;
      const g = newGenId(db, { phrase: 'p', baseFilename: 'p', requestId: 'rid_cr_1' });
      db.replaceKnowledgeClusterData([
        { clusterKey: 'greetings', label: 'L', confidence: 0.6, cards: [{ generationId: g, score: 0.8 }] }
      ], job);

      const hit = db.getKnowledgeClusterRelations('greetings');
      assert.ok(hit.cluster);
      assert.equal(hit.cluster.clusterKey, 'greetings');
      assert.equal(hit.cards.length, 1);
      assert.equal(hit.cards[0].generationId, g);
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
      assert.ok(id > 0);
      assert.ok(db.getGenerationById(id));

      db.truncateAllForTests();

      assert.equal(db.getGenerationById(id), null);
      assert.equal(db.db.prepare('SELECT COUNT(*) AS c FROM generations').get().c, 0);
      assert.equal(db.db.prepare('SELECT COUNT(*) AS c FROM audio_files').get().c, 0);
      assert.equal(db.db.prepare('SELECT COUNT(*) AS c FROM observability_metrics').get().c, 0);
    } finally { db.close(); }
  });

  test.it('wipes knowledge_* + jobs tables', () => {
    const db = freshDb();
    try {
      // Touch a representative row in each domain so the truncate has work to do.
      const job = db.createKnowledgeJob({ jobType: 'index' }).id;
      const g = db.insertGeneration(buildGenerationFixture());
      db.upsertKnowledgeTermsIndex([{ generationId: g, phrase: 'x', score: 0.1 }], job);
      db.replaceKnowledgeIssues([{ issueType: 't', severity: 'low', fingerprint: 'fp' }], job);
      db.replaceKnowledgeGrammarData([{ pattern: 'p', explanationZh: '', confidence: 0.1 }], job);
      db.replaceKnowledgeClusterData([{ clusterKey: 'k', label: 'L', confidence: 0.1 }], job);
      db.replaceKnowledgeSynonymData([{ pairKey: 'a||b', termA: 'a', termB: 'b' }], job);
      db.insertKnowledgeRawOutput(job, 1, { input: {}, output: {} });

      // sanity: at least one row in each
      const cnt = (t) => db.db.prepare(`SELECT COUNT(*) AS c FROM ${t}`).get().c;
      assert.ok(cnt('knowledge_jobs') > 0);
      assert.ok(cnt('knowledge_terms_index') > 0);
      assert.ok(cnt('knowledge_issues') > 0);
      assert.ok(cnt('knowledge_synonym_groups') > 0);
      assert.ok(cnt('knowledge_outputs_raw') > 0);

      db.truncateAllForTests();

      for (const t of [
        'knowledge_jobs', 'knowledge_terms_index', 'knowledge_issues',
        'knowledge_grammar_patterns', 'knowledge_clusters',
        'knowledge_synonym_groups', 'knowledge_synonym_members',
        'knowledge_outputs_raw',
        'generations'
      ]) {
        assert.equal(cnt(t), 0, `expected ${t} to be empty after truncate`);
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
