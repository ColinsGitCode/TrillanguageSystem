'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { buildPrompt, buildMarkdownPrompt } = require('../../services/generation/promptEngine');

test.describe('promptEngine trilingual language contract', () => {
  test.it('requires English definitions while preserving Chinese example translations', () => {
    for (const prompt of [
      buildMarkdownPrompt({ phrase: 'stuff', cardType: 'trilingual' }),
      buildPrompt({ phrase: 'stuff', filenameBase: 'stuff', cardType: 'trilingual' }),
    ]) {
      assert.match(prompt, /“翻译”“解释”和例句正文必须使用英文/);
      assert.match(prompt, /英文例句下方的缩进译文保留中文/);
      assert.match(prompt, /完整中文释义统一放在“## 3\. 中文”中/);
    }
  });
});

test.describe('promptEngine scenario_phrase routing', () => {
  test.it('buildMarkdownPrompt uses the scenario expression template', () => {
    const prompt = buildMarkdownPrompt({
      phrase: '保育园早上送孩子，说明昨晚有点咳嗽',
      cardType: 'scenario_phrase'
    });
    assert.match(prompt, /场景表达卡/);
    assert.match(prompt, /10字以内/);
    assert.match(prompt, /原始场景/);
    assert.match(prompt, /## 2\. 常用表达/);
    assert.match(prompt, /### 20\./);
    assert.match(prompt, /保育园早上送孩子/);
    assert.doesNotMatch(prompt, /^# 保育园早上送孩子，说明昨晚有点咳嗽$/m);
  });

  test.it('buildPrompt JSON mode requests scenario_phrase JSON with 40 audio tasks', () => {
    const prompt = buildPrompt({
      phrase: '保育园早上送孩子，说明昨晚有点咳嗽',
      filenameBase: 'scenario-fixture',
      cardType: 'scenario_phrase'
    });
    assert.match(prompt, /场景表达卡/);
    assert.match(prompt, /10字以内/);
    assert.match(prompt, /原始场景/);
    assert.match(prompt, /20 个常用表达/);
    assert.match(prompt, /40 项/);
    assert.match(prompt, /_en_20/);
    assert.match(prompt, /_ja_20/);
    assert.doesNotMatch(prompt, /^# 保育园早上送孩子，说明昨晚有点咳嗽$/m);
  });
});
