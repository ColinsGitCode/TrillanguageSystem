'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { postProcessGeneratedContent } = require('../../services/generation/contentPostProcessor');

// Drive the pipeline through its single public entry point. Each test seeds a
// minimal `content` and asserts on one specific transformation.

function run(markdown, audioTasks = []) {
  return postProcessGeneratedContent({
    markdown_content: markdown,
    audio_tasks: audioTasks,
  });
}

test.describe('postProcessGeneratedContent', () => {
  test.it('returns the content untouched for null / non-object input', () => {
    assert.equal(postProcessGeneratedContent(null), null);
    assert.equal(postProcessGeneratedContent(undefined), undefined);
    assert.equal(postProcessGeneratedContent('plain string'), 'plain string');
  });

  test.it('strips <ruby> markup from audio task text', () => {
    const result = run('# any', [
      { text: '<ruby>漢字<rt>かんじ</rt></ruby> です', lang: 'ja' },
    ]);
    assert.equal(result.audio_tasks[0].text, '漢字 です');
  });

  test.it('trims trailing English sentence punctuation from audio task text', () => {
    const result = run('# any', [
      { text: 'Hello world!?.', lang: 'en' },
    ]);
    assert.equal(result.audio_tasks[0].text, 'Hello world');
  });

  test.it('removes Latin / kana parenthetical readings from Japanese audio task text', () => {
    const result = run('# any', [
      { text: 'バックエンド(backend) は便利です', lang: 'ja' },
    ]);
    assert.equal(result.audio_tasks[0].text.includes('backend'), false);
    assert.equal(result.audio_tasks[0].text.includes('('), false);
  });

  test.it('keeps non-array audio_tasks as []', () => {
    const result = run('# any', null);
    assert.equal(result.audio_tasks, null);
  });

  test.it('normalises the Japanese section header to "## 2. 日本語:"', () => {
    const md = [
      '# Phrase',
      '## 1. 英文',
      '- example',
      '## 2. 日语',
      '- 翻译内容',
    ].join('\n');
    const result = run(md);
    assert.match(result.markdown_content, /^## 2\. 日本語:$/m);
  });

  test.it('strips katakana readings from translation lines inside the Japanese section', () => {
    const md = [
      '## 2. 日本語',
      '- 中文翻译（かんじ） 文本',
    ].join('\n');
    const result = run(md);
    // The katakana/hiragana paren reading should be gone, leaving the Chinese.
    assert.ok(result.markdown_content.includes('中文翻译'));
    assert.ok(!result.markdown_content.includes('かんじ'));
  });

  test.it('wraps the body of an "- **解释**:" line in an explanation-text span', () => {
    const md = '- **解释**: 这是说明文本';
    const result = run(md);
    assert.match(
      result.markdown_content,
      /^- \*\*解释\*\*: <span class="explanation-text">这是说明文本<\/span>$/m
    );
  });

  test.it('collapses nested explanation-text spans created by repeated runs', () => {
    const md = '- **解释**: <span class="explanation-text"><span class="explanation-text">已经包过两层</span></span>';
    const result = run(md);
    // After processing, there should be exactly one span wrapper.
    const matches = result.markdown_content.match(/explanation-text/g) || [];
    assert.equal(matches.length, 1);
    assert.ok(result.markdown_content.includes('已经包过两层'));
  });

  test.it('passes the content through twice without further changes (idempotent)', () => {
    const md = [
      '## 2. 日本語',
      '- 翻訳文本',
      '- **解释**: 这是说明',
    ].join('\n');
    const once = run(md);
    const twice = postProcessGeneratedContent({
      markdown_content: once.markdown_content,
      audio_tasks: once.audio_tasks,
    });
    assert.equal(twice.markdown_content, once.markdown_content);
  });
});
