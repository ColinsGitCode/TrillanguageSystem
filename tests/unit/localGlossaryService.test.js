'use strict';

process.env.DB_PATH = ':memory:';
process.env.LOG_SILENT = '1';

const assert = require('node:assert/strict');
const test = require('node:test');
const databaseModule = require('../../services/storage/databaseService');
const { DatabaseService } = databaseModule;
const { LocalGlossaryService } = require('../../services/localGlossary/localGlossaryService');
const { englishAliases, normalizeTerm } = require('../../services/localGlossary/localGlossaryNormalizer');

const HASH = 'a'.repeat(64);

function seedGeneration(service) {
  return Number(service.db.prepare(`
    INSERT INTO generations(
      phrase, phrase_language, card_type, source_mode, llm_provider, llm_model,
      folder_name, base_filename, md_file_path, html_file_path, meta_file_path,
      markdown_content, content_hash, generation_date, request_id
    ) VALUES (
      '勤務表', 'ja', 'trilingual', 'input', 'deepseek', 'deepseek-v4-pro',
      '20260804', 'local-glossary', '/tmp/gloss.md', '/tmp/gloss.html', '/tmp/gloss.json',
      @markdown, @hash, '2026-08-04', @requestId
    )
  `).run({
    hash: HASH,
    requestId: `local-glossary-${Date.now()}-${Math.random()}`,
    markdown: [
      '# 勤務表',
      '## 1. 英文',
      '- **例句1**: I fill in my timesheet every Friday.',
      '  - 我每周五填写考勤表。',
      '## 2. 日本語',
      '- **例句1**: 毎週金曜日に勤務表を記入します。',
      '  - 我每周五填写考勤表。',
    ].join('\n'),
  }).lastInsertRowid);
}

test.after(() => databaseModule.close());

test('normalizes English inflections and a single Japanese conjugation conservatively', async () => {
  assert.ok(englishAliases('studies').includes('study'));
  const japanese = await normalizeTerm('食べた', 'ja');
  assert.ok(japanese.aliases.includes('食べた'));
  assert.equal(japanese.canonicalForm, '食べる');
});

test('reads an exact Chinese example translation from the current card without writing glossary rows', async () => {
  const database = new DatabaseService(':memory:');
  try {
    const generationId = seedGeneration(database);
    const service = new LocalGlossaryService({ database, llmEnabled: false });
    const result = await service.lookup({
      language: 'en',
      text: 'I fill in my timesheet every Friday.',
      generationId,
    });
    assert.equal(result.status, 'exact');
    assert.equal(result.gloss.zhGloss, '我每周五填写考勤表。');
    assert.equal(result.gloss.sourceKind, 'current-card');
    assert.equal(database.db.prepare('SELECT COUNT(*) AS count FROM local_glossary_entries').get().count, 0);
    assert.equal(database.db.prepare('SELECT COUNT(*) AS count FROM local_glossary_proposals').get().count, 0);
  } finally {
    database.close();
  }
});

test('creates, edits and archives a manually confirmed local gloss with optimistic versions', async () => {
  const database = new DatabaseService(':memory:');
  try {
    const service = new LocalGlossaryService({ database, llmEnabled: false });
    const created = await service.createEntry({ language: 'en', canonicalForm: 'timesheet', zhGloss: '考勤表' });
    assert.equal(created.version, 1);
    const lookup = await service.lookup({ language: 'en', text: 'timesheets' });
    assert.equal(lookup.gloss.zhGloss, '考勤表');
    assert.equal(lookup.gloss.sourceKind, 'manual');
    const updated = await service.updateEntry(created.id, {
      expectedVersion: 1,
      canonicalForm: 'timesheet',
      zhGloss: '工时表；考勤表',
    });
    assert.equal(updated.version, 2);
    await assert.rejects(
      service.updateEntry(created.id, { expectedVersion: 1, zhGloss: '旧版本' }),
      (error) => error.code === 'LOCAL_GLOSSARY_VERSION_CONFLICT'
    );
    const archived = service.archiveEntry(created.id, { expectedVersion: 2 });
    assert.equal(archived.status, 'archived');
  } finally {
    database.close();
  }
});

test('keeps DeepSeek output pending until a user accepts an editable Chinese candidate', async () => {
  const database = new DatabaseService(':memory:');
  let calls = 0;
  try {
    const service = new LocalGlossaryService({
      database,
      llmEnabled: true,
      now: () => '2026-08-04T00:00:00.000Z',
      llm: {
        async generateJson() {
          calls += 1;
          return {
            text: JSON.stringify({ zhGloss: '接手；交接', explanation: '工作场景中的责任转移。' }),
            rawOutput: '{"zhGloss":"接手；交接"}',
            model: 'deepseek-v4-pro',
            usage: { input: 10, output: 8, total: 18 },
          };
        },
      },
    });
    const proposed = await service.propose({
      requestKey: 'unit-request-001',
      language: 'en',
      text: 'handoff',
      contextLabel: '工作交接',
    });
    assert.equal(calls, 1);
    assert.equal(proposed.proposal.status, 'pending');
    assert.equal(database.db.prepare('SELECT COUNT(*) AS count FROM local_glossary_entries').get().count, 0);

    const accepted = await service.acceptProposal(proposed.proposal.id, { zhGloss: '工作交接' });
    assert.equal(accepted.proposal.status, 'accepted');
    assert.equal(accepted.entry.zhGloss, '工作交接');
    assert.equal(accepted.entry.sourceKind, 'llm-confirmed');
    const lookup = await service.lookup({ language: 'en', text: 'handoff' });
    assert.equal(lookup.gloss.zhGloss, '工作交接');
  } finally {
    database.close();
  }
});

test('does not call DeepSeek when proposal generation is disabled', async () => {
  const database = new DatabaseService(':memory:');
  try {
    const service = new LocalGlossaryService({
      database,
      llmEnabled: false,
      llm: { generateJson: async () => { throw new Error('must not run'); } },
    });
    await assert.rejects(
      service.propose({ requestKey: 'disabled-request', language: 'ja', text: '勤務表' }),
      (error) => error.code === 'LOCAL_GLOSSARY_LLM_DISABLED'
    );
  } finally {
    database.close();
  }
});
