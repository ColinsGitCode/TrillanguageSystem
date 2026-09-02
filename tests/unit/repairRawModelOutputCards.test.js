'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { repairMarkdown } = require('../../scripts/maintenance/repairRawModelOutputCards');

const CARD = [
  '# 持续集成',
  '## 1. 英文:',
  '- **翻译**: continuous integration',
  '## 2. 日本語:',
  '- **翻訳**: 継続的インテグレーション',
  '## 3. 中文:',
  '- **翻译**: 持续集成',
].join('\n');

test('leaves a clean card untouched', () => {
  assert.equal(repairMarkdown(`${CARD}\n`), null);
});

test('drops a planning preamble that precedes the card', () => {
  const raw = `好的，我将为“持续集成”生成三语学习卡片。\n现在开始查找日文信息。\n${CARD}\n`;
  assert.equal(repairMarkdown(raw), `${CARD}\n`);
});

test('unwraps a card that the model put inside a markdown fence', () => {
  const raw = `好的，以下是卡片：\n\`\`\`markdown\n${CARD}\n\`\`\`\n`;
  assert.equal(repairMarkdown(raw), `${CARD}\n`);
});

test('keeps only the first copy when the model repeated the whole card', () => {
  assert.equal(repairMarkdown(`${CARD}\n\n${CARD}\n\n${CARD}\n`), `${CARD}\n`);
});

test('handles a preamble, a fence and a repeat at once', () => {
  const raw = `好的，我来生成。\n\`\`\`markdown\n${CARD}\n\n${CARD}\n\`\`\`\n`;
  assert.equal(repairMarkdown(raw), `${CARD}\n`);
});

test('never unwraps a fence that holds real code rather than a card', () => {
  // A genuine code sample has no card sections, so the card must stay put and
  // the fence must survive as content.
  const raw = `${CARD}\n\n\`\`\`js\nconst x = 1;\n\`\`\`\n`;
  assert.equal(repairMarkdown(raw), null);
});

test('refuses a repair that would lose a section the original carried', () => {
  // Only the second copy has section 4. Slicing at the second H1 would drop it,
  // so the row must be left alone for a human rather than silently truncated.
  const raw = `${CARD}\n\n# 持续集成\n## 4. 技术概念简要说明:\n- 补充\n`;
  assert.equal(repairMarkdown(raw), null);
});

test('keeps every section when one card is split across several fences', () => {
  // The 2026-02 batch includes rows where each section sits in its own fence.
  // Extracting one fence would have discarded the others.
  const raw = [
    '好的，以下是卡片：',
    '```markdown',
    '# persistence',
    '## 1. 英文:',
    '- **翻译**: 毅力',
    '```',
    '```markdown',
    '## 2. 日本語:',
    '- **翻訳**: 粘り強さ',
    '```',
    '```markdown',
    '## 3. 中文:',
    '- **翻译**: 持久性',
    '```',
    '',
  ].join('\n');
  const repaired = repairMarkdown(raw);
  assert.ok(repaired.includes('## 1. 英文:'), 'section 1 survives');
  assert.ok(repaired.includes('## 2. 日本語:'), 'section 2 survives');
  assert.ok(repaired.includes('## 3. 中文:'), 'section 3 survives');
  assert.ok(!repaired.includes('```'), 'fence delimiters are gone');
  assert.ok(!repaired.includes('好的'), 'preamble is gone');
});

test('normalises CRLF without reporting a change of its own', () => {
  assert.equal(repairMarkdown(CARD.replace(/\n/g, '\r\n') + '\r\n'), null);
});

test('returns null for empty or section-less input', () => {
  assert.equal(repairMarkdown(''), null);
  assert.equal(repairMarkdown('好的，这是一段没有卡片的文字。'), null);
});

test('refuses a row whose repaired body would still repeat a section', () => {
  // A duplicate copy without its own H1 slips past the H1-based dedupe, so the
  // section guard has to catch it. Half-fixing is worse than not touching it.
  const raw = `好的：\n${CARD}\n## 1. 英文:\n- **翻译**: continuous integration\n`;
  assert.equal(repairMarkdown(raw), null);
});

test('refuses any result that is not demonstrably one clean card', () => {
  // Unwrapping a fence can expose a second H1 that was hidden inside it. The
  // structural check is the backstop for shapes the rules did not anticipate.
  const raw = ['好的：', '```markdown', '# a', '## 1. 英文:', '- x', '```', '# b', '## 1. 英文:', '- y', ''].join('\n');
  assert.equal(repairMarkdown(raw), null);
});
