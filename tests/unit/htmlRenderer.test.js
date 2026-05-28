'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { buildAudioTasksFromMarkdown } = require('../../services/generation/htmlRenderer');

test.describe('buildAudioTasksFromMarkdown', () => {
  test.it('returns [] for falsy input', () => {
    assert.deepEqual(buildAudioTasksFromMarkdown(''), []);
    assert.deepEqual(buildAudioTasksFromMarkdown(null), []);
    assert.deepEqual(buildAudioTasksFromMarkdown(undefined), []);
  });

  test.it('extracts English examples under the 英文 section', () => {
    const md = [
      '# Phrase',
      '## 1. 英文',
      '- **例句1**: Hello world.',
      '- **例句2**: Goodbye.',
    ].join('\n');
    const tasks = buildAudioTasksFromMarkdown(md);
    assert.equal(tasks.length, 2);
    assert.equal(tasks[0].lang, 'en');
    assert.equal(tasks[0].text, 'Hello world.');
    assert.equal(tasks[0].filename_suffix, '_en_1');
    assert.equal(tasks[1].text, 'Goodbye.');
    assert.equal(tasks[1].filename_suffix, '_en_2');
  });

  test.it('extracts Japanese examples under 日本語 / 日语', () => {
    const md = [
      '## 1. 日本語',
      '- **例句1**: こんにちは。',
      '## 2. 日语',
      '- **例句1**: さようなら。',
    ].join('\n');
    const tasks = buildAudioTasksFromMarkdown(md);
    // Both headings map to ja; suffix is per-section index from the markdown.
    assert.equal(tasks.length, 2);
    assert.ok(tasks.every((t) => t.lang === 'ja'));
  });

  test.it('ignores examples outside an 英文 / 日本語 section', () => {
    const md = [
      '## 1. 中文',
      '- **例句1**: 不应该被音频化。',
      '## 2. 英文',
      '- **例句1**: Only this one.',
    ].join('\n');
    const tasks = buildAudioTasksFromMarkdown(md);
    assert.equal(tasks.length, 1);
    assert.equal(tasks[0].text, 'Only this one.');
  });

  test.it('strips inline markdown formatting from the example text', () => {
    const md = [
      '## 1. 英文',
      '- **例句1**: A **bold** word with `code` inside.',
    ].join('\n');
    const tasks = buildAudioTasksFromMarkdown(md);
    assert.equal(tasks.length, 1);
    assert.ok(!tasks[0].text.includes('**'));
    assert.ok(!tasks[0].text.includes('`'));
  });

  test.it('mixes EN + JA correctly across sections', () => {
    const md = [
      '## 1. 英文',
      '- **例句1**: One.',
      '## 2. 日本語',
      '- **例句1**: ひとつ。',
      '- **例句2**: ふたつ。',
    ].join('\n');
    const tasks = buildAudioTasksFromMarkdown(md);
    assert.deepEqual(
      tasks.map((t) => `${t.lang}:${t.filename_suffix}`),
      ['en:_en_1', 'ja:_ja_1', 'ja:_ja_2']
    );
  });
});
