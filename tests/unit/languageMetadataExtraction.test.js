'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const Database = require('better-sqlite3');
const fs = require('node:fs');
const path = require('node:path');

const domain = require('../../services/storage/db/languageMetadata');
const {
  createLanguageMetadataExtractionService,
} = require('../../services/languageMetadata/application/extractionService');

const SCHEMA = fs.readFileSync(path.join(__dirname, '../../database/schema.sql'), 'utf8');
const HASH_A = 'a'.repeat(64);
const HASH_B = 'b'.repeat(64);
const MARKDOWN = [
  '# sample',
  '## 2. 日本語:',
  '- **例句1**: データをリフレッシュする。',
].join('\n');

function createDb() {
  const db = new Database(':memory:');
  db.exec(SCHEMA);
  return db;
}

// Minimal dbService stand-in: only what the extraction service touches.
function createDbService(db, generation) {
  return {
    db,
    getGenerationById: () => generation,
    ensureLanguageMetadataJob: (payload) => domain.ensureJob(db, payload),
    claimLanguageMetadataJob: (id, nowUtc) => domain.markJobRunning(db, id, nowUtc),
    claimNextLanguageMetadataJob: (nowUtc) => domain.claimNextJob(db, nowUtc),
    recoverRunningLanguageMetadataJobs: (nowUtc) => domain.recoverRunningJobs(db, nowUtc),
    markLanguageMetadataJobRunning: (id, nowUtc) => domain.markJobRunning(db, id, nowUtc),
    finishLanguageMetadataJob: (id, payload) => domain.finishJob(db, id, payload),
    insertLanguageMetadataProposal: (payload) => domain.insertProposal(db, payload),
    listLanguageMetadataJobs: (options) => domain.listJobs(db, options),
    listLanguageMetadataProposals: (options) => domain.listProposals(db, options),
    markLanguageMetadataProposalsStale: (options) => domain.markStaleForOtherHashes(db, options),
  };
}

const segments = [{ text: 'データをリフレッシュする。', startCodePoint: 0, endCodePoint: 13 }];

function createService(db, { llm, enabled = true, extractionEnabled = true, generation } = {}) {
  return createLanguageMetadataExtractionService({
    dbService: createDbService(db, generation || { id: 7, content_hash: HASH_A, markdown_content: MARKDOWN }),
    llm,
    locateSegments: () => segments,
    enabled,
    extractionEnabled,
    now: () => '2026-08-10T00:00:00.000Z',
  });
}

const goodResponse = {
  model: 'deepseek-v4-flash',
  text: JSON.stringify({
    schema_version: 'jlm-foreign-origin-v1',
    items: [
      { segment_index: 1, surface: 'データ', occurrence: 1, origin_term: 'data', origin_language: 'en', confidence: 'high' },
      { segment_index: 1, surface: 'リフレッシュ', occurrence: 1, origin_term: 'refresh', origin_language: 'en', confidence: 'medium' },
    ],
  }),
};

test.describe('JLM-A0 shadow extraction', () => {
  test.it('does nothing at all when the feature flag is off', async () => {
    const db = createDb();
    let called = false;
    const service = createService(db, { enabled: false, llm: { generateJson: async () => { called = true; } } });
    const result = await service.extractForGeneration(7);
    assert.equal(result.status, 'disabled');
    assert.equal(called, false, 'no provider call may happen while disabled');
    assert.equal(db.prepare('SELECT COUNT(*) AS c FROM language_metadata_jobs').get().c, 0);
    assert.equal(db.prepare('SELECT COUNT(*) AS c FROM language_metadata_proposals').get().c, 0);
  });

  test.it('queues a job but issues no call when extraction is off', async () => {
    const db = createDb();
    let called = false;
    const service = createService(db, {
      extractionEnabled: false,
      llm: { generateJson: async () => { called = true; } },
    });
    const result = await service.extractForGeneration(7);
    assert.equal(result.status, 'queued');
    assert.equal(called, false);
    assert.equal(db.prepare('SELECT COUNT(*) AS c FROM language_metadata_jobs').get().c, 1);
    assert.equal(db.prepare('SELECT COUNT(*) AS c FROM language_metadata_proposals').get().c, 0);
  });

  test.it('stores located proposals as pending, never accepted', async () => {
    const db = createDb();
    let providerOptions;
    const service = createLanguageMetadataExtractionService({
      dbService: createDbService(db, { id: 7, content_hash: HASH_A, markdown_content: MARKDOWN }),
      llm: { generateJson: async (_prompt, options) => { providerOptions = options; return goodResponse; } },
      locateSegments: () => segments,
      enabled: true,
      extractionEnabled: true,
      timeoutMs: 4321,
      now: () => '2026-08-10T00:00:00.000Z',
    });
    const result = await service.extractForGeneration(7);
    assert.equal(result.status, 'succeeded');
    assert.equal(result.created, 2);

    const proposals = domain.listProposals(db, { targetKind: 'generation', targetId: 7 });
    assert.equal(proposals.length, 2);
    assert.ok(proposals.every((item) => item.status === 'pending'), 'A0 must never produce accepted rows');
    assert.ok(proposals.every((item) => item.origin === 'llm'));
    assert.deepEqual(proposals[0].value, { originTerm: 'data', originLanguage: 'en' });
    assert.equal(proposals[0].startCodePoint, 0);
    assert.equal(proposals[0].endCodePoint, 3);
    assert.deepEqual(providerOptions, { thinking: 'disabled', timeoutMs: 4321 });
  });

  test.it('is idempotent when the same body version is extracted twice', async () => {
    const db = createDb();
    const service = createService(db, { llm: { generateJson: async () => goodResponse } });
    await service.extractForGeneration(7);
    const second = await service.extractForGeneration(7);
    assert.equal(second.status, 'already-done');
    assert.equal(db.prepare('SELECT COUNT(*) AS c FROM language_metadata_jobs').get().c, 1);
    assert.equal(db.prepare('SELECT COUNT(*) AS c FROM language_metadata_proposals').get().c, 2);
  });
});

test.describe('JLM-A0 failure semantics', () => {
  test.it('records a provider timeout as a retryable job rather than an empty result', async () => {
    const db = createDb();
    const error = new Error('timeout');
    error.code = 'LLM_TIMEOUT';
    const service = createService(db, { llm: { generateJson: async () => { throw error; } } });
    const result = await service.extractForGeneration(7);

    assert.equal(result.status, 'failed');
    assert.equal(result.code, 'LLM_TIMEOUT');
    const [job] = domain.listJobs(db, { targetKind: 'generation', targetId: 7 });
    // The job row is what stops this being read as "this card has no loanwords".
    assert.equal(job.status, 'failed');
    assert.equal(job.lastErrorCode, 'LLM_TIMEOUT');
    assert.equal(job.attempts, 1);
    assert.equal(db.prepare('SELECT COUNT(*) AS c FROM language_metadata_proposals').get().c, 0);
  });

  test.it('gives up as abandoned once attempts are exhausted', async () => {
    const db = createDb();
    const error = new Error('timeout');
    error.code = 'LLM_TIMEOUT';
    const service = createService(db, { llm: { generateJson: async () => { throw error; } } });
    await service.extractForGeneration(7);
    await service.extractForGeneration(7);
    await service.extractForGeneration(7);
    const [job] = domain.listJobs(db, { targetKind: 'generation', targetId: 7 });
    assert.equal(job.attempts, 3);
    assert.equal(job.status, 'abandoned', 'exhausted retries must be distinguishable from "will retry"');
  });

  test.it('rejects a non-JSON response without inventing proposals', async () => {
    const db = createDb();
    const service = createService(db, { llm: { generateJson: async () => ({ text: 'not json' }) } });
    const result = await service.extractForGeneration(7);
    assert.equal(result.code, 'RESPONSE_NOT_JSON');
    const [job] = domain.listJobs(db, { targetKind: 'generation', targetId: 7 });
    assert.equal(job.lastErrorCode, 'RESPONSE_NOT_JSON');
    assert.equal(db.prepare('SELECT COUNT(*) AS c FROM language_metadata_proposals').get().c, 0);
  });

  test.it('drops hallucinated surfaces but still marks the job succeeded', async () => {
    const db = createDb();
    const service = createService(db, {
      llm: {
        generateJson: async () => ({
          model: 'm',
          text: JSON.stringify({
            schema_version: 'jlm-foreign-origin-v1',
            items: [
              { segment_index: 1, surface: 'カレンダー', occurrence: 1, origin_term: 'calendar', origin_language: 'en', confidence: 'high' },
            ],
          }),
        }),
      },
    });
    const result = await service.extractForGeneration(7);
    assert.equal(result.status, 'succeeded');
    assert.equal(result.created, 0);
    assert.equal(result.rejected, 1);
    assert.equal(db.prepare('SELECT COUNT(*) AS c FROM language_metadata_proposals').get().c, 0);
  });

  test.it('never throws, whatever the provider returns', async () => {
    const db = createDb();
    for (const generateJson of [
      async () => { throw new Error('boom'); },
      async () => ({ text: null }),
      async () => ({}),
      async () => null,
    ]) {
      const service = createService(db, { llm: { generateJson } });
      const result = await service.extractForGeneration(7);
      assert.ok(result && typeof result.status === 'string');
    }
  });

  test.it('skips a card with no katakana instead of creating an empty job', async () => {
    const db = createDb();
    const service = createLanguageMetadataExtractionService({
      dbService: createDbService(db, { id: 8, content_hash: HASH_A, markdown_content: MARKDOWN }),
      llm: { generateJson: async () => goodResponse },
      locateSegments: () => [{ text: '今日は良い天気です。', startCodePoint: 0, endCodePoint: 10 }],
      enabled: true,
      extractionEnabled: true,
    });
    const result = await service.extractForGeneration(8);
    assert.equal(result.code, 'NO_KATAKANA_CANDIDATE');
    assert.equal(db.prepare('SELECT COUNT(*) AS c FROM language_metadata_jobs').get().c, 0);
  });
});

test.describe('JLM-A0 body version binding', () => {
  test.it('retires candidates bound to a superseded body hash', async () => {
    const db = createDb();
    const service = createService(db, { llm: { generateJson: async () => goodResponse } });
    await service.extractForGeneration(7);
    assert.ok(domain.listProposals(db, { targetKind: 'generation', targetId: 7 })
      .every((item) => item.status === 'pending'));

    // Same card, new body version: old ranges may now point at other characters.
    const revised = createService(db, {
      llm: { generateJson: async () => goodResponse },
      generation: { id: 7, content_hash: HASH_B, markdown_content: MARKDOWN },
    });
    await revised.extractForGeneration(7);

    const byHash = domain.listProposals(db, { targetKind: 'generation', targetId: 7 })
      .reduce((acc, item) => {
        acc[item.sourceContentHash] = acc[item.sourceContentHash] || new Set();
        acc[item.sourceContentHash].add(item.status);
        return acc;
      }, {});
    assert.deepEqual([...byHash[HASH_A]], ['stale']);
    assert.deepEqual([...byHash[HASH_B]], ['pending']);
  });

  test.it('does not overwrite a stored proposal when a replay disagrees', () => {
    const db = createDb();
    const base = {
      proposalKey: 'k1', targetKind: 'generation', targetId: 7, sourceContentHash: HASH_A,
      metadataKind: 'foreign-origin', surface: 'データ', startCodePoint: 0, endCodePoint: 3,
      confidence: 'high', nowUtc: '2026-08-10T00:00:00.000Z',
    };
    const first = domain.insertProposal(db, { ...base, valueJson: JSON.stringify({ originTerm: 'data' }) });
    assert.equal(first.created, true);

    const replay = domain.insertProposal(db, { ...base, valueJson: JSON.stringify({ originTerm: 'dater' }) });
    assert.equal(replay.created, false);
    assert.equal(replay.conflict, true, 'a contradictory replay must surface, not overwrite');
    assert.deepEqual(replay.proposal.value, { originTerm: 'data' });
  });
});
