'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const {
  extractStudyUnitMarkdown,
  labeledValue,
  scenarioAudioMatches,
} = require('../../services/learning/domain/studyItemContent');

const markdown = `# 场景

## 2. 常用表达

### 01.
- **中文**: 请给我一杯水。
- **英文**: A glass of water, please. <audio src="water_en_1.mp3"></audio>
- **日本語**: お水をください。 <audio src="water_ja_1.wav"></audio>
- **使用提示**: 礼貌请求。

### 02.
- **中文**: 请给我账单。
- **英文**: The bill, please. <audio src="water_en_2.mp3"></audio>
- **日本語**: お会計をお願いします。 <audio src="water_ja_2.wav"></audio>
`;

test.describe('Study Item Markdown extraction', () => {
  test.it('extracts exactly one scenario expression from its structured locator', () => {
    const section = extractStudyUnitMarkdown(markdown, 'scenario_bilingual', { ordinal: 2, sourceHeading: '02' });
    assert.match(section, /^### 02\./u);
    assert.match(section, /The bill, please/u);
    assert.doesNotMatch(section, /glass of water/u);
    assert.equal(labeledValue(section, '中文'), '请给我账单。');
    assert.equal(labeledValue(section, '英文'), 'The bill, please.');
    assert.equal(labeledValue(section, '日本語'), 'お会計をお願いします。');
  });

  test.it('filters scenario audio by locator ordinal', () => {
    assert.equal(scenarioAudioMatches({ filename_suffix: '_en_2' }, { ordinal: 2 }), true);
    assert.equal(scenarioAudioMatches({ filename_suffix: '_ja_2' }, { ordinal: 2 }), true);
    assert.equal(scenarioAudioMatches({ filename_suffix: '_en_1' }, { ordinal: 2 }), false);
  });

  test.it('extracts the requested trilingual language section', () => {
    const card = '# word\n## 1. 英文:\n- **翻译**: word\n## 2. 日本語:\n- **翻訳**: 単語\n## 3. 中文:\n- **翻译**: 单词';
    assert.match(extractStudyUnitMarkdown(card, 'trilingual_en'), /翻译.*word/u);
    assert.doesNotMatch(extractStudyUnitMarkdown(card, 'trilingual_en'), /単語/u);
    assert.match(extractStudyUnitMarkdown(card, 'trilingual_ja'), /単語/u);
    assert.doesNotMatch(extractStudyUnitMarkdown(card, 'trilingual_ja'), /单词/u);
  });
});
