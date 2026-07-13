'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  analyzeMarkdown,
  contentHash,
  inferLanguage,
  inferSource,
  inferTestCandidate,
  folderNameToGenerationDate,
  normalizeMarkdown,
  normalizeTagValue,
  repairMarkdownStructure,
} = require('../../services/dataPreparation/rules');
const { resolveGenerationDate } = require('../../services/storage/databaseHelpers');
const { projectionFor } = require('../../scripts/maintenance/syncCanonicalMarkdown');

test.describe('data preparation rules', () => {
  test.it('normalizes line endings before hashing', () => {
    assert.equal(normalizeMarkdown('a\r\nb\r'), 'a\nb\n');
    assert.equal(contentHash('a\r\nb'), contentHash('a\nb'));
  });

  test.it('derives the visible generation date from a valid archive folder', () => {
    assert.equal(folderNameToGenerationDate('20260713'), '2026-07-13');
    assert.equal(folderNameToGenerationDate('20260230'), null);
    assert.equal(folderNameToGenerationDate('kindergarten'), null);
    assert.equal(resolveGenerationDate('20260713', new Date('2020-01-01T00:00:00Z')), '2026-07-13');
  });

  test.it('repairs only deterministic Markdown structure defects', () => {
    const record = { id: 1, phrase: 'sample' };
    assert.equal(
      repairMarkdownStructure(record, 'preamble\n## 1. 英文:\nbody', 'prefix-title-before-first-section'),
      '# sample\n## 1. 英文:\nbody'
    );
    assert.equal(repairMarkdownStructure(record, '## sample\nbody', 'promote-first-heading'), '# sample\nbody');
    assert.equal(
      repairMarkdownStructure(record, 'MCP error.# sample\nbody', 'recover-inline-title'),
      '# sample\nbody'
    );
  });

  test.it('uses conservative input-language inference', () => {
    assert.equal(inferLanguage({ card_type: 'trilingual', phrase: '数据库' }).value, 'unknown');
    assert.equal(inferLanguage({ card_type: 'trilingual', phrase: '食欲があります' }).value, 'ja');
    assert.equal(inferLanguage({ card_type: 'trilingual', phrase: 'API设计' }).value, 'mixed');
    assert.equal(inferLanguage({ card_type: 'grammar_ja', phrase: '比較' }).value, 'ja');
    assert.equal(inferLanguage({ card_type: 'scenario_phrase', phrase: '空调维修预约' }).value, 'zh');
  });

  test.it('only assigns source from trusted metadata or the import manifest', () => {
    assert.equal(inferSource({ id: 1, source_mode: 'input' }).value, 'input');
    assert.equal(inferSource({ id: 846, source_mode: null }).value, 'hoikuen-import');
    assert.equal(inferSource({ id: 2, source_mode: null }).value, 'unknown');
  });

  test.it('keeps broad validation text out of automatic QA confirmation', () => {
    assert.equal(inferTestCandidate({ id: 929, phrase: '空调维修（二次验证）' }), null);
    assert.equal(inferTestCandidate({ id: 496, phrase: '压测' }).value, 'test-artifact-candidate');
  });

  test.it('normalizes free tag comparison values', () => {
    assert.equal(normalizeTagValue('  Ｎ２  '), 'n2');
  });

  test.it('recognizes a complete trilingual card', () => {
    const markdown = `# card
## 1. 英文:
- **例句1**: One
- **例句2**: Two
## 2. 日本語:
- **例句1**: 一
- **例句2**: 二
## 3. 中文:
- **翻译**: 卡片`;
    const result = analyzeMarkdown({ card_type: 'trilingual' }, markdown);
    assert.equal(result.hasTitle, true);
    assert.equal(result.sections, true);
    assert.equal(result.examples, true);
    assert.equal(result.expectedAudio, true);
  });

  test.it('rebuilds trilingual translation projections with the parser', () => {
    const projection = projectionFor({ card_type: 'trilingual' }, `# card
## 1. 英文:
- **翻译**: English
## 2. <ruby>日本語<rt>にほんご</rt></ruby>:
- **翻訳**: 日本語
## 3. 中文:
- **翻译**: 中文`);
    assert.deepEqual(projection, {
      en_translation: 'English',
      ja_translation: '日本語',
      zh_translation: '中文',
    });
  });
});
