'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const { api, resetState, dbService, closeServer } = require('./_harness');

function seedGeneration() {
  return Number(dbService.db.prepare(`
    INSERT INTO generations(
      phrase, phrase_language, card_type, source_mode, llm_provider, llm_model,
      folder_name, base_filename, md_file_path, html_file_path, meta_file_path,
      markdown_content, content_hash, generation_date, request_id
    ) VALUES (
      'workaround', 'en', 'trilingual', 'input', 'deepseek', 'deepseek-v4-pro',
      '20260804', 'local-glossary-route', '/tmp/gloss.md', '/tmp/gloss.html', '/tmp/gloss.json',
      @markdown, @hash, '2026-08-04', 'local-glossary-route-001'
    )
  `).run({
    hash: 'b'.repeat(64),
    markdown: [
      '# workaround',
      '## 1. 英文',
      '- **例句1**: We found a temporary workaround.',
      '  - 我们找到了一个临时的解决办法。',
    ].join('\n'),
  }).lastInsertRowid);
}

test.beforeEach(resetState);
test.after(async () => { await closeServer(); });

test('looks up a current-card Chinese translation without creating persistent glossary data', async () => {
  const generationId = seedGeneration();
  const response = await api('GET', `/api/local-glossary/lookup?language=en&text=${encodeURIComponent('We found a temporary workaround.')}&generationId=${generationId}`);
  assert.equal(response.status, 200);
  assert.equal(response.body.lookup.gloss.zhGloss, '我们找到了一个临时的解决办法。');
  assert.equal(response.body.lookup.gloss.sourceKind, 'current-card');
  assert.equal(dbService.db.prepare('SELECT COUNT(*) AS count FROM local_glossary_entries').get().count, 0);
  assert.equal(dbService.db.prepare('SELECT COUNT(*) AS count FROM local_glossary_proposals').get().count, 0);
});

test('looks up a simple English term from the local dictionary without remote access', async () => {
  const response = await api('GET', '/api/local-glossary/lookup?language=en&text=public%20schedule');
  assert.equal(response.status, 200);
  assert.equal(response.body.lookup.gloss.sourceKind, 'dictionary');
  assert.equal(response.body.lookup.gloss.zhGloss, '公共日程；共享日历');
  assert.equal(response.body.lookup.gloss.partOfSpeech, 'noun phrase');
});

test('looks up a Japanese term with local reading and part of speech', async () => {
  const response = await api('GET', '/api/local-glossary/lookup?language=ja&text=%E5%8B%A4%E5%8B%99%E8%A1%A8');
  assert.equal(response.status, 200);
  assert.equal(response.body.lookup.gloss.sourceKind, 'dictionary');
  assert.equal(response.body.lookup.gloss.reading, 'きんむひょう');
  assert.equal(response.body.lookup.gloss.zhGloss, '考勤表；工作时间表');
});

test('uses context and reading hints to disambiguate local dictionary senses', async () => {
  const publicWord = await api(
    'GET',
    `/api/local-glossary/lookup?language=en&text=public&context=${encodeURIComponent('the public schedule')}`
  );
  assert.equal(publicWord.status, 200);
  assert.equal(publicWord.body.lookup.gloss.zhGloss, '公共的；公开的');
  assert.equal(publicWord.body.lookup.gloss.matchReason, 'context');
  assert.ok(publicWord.body.lookup.alternatives.length >= 1);

  const book = await api(
    'GET',
    `/api/local-glossary/lookup?language=ja&text=${encodeURIComponent('本')}&reading=${encodeURIComponent('ほん')}`
  );
  assert.equal(book.status, 200);
  assert.equal(book.body.lookup.gloss.zhGloss, '书；书本');
  assert.equal(book.body.lookup.gloss.matchReason, 'reading');
});

test('supports manual glossary create, normalized lookup, edit and archive', async () => {
  const created = await api('POST', '/api/local-glossary/entries', {
    body: { language: 'en', canonicalForm: 'timesheet', zhGloss: '考勤表' },
  });
  assert.equal(created.status, 201);

  const lookup = await api('GET', '/api/local-glossary/lookup?language=en&text=timesheets');
  assert.equal(lookup.status, 200);
  assert.equal(lookup.body.lookup.gloss.zhGloss, '考勤表');

  const edited = await api('PATCH', `/api/local-glossary/entries/${created.body.entry.id}`, {
    body: { expectedVersion: 1, canonicalForm: 'timesheet', zhGloss: '工时表；考勤表' },
  });
  assert.equal(edited.status, 200);
  assert.equal(edited.body.entry.version, 2);

  const archived = await api('DELETE', `/api/local-glossary/entries/${created.body.entry.id}`, {
    body: { expectedVersion: 2 },
  });
  assert.equal(archived.status, 200);
  assert.equal(archived.body.entry.status, 'archived');

  const restored = await api('POST', `/api/local-glossary/entries/${created.body.entry.id}/restore`, {
    body: { expectedVersion: 3 },
  });
  assert.equal(restored.status, 200);
  assert.equal(restored.body.entry.status, 'active');
  assert.equal(restored.body.entry.version, 4);
});

test('returns manual entry and imported dictionary catalog statistics', async () => {
  await api('POST', '/api/local-glossary/entries', {
    body: { language: 'ja', canonicalForm: '手帳', zhGloss: '记事本' },
  });
  const response = await api('GET', '/api/local-glossary/catalog');
  assert.equal(response.status, 200);
  assert.ok(response.body.catalog.manual.some((item) => (
    item.language === 'ja' && item.status === 'active' && item.entryCount === 1
  )));
  assert.ok(response.body.catalog.dictionaries.some((item) => (
    item.sourceId === 'three-lans-curated-starter' && item.status === 'active'
  )));
});

test('keeps DeepSeek proposal generation fail-closed in the integration harness', async () => {
  const response = await api('POST', '/api/local-glossary/proposals', {
    body: { requestKey: 'integration-request-001', language: 'en', text: 'handoff' },
  });
  assert.equal(response.status, 404);
  assert.equal(response.body.code, 'LOCAL_GLOSSARY_LLM_DISABLED');
  assert.equal(dbService.db.prepare('SELECT COUNT(*) AS count FROM local_glossary_proposals').get().count, 0);
});

test('DIC-R2 keeps lookup write-free and only records a fact on explicit feedback', async () => {
  const countEvents = () => dbService.db
    .prepare('SELECT COUNT(*) AS count FROM local_glossary_lookup_events').get().count;

  await api('GET', '/api/local-glossary/lookup?language=en&text=public%20schedule');
  assert.equal(countEvents(), 0, 'reading a gloss must not persist anything');

  const recorded = await api('POST', '/api/local-glossary/feedback', {
    body: {
      language: 'en',
      text: 'Public Schedule',
      outcome: 'rejected',
      sourceKind: 'dictionary',
      sourceDetail: 'ECDICT',
      confidence: 'medium',
      matchReason: 'exact-form',
      candidateCount: 3,
      chosenRank: 0,
    },
  });
  assert.equal(recorded.status, 201);
  assert.equal(recorded.body.event.normalizedForm, 'public schedule');
  assert.equal(recorded.body.event.outcome, 'rejected');
  assert.equal(countEvents(), 1);
});

test('DIC-R2 feedback cannot persist surrounding context through descriptive fields', async () => {
  const privateSentence = 'I checked the schedule before my private appointment.';
  await api('POST', '/api/local-glossary/feedback', {
    body: {
      language: 'en',
      text: 'schedule',
      outcome: 'shown',
      sourceKind: 'dictionary',
      confidence: 'high',
      context: privateSentence,
      sentence: privateSentence,
      sourceDetail: privateSentence,
      matchReason: privateSentence,
      senseKey: privateSentence,
    },
  });
  const rows = dbService.db.prepare('SELECT * FROM local_glossary_lookup_events').all();
  assert.equal(rows.length, 1);
  const leaked = Object.values(rows[0]).filter((value) => (
    typeof value === 'string' && value.includes('private appointment')
  ));
  assert.deepEqual(leaked, [], 'no descriptive column may carry the surrounding sentence');
  assert.equal(rows[0].source_detail, null);
  assert.equal(rows[0].match_reason, null);
  assert.equal(rows[0].sense_key, 'default');
});

test('DIC-R2 rejects an unknown outcome instead of storing it', async () => {
  const response = await api('POST', '/api/local-glossary/feedback', {
    body: { language: 'en', text: 'schedule', outcome: 'deleted', sourceKind: 'dictionary', confidence: 'high' },
  });
  assert.equal(response.status, 400);
  assert.equal(response.body.code, 'LOCAL_GLOSSARY_OUTCOME_INVALID');
  assert.equal(dbService.db.prepare('SELECT COUNT(*) AS count FROM local_glossary_lookup_events').get().count, 0);
});

test('DIC-R2 rejects an unknown feedback source and keeps events append-only', async () => {
  const rejected = await api('POST', '/api/local-glossary/feedback', {
    body: { language: 'en', text: 'schedule', outcome: 'shown', sourceKind: 'private sentence', confidence: 'high' },
  });
  assert.equal(rejected.status, 400);
  assert.equal(rejected.body.code, 'LOCAL_GLOSSARY_FEEDBACK_SOURCE_INVALID');

  await api('POST', '/api/local-glossary/feedback', {
    body: { language: 'en', text: 'schedule', outcome: 'shown', sourceKind: 'dictionary', confidence: 'high' },
  });
  assert.throws(
    () => dbService.db.prepare('DELETE FROM local_glossary_lookup_events').run(),
    /immutable/u,
  );
});

test('DIC-R2 ranks real problem terms and keeps a manual correction on top', async () => {
  const post = (outcome) => api('POST', '/api/local-glossary/feedback', {
    body: { language: 'ja', text: '手紙', outcome, sourceKind: 'dictionary', confidence: 'low' },
  });
  await post('shown');
  await post('rejected');
  await post('corrected');

  const stats = await api('GET', '/api/local-glossary/feedback/stats?language=ja');
  assert.equal(stats.status, 200);
  const term = stats.body.stats.problemTerms.find((item) => item.normalizedForm === '手紙');
  assert.ok(term, 'a term the user had to fix must surface in the problem list');
  assert.equal(term.interventions, 2);
  assert.equal(stats.body.stats.outcomes.totals.shown, 1);
  assert.equal(stats.body.stats.outcomes.interventions, 2);

  await api('POST', '/api/local-glossary/entries', {
    body: { language: 'ja', canonicalForm: '手紙', zhGloss: '信件' },
  });
  const lookup = await api('GET', '/api/local-glossary/lookup?language=ja&text=%E6%89%8B%E7%B4%99');
  assert.equal(lookup.body.lookup.gloss.zhGloss, '信件');
  assert.equal(lookup.body.lookup.gloss.sourceKind, 'manual');
});
