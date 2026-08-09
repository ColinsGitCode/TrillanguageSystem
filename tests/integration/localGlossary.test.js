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
});

test('keeps DeepSeek proposal generation fail-closed in the integration harness', async () => {
  const response = await api('POST', '/api/local-glossary/proposals', {
    body: { requestKey: 'integration-request-001', language: 'en', text: 'handoff' },
  });
  assert.equal(response.status, 404);
  assert.equal(response.body.code, 'LOCAL_GLOSSARY_LLM_DISABLED');
  assert.equal(dbService.db.prepare('SELECT COUNT(*) AS count FROM local_glossary_proposals').get().count, 0);
});
