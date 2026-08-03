'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const { api, resetState, dbService, closeServer } = require('./_harness');

const HASH = '9'.repeat(64);

function seedGeneration() {
  return Number(dbService.db.prepare(`
    INSERT INTO generations(
      phrase, phrase_language, card_type, source_mode, llm_provider, llm_model,
      folder_name, base_filename, md_file_path, html_file_path, meta_file_path,
      markdown_content, content_hash, generation_date, request_id
    ) VALUES (
      'manual tag fixture', 'en', 'trilingual', 'input', 'deepseek', 'deepseek-v4-pro',
      '20260803', 'manual-tag-fixture', '/tmp/tag.md', '/tmp/tag.html', '/tmp/tag.json',
      '# fixture', ?, '2026-08-03', 'manual-tag-route-integration'
    )
  `).run(HASH).lastInsertRowid);
}

test.beforeEach(resetState);
test.after(async () => { await closeServer(); });

test('creates, assigns and globally edits a colored manual tag', async () => {
  const generationId = seedGeneration();
  const created = await api('POST', '/api/manual-tags', {
    body: { name: '本周重点', category: 'priority', color: 'red' },
  });
  assert.equal(created.status, 201);
  assert.equal(created.body.tag.name, '本周重点');
  assert.equal(created.body.tag.color, 'red');

  const assigned = await api('PUT', '/api/manual-tags/assignments/current', {
    body: { targetKind: 'generation', targetId: generationId, tagIds: [created.body.tag.id] },
  });
  assert.equal(assigned.status, 200);
  assert.deepEqual(assigned.body.tags.map((tag) => tag.name), ['本周重点']);

  const renamed = await api('PATCH', `/api/manual-tags/${created.body.tag.id}`, {
    body: {
      expectedVersion: created.body.tag.version,
      name: '本月重点',
      category: 'priority',
      color: 'purple',
    },
  });
  assert.equal(renamed.status, 200);
  assert.equal(renamed.body.tag.version, 2);

  const listed = await api(
    'GET', `/api/manual-tags?targetKind=generation&targetId=${generationId}`
  );
  assert.equal(listed.status, 200);
  assert.deepEqual(listed.body.assignedTagIds, [created.body.tag.id]);
  assert.equal(listed.body.tags[0].name, '本月重点');
  assert.equal(listed.body.tags[0].color, 'purple');

  const targets = await api('GET', `/api/manual-tags/${created.body.tag.id}/targets`);
  assert.equal(targets.status, 200);
  assert.deepEqual(targets.body.targets.map((target) => ({
    targetKind: target.targetKind,
    targetId: target.targetId,
    title: target.title,
  })), [{ targetKind: 'generation', targetId: generationId, title: 'manual tag fixture' }]);
});

test('rejects duplicate names, stale edits and missing targets', async () => {
  const first = await api('POST', '/api/manual-tags', {
    body: { name: '口语', category: 'skill', color: 'blue' },
  });
  assert.equal(first.status, 201);
  const duplicate = await api('POST', '/api/manual-tags', {
    body: { name: ' 口语 ', category: 'custom', color: 'gray' },
  });
  assert.equal(duplicate.status, 409);
  assert.equal(duplicate.body.code, 'MANUAL_TAG_NAME_CONFLICT');

  const stale = await api('PATCH', `/api/manual-tags/${first.body.tag.id}`, {
    body: { expectedVersion: 99, name: '会话', color: 'cyan', category: 'skill' },
  });
  assert.equal(stale.status, 409);
  assert.equal(stale.body.code, 'MANUAL_TAG_VERSION_CONFLICT');

  const missing = await api('PUT', '/api/manual-tags/assignments/current', {
    body: { targetKind: 'knowledge_point', targetId: 999, tagIds: [first.body.tag.id] },
  });
  assert.equal(missing.status, 404);
  assert.equal(missing.body.code, 'MANUAL_TAG_TARGET_NOT_FOUND');
});

test('archives tags without deleting their assignment audit rows', async () => {
  const generationId = seedGeneration();
  const created = await api('POST', '/api/manual-tags', {
    body: { name: '临时标签', category: 'custom', color: 'gray' },
  });
  await api('PUT', '/api/manual-tags/assignments/current', {
    body: { targetKind: 'generation', targetId: generationId, tagIds: [created.body.tag.id] },
  });
  const archived = await api('DELETE', `/api/manual-tags/${created.body.tag.id}`, {
    body: { expectedVersion: 1 },
  });
  assert.equal(archived.status, 200);
  assert.equal(archived.body.tag.status, 'archived');
  assert.equal(
    dbService.db.prepare('SELECT COUNT(*) AS count FROM manual_tag_assignments').get().count,
    1
  );
  const active = await api(
    'GET', `/api/manual-tags?targetKind=generation&targetId=${generationId}`
  );
  assert.deepEqual(active.body.assignedTagIds, []);
});
