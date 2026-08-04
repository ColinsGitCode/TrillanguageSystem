'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const { DatabaseService } = require('../../services/storage/databaseService');
const {
  buildTokens,
  createPronunciationService,
  locateJapaneseSegments,
  stripMarkdownToJapaneseText,
  toHiragana,
  isUnresolvedHanResidue,
} = require('../../services/pronunciation/pronunciationService');

function insertGeneration(db, markdown = '# sample\n\n## 2. 日本語:\n- **例句1**: 勤務表を確認します。') {
  const contentHash = 'a'.repeat(64);
  return Number(db.prepare(`
    INSERT INTO generations(
      phrase, phrase_language, card_type, source_mode, llm_provider, llm_model,
      folder_name, base_filename, md_file_path, html_file_path, meta_file_path,
      markdown_content, content_hash, generation_date, request_id
    ) VALUES (?, 'ja', 'trilingual', 'input', 'deepseek', 'deepseek-v4-pro',
      '20260803', 'pronunciation-test', '/tmp/a.md', '/tmp/a.html', '/tmp/a.json', ?, ?, '2026-08-03', ?)
  `).run('sample', markdown, contentHash, `pronunciation-test-${Date.now()}-${Math.random()}`).lastInsertRowid);
}

test('converts analyzer katakana to hiragana deterministically', () => {
  assert.equal(toHiragana('キンムヒョウ'), 'きんむひょう');
  assert.equal(toHiragana('カタカナABC'), 'かたかなABC');
});

test('identifies unresolved Han-only analyzer residue without rejecting normal Japanese readings', () => {
  assert.equal(isUnresolvedHanResidue({ basic_form: '*', reading: undefined }, '风'), true);
  assert.equal(isUnresolvedHanResidue({ basic_form: '来月', reading: 'ライゲツ' }, '来月'), false);
  assert.equal(isUnresolvedHanResidue({ basic_form: '*', reading: 'キンム' }, '勤務'), false);
  assert.equal(isUnresolvedHanResidue({ basic_form: '*', reading: undefined }, '勤務表を'), false);
});

test('dictionary entries override Kuromoji readings and preserve word boundaries', async () => {
  const result = await buildTokens('勤務表 一人 取り扱い説明書');
  assert.deepEqual(result.tokens.map((token) => [token.surface, token.readingHiragana, token.source]), [
    ['勤務表', 'きんむひょう', 'dictionary'],
    ['一人', 'ひとり', 'dictionary'],
    ['取り扱い説明書', 'とりあつかいせつめいしょ', 'dictionary'],
  ]);
});

test('legacy Ruby is read into a plain projection without changing source Markdown', async () => {
  const result = await buildTokens('勤務表を確認します', {
    legacyMarkdown: '## 2. 日本語:\n- <ruby>勤務表<rt>きんむひょう</rt></ruby>を確認します',
  });
  assert.match(result.plainText, /勤務表を確認します/u);
  assert.equal(result.tokens[0].source, 'dictionary');
  assert.equal(result.tokens[0].readingHiragana, 'きんむひょう');
});

test('generation projection analyzes Japanese sections without treating Chinese cues as Japanese', async () => {
  const markdown = [
    '# 勤務表',
    '## 1. 英文:',
    '- **解释**: A Chinese explanation.',
    '## 2. 日本語:',
    '- **例句1**: 勤務表を確認します。',
    '  - 中文翻译：查看工作表。',
    '## 3. 中文:',
    '- **解释**: 勤务表是工作安排表。',
  ].join('\n');
  const plainText = stripMarkdownToJapaneseText(markdown);
  const result = await buildTokens(plainText, {
    japaneseSegments: locateJapaneseSegments(markdown, plainText),
  });
  assert.ok(result.tokens.some((token) => token.surface === '勤務表'));
  assert.equal(result.tokens.some((token) => token.surface === '工作'), false);
  assert.equal(result.tokens.some((token) => token.surface === '查看'), false);
});

test('skips Han-only analyzer residue when it has no Japanese reading', async () => {
  const result = await buildTokens('风 语 标 无 勤務表 来月');
  assert.equal(result.tokens.some((token) => ['风', '语', '标', '无'].includes(token.surface)), false);
  assert.deepEqual(result.skippedTokens.map((token) => token.surface), ['风', '语', '标', '无']);
  assert.ok(result.tokens.some((token) => token.surface === '勤務表' && token.status === 'accepted'));
  assert.ok(result.tokens.some((token) => token.surface === '来月' && token.status === 'accepted'));
});

test('scenario projection only analyzes 日本語 expression fields', async () => {
  const markdown = [
    '# 复诊',
    '## 2. 常用表达',
    '### 01.',
    '- **中文**: 我想复诊。',
    '- **英文**: I am here for a follow-up.',
    '- **日本語**: 一人で勤務表を確認します。',
    '- **使用提示**: 这是中文提示。',
  ].join('\n');
  const plainText = stripMarkdownToJapaneseText(markdown);
  const result = await buildTokens(plainText, {
    japaneseSegments: locateJapaneseSegments(markdown, plainText),
  });
  assert.deepEqual(result.tokens.filter((token) => token.surface === '一人').map((token) => token.readingHiragana), ['ひとり']);
  assert.equal(result.tokens.some((token) => token.surface === '复诊'), false);
});

test('generation document creation and correction are revision guarded and idempotent', async () => {
  const dbService = new DatabaseService(':memory:');
  try {
    const generationId = insertGeneration(dbService.db);
    const service = createPronunciationService({ dbService, now: () => '2026-08-03T00:00:00.000Z' });
    const first = await service.ensureGeneration(generationId);
    assert.equal(first.document.status, 'ready');
    assert.ok(first.tokens.length > 0);
    const token = first.tokens[0];
    const corrected = await service.correct({
      targetId: generationId,
      sourceContentHash: 'a'.repeat(64),
      tokenKey: token.tokenKey,
      eventKey: 'pron-event-001',
      eventType: 'reading',
      expectedRevision: first.document.revision,
      readingRaw: 'キンムヒョウ',
      readingHiragana: 'きんむひょう',
    });
    assert.equal(corrected.document.revision, 2);
    const repeated = await service.correct({
      targetId: generationId,
      sourceContentHash: 'a'.repeat(64),
      tokenKey: token.tokenKey,
      eventKey: 'pron-event-001',
      eventType: 'reading',
      expectedRevision: 1,
      readingRaw: 'キンムヒョウ',
      readingHiragana: 'きんむひょう',
    });
    assert.equal(repeated.idempotent, true);
    await assert.rejects(
      () => service.correct({
        targetId: generationId,
        sourceContentHash: 'a'.repeat(64),
        tokenKey: token.tokenKey,
        eventKey: 'pron-event-002',
        eventType: 'reading',
        expectedRevision: 1,
        readingRaw: '別',
        readingHiragana: 'べつ',
      }),
      (error) => error.code === 'PRONUNCIATION_REVISION_STALE'
    );
  } finally {
    dbService.close();
  }
});

test('split and merge corrections change token boundaries only after validating contiguous source ranges', async () => {
  const dbService = new DatabaseService(':memory:');
  try {
    const generationId = insertGeneration(dbService.db);
    const service = createPronunciationService({ dbService, now: () => '2026-08-03T00:00:00.000Z' });
    const projection = await service.ensureGeneration(generationId);
    const token = projection.tokens.find((item) => item.surface === '勤務表');
    assert.ok(token);
    const splitPoint = token.startCodePoint + 2;
    const splitPayload = {
      targetId: generationId,
      tokenKey: token.tokenKey,
      eventKey: 'pron-split-001',
      eventType: 'split',
      expectedRevision: projection.document.revision,
      parts: [
        { surface: '勤務', startCodePoint: token.startCodePoint, endCodePoint: splitPoint, readingHiragana: 'きんむ' },
        { surface: '表', startCodePoint: splitPoint, endCodePoint: token.endCodePoint, readingHiragana: 'ひょう' },
      ],
    };
    const split = await service.correct(splitPayload);
    assert.equal(split.document.revision, 2);
    assert.deepEqual(split.tokens.filter((item) => item.tokenKey.startsWith(`${token.tokenKey}:split:`)).map((item) => item.surface), ['勤務', '表']);
    const repeated = await service.correct(splitPayload);
    assert.equal(repeated.idempotent, true);

    const splitKeys = split.tokens.filter((item) => item.tokenKey.startsWith(`${token.tokenKey}:split:`)).map((item) => item.tokenKey);
    const merged = await service.correct({
      targetId: generationId,
      tokenKey: splitKeys[0],
      tokenKeys: splitKeys,
      eventKey: 'pron-merge-001',
      eventType: 'merge',
      expectedRevision: split.document.revision,
      readingHiragana: 'きんむひょう',
    });
    assert.equal(merged.document.revision, 3);
    assert.ok(merged.tokens.some((item) => item.surface === '勤務表' && item.source === 'manual'));
    assert.equal(dbService.db.prepare('SELECT COUNT(*) AS count FROM pronunciation_correction_events').get().count, 2);
  } finally {
    dbService.close();
  }
});
