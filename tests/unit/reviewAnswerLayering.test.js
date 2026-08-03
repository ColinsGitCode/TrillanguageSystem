'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

async function split(markdown) {
  const { splitReviewAnswerMarkdown } = await import('../../app/features/learning/review-answer-layering.mjs');
  return splitReviewAnswerMarkdown(markdown);
}

test('moves supplementary grammar sections out of the core answer', async () => {
  const result = await split([
    '## 1. 用法',
    'Core usage.',
    '## 2. 例句',
    'Core example.',
    '## 3. 常见误用',
    'Supplementary warning.',
  ].join('\n\n'));

  assert.match(result.coreMarkdown, /Core usage/);
  assert.match(result.coreMarkdown, /Core example/);
  assert.doesNotMatch(result.coreMarkdown, /Supplementary warning/);
  assert.match(result.supplementaryMarkdown, /常见误用/);
  assert.equal(result.supplementarySectionCount, 1);
});

test('keeps trilingual Chinese sections in the core answer', async () => {
  const result = await split([
    '## 1. English',
    'English answer.',
    '## 2. 日本語',
    'Japanese answer.',
    '## 3. 中文',
    'Chinese answer.',
  ].join('\n\n'));

  assert.match(result.coreMarkdown, /Chinese answer/);
  assert.equal(result.supplementaryMarkdown, '');
  assert.equal(result.supplementarySectionCount, 0);
});

test('returns to core content after a supplementary section', async () => {
  const result = await split([
    '## 1. 核心',
    'Core first.',
    '## 2. 补充',
    'Supplementary.',
    '## 3. 练习',
    'Core again.',
  ].join('\n\n'));

  assert.match(result.supplementaryMarkdown, /Supplementary/);
  assert.doesNotMatch(result.supplementaryMarkdown, /Core again/);
  assert.match(result.coreMarkdown, /Core again/);
});
