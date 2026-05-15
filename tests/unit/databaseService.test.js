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
