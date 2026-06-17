'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { buildPrompt, buildMarkdownPrompt } = require('../../services/generation/promptEngine');

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
    assert.match(prompt, /### 12\./);
    assert.match(prompt, /保育园早上送孩子/);
    assert.doesNotMatch(prompt, /^# 保育园早上送孩子，说明昨晚有点咳嗽$/m);
  });

  test.it('buildPrompt JSON mode requests scenario_phrase JSON with 24 audio tasks', () => {
    const prompt = buildPrompt({
      phrase: '保育园早上送孩子，说明昨晚有点咳嗽',
      filenameBase: 'scenario-fixture',
      cardType: 'scenario_phrase'
    });
    assert.match(prompt, /场景表达卡/);
    assert.match(prompt, /10字以内/);
    assert.match(prompt, /原始场景/);
    assert.match(prompt, /12 个常用表达/);
    assert.match(prompt, /_en_12/);
    assert.match(prompt, /_ja_12/);
    assert.doesNotMatch(prompt, /^# 保育园早上送孩子，说明昨晚有点咳嗽$/m);
  });
});
