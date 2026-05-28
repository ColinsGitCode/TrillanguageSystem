'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

process.env.LOG_SILENT = '1';

const { QualityChecker } = require('../../services/observability/observabilityService');

// A "good" trilingual card. The markdown structure matches services/
// markdownParser.js conventions: `## 1. 英文` / `## 2. 日本語` / `## 3. 中文`
// with `- **翻译**:` / `- **解释**:` / `- **例句1**:` / `- **例句X翻译**:`.
function buildGoodCard() {
  const markdown = [
    '# persistent state',
    '',
    '## 1. 英文',
    '- **翻译**: persistent state',
    '- **解释**: A state that survives restarts and reloads.',
    '- **例句1**: Saving session state lets users resume work later.',
    '- **例句1翻译**: Saving session state lets users resume work later.',
    '- **例句2**: Browsers cache persistent state in localStorage.',
    '- **例句2翻译**: Browsers cache persistent state in localStorage.',
    '',
    '## 2. 日本語',
    '- **翻訳**: 永続状態 (えいぞくじょうたい)',
    '- **解释**: 再起動やリロード後も残る状態。',
    '- **例句1**: ブラウザは永続状態を localStorage に保存する。',
    '- **例句1翻译**: Browsers cache persistent state in localStorage.',
    '- **例句2**: セッション状態を保存すると後で再開できる。',
    '- **例句2翻译**: Saving session state lets users resume work later.',
    '',
    '## 3. 中文',
    '- **翻译**: 持续状态',
    '- **解释**: 重启或刷新后仍然保留的状态。',
    '',
  ].join('\n');
  return {
    markdown_content: markdown,
    html_content: '<html><body><h1>persistent state</h1></body></html>',
    audio_tasks: [
      { lang: 'en', text: 'persistent state', filename_suffix: '_en_1' },
      { lang: 'ja', text: '永続状態', filename_suffix: '_ja_1' }
    ]
  };
}

test.describe('QualityChecker.isValidJSON / hasRequiredFields', () => {
  test.it('isValidJSON: false for null, true for objects', () => {
    assert.equal(QualityChecker.isValidJSON(null), false);
    assert.equal(QualityChecker.isValidJSON('string'), false);
    assert.equal(QualityChecker.isValidJSON({}), true);
  });

  test.it('hasRequiredFields requires non-empty markdown_content + html_content', () => {
    assert.equal(QualityChecker.hasRequiredFields({}), false);
    assert.equal(QualityChecker.hasRequiredFields({ markdown_content: '', html_content: '<p></p>' }), false);
    assert.equal(QualityChecker.hasRequiredFields({ markdown_content: 'x', html_content: '<p></p>' }), true);
  });
});

test.describe('QualityChecker.checkTranslation', () => {
  test.it('returns "poor" when the phrase is absent', () => {
    assert.equal(
      QualityChecker.checkTranslation({ markdown_content: 'unrelated content' }, 'apple'),
      'poor'
    );
  });

  test.it('returns "excellent" when all 3 sections have a translation field', () => {
    const card = buildGoodCard();
    assert.equal(
      QualityChecker.checkTranslation(card, 'persistent state'),
      'excellent'
    );
  });
});

test.describe('QualityChecker.hasAudioTasks', () => {
  test.it('true only when audio_tasks is a non-empty array', () => {
    assert.equal(QualityChecker.hasAudioTasks({}), false);
    assert.equal(QualityChecker.hasAudioTasks({ audio_tasks: [] }), false);
    assert.equal(QualityChecker.hasAudioTasks({ audio_tasks: [{}] }), true);
  });
});

test.describe('QualityChecker.calculateOverallScore', () => {
  test.it('sums the four scored dimensions (ignores contentLength)', () => {
    const score = QualityChecker.calculateOverallScore({
      completeness: 40,
      accuracy: 30,
      exampleQuality: 20,
      formatting: 10,
      contentLength: 99999
    });
    assert.equal(score, 100);
  });

  test.it('clamps to [0, 100]', () => {
    assert.equal(
      QualityChecker.calculateOverallScore({ completeness: 200, accuracy: 0, exampleQuality: 0, formatting: 0 }),
      100
    );
    assert.equal(
      QualityChecker.calculateOverallScore({ completeness: -50, accuracy: 0, exampleQuality: 0, formatting: 0 }),
      0
    );
  });
});

test.describe('QualityChecker.check (integration)', () => {
  test.it('a well-formed trilingual card scores high and yields no critical warnings', () => {
    const card = buildGoodCard();
    const result = QualityChecker.check(card, 'persistent state');
    assert.ok(result.score >= 70, `expected >=70, got ${result.score}`);
    assert.equal(result.checks.jsonValid, true);
    assert.equal(result.checks.fieldsComplete, true);
    assert.equal(result.checks.audioTasksGenerated, true);
    assert.ok(!result.warnings.includes('JSON 格式无效'));
    assert.ok(!result.warnings.includes('缺少必需字段'));
  });

  test.it('a totally empty content scores low and surfaces warnings', () => {
    const result = QualityChecker.check({ markdown_content: '', html_content: '' }, 'hello');
    assert.ok(result.score < 50, `expected <50, got ${result.score}`);
    assert.ok(result.warnings.length > 0);
    assert.ok(result.suggestions.length > 0, 'should emit at least one suggestion');
  });
});

test.describe('QualityChecker.calculateTemplateCompliance', () => {
  test.it('100 when every required field is present', () => {
    const compliance = QualityChecker.calculateTemplateCompliance({
      title: 'persistent state',
      sections: {
        en: { translation: 'a', explanation: 'b', examples: [{ text: 'x', translation: 'y' }, { text: 'a', translation: 'b' }] },
        ja: { translation: '永続', explanation: '解释', examples: [{ text: '例', translation: 'ex' }, { text: '例2', translation: 'ex2' }] },
        zh: { translation: '持续', explanation: '说明' }
      }
    });
    assert.equal(compliance, 100);
  });

  test.it('0 when the parsed object is empty', () => {
    assert.equal(QualityChecker.calculateTemplateCompliance({}), 0);
    assert.equal(QualityChecker.calculateTemplateCompliance(null), 0);
  });
});
