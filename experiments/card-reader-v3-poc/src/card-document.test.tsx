import assert from 'node:assert/strict';
import test from 'node:test';
import { renderToStaticMarkup } from 'react-dom/server';
import { CardReader } from './CardReader';
import { inlineText, parseCardDocument } from './card-document';

const fixture = `# Fixture

## 1. 英文:
- **例句**: a <mark data-tone="blue">structured card</mark> <audio src="en.mp3"></audio>

## 2. 日本語:
- **翻訳**: <ruby>勤務表<rt>きんむひょう</rt></ruby>

## 3. 中文:
- **翻译**: 排班表

<script>globalThis.compromised = true</script>`;

test('parses a trilingual Markdown card into stable language sections', () => {
  const document = parseCardDocument(fixture);
  assert.equal(document.version, 'card-document-v1');
  assert.equal(document.title, 'Fixture');
  assert.deepEqual(document.sections.map((section) => section.language), ['en', 'ja', 'zh']);
  assert.equal(document.sections.every((section) => section.blocks.length > 0), true);
});
test('turns legacy ruby and audio HTML into controlled nodes', () => {
  const document = parseCardDocument(fixture);
  const json = JSON.stringify(document);
  assert.match(json, /"kind":"pronunciation","surface":"勤務表","reading":"きんむひょう"/u);
  assert.match(json, /"kind":"audio","src":"en.mp3"/u);
  assert.doesNotMatch(json, /<ruby|<audio/u);
});

test('drops unsafe nodes and renders without raw HTML injection', () => {
  const document = parseCardDocument(fixture);
  assert.deepEqual(document.diagnostics.filter((item) => item.code === 'UNSAFE_NODE_DROPPED'), [
    { code: 'UNSAFE_NODE_DROPPED', tag: 'script' },
  ]);
  const html = renderToStaticMarkup(<CardReader document={document} />);
  assert.doesNotMatch(html, /dangerouslySetInnerHTML|<script|<ruby|<rt/u);
  assert.match(html, /aria-label="勤務表，读音 きんむひょう"/u);
  assert.match(html, /aria-label="播放语音"/u);
});

test('keeps the visible text projection free from reading text', () => {
  const document = parseCardDocument(fixture);
  const japanese = document.sections.find((section) => section.language === 'ja');
  const list = japanese?.blocks[0];
  assert.equal(list?.kind, 'list');
  const paragraph = list?.kind === 'list' ? list.items[0][0] : null;
  assert.equal(paragraph?.kind, 'paragraph');
  assert.equal(paragraph?.kind === 'paragraph' ? inlineText(paragraph.children) : '', '翻訳: 勤務表');
});
