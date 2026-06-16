'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  buildAudioTasksFromMarkdown,
  prepareMarkdownForCard,
} = require('../../services/generation/htmlRenderer');

function scenarioMarkdown(count = 12) {
  const lines = [
    '# 空港で道を尋ねる',
    '## 1. 场景说明',
    '- **角色**: 旅行者と駅員',
    '- **语气**: 丁寧',
    '- **目标**: 乗り場を確認する',
    '## 2. 常用表达',
  ];
  for (let i = 1; i <= count; i += 1) {
    const padded = String(i).padStart(2, '0');
    lines.push(
      `### ${padded}. 表达标题${i}`,
      `- **中文**: 请问${i}号登机口在哪里？`,
      `- **英文**: Where is gate ${i}?`,
      `- **日本語**: ${i === 1 ? '今日(きょう)' : `搭乗口${i}`}はどこですか。`,
      `- **使用提示**: 确认位置时使用。`
    );
  }
  return lines.join('\n');
}

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

  test.it('extracts 24 scenario expression audio tasks with deterministic suffixes', () => {
    const tasks = buildAudioTasksFromMarkdown(scenarioMarkdown());

    assert.equal(tasks.length, 24);
    assert.deepEqual(
      tasks.map((task) => `${task.lang}:${task.filename_suffix}`),
      Array.from({ length: 12 }, (_, index) => {
        const number = index + 1;
        return [`en:_en_${number}`, `ja:_ja_${number}`];
      }).flat()
    );
    assert.equal(tasks[0].text, 'Where is gate 1?');
    assert.equal(tasks[23].text, '搭乗口12はどこですか。');
  });

  test.it('strips explicit Japanese readings before TTS text is built', () => {
    const tasks = buildAudioTasksFromMarkdown(scenarioMarkdown(1));

    const japaneseTask = tasks.find((task) => task.lang === 'ja');
    assert.equal(japaneseTask.text, '今日はどこですか。');
  });

  test.it('injects audio tags into scenario English and Japanese lines', async () => {
    const markdown = scenarioMarkdown(2);
    const tasks = buildAudioTasksFromMarkdown(markdown);

    const prepared = await prepareMarkdownForCard(markdown, {
      baseName: 'scenario-card',
      audioTasks: tasks,
    });

    assert.match(
      prepared,
      /- \*\*英文\*\*: Where is gate 1\? <audio src="scenario-card_en_1\.mp3"><\/audio>/
    );
    assert.match(
      prepared,
      /- \*\*日本語\*\*: .* <audio src="scenario-card_ja_1\.wav"><\/audio>/
    );
    assert.match(
      prepared,
      /- \*\*英文\*\*: Where is gate 2\? <audio src="scenario-card_en_2\.mp3"><\/audio>/
    );
    assert.match(
      prepared,
      /- \*\*日本語\*\*: .* <audio src="scenario-card_ja_2\.wav"><\/audio>/
    );
  });
});
