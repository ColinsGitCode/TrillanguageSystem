'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const { JSDOM } = require('jsdom');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

function moduleUrl(file) {
  return pathToFileURL(path.resolve(__dirname, '..', '..', 'app', 'features', 'card-modal', file)).href;
}

const TRILINGUAL = `# 没关系

## 1. 英文:
- **翻译**: It's no big deal.
- **解释**: <span class="explanation-text">A casual phrase used to tell someone that something is not a problem.</span>
- **例句1**: Don't worry about spilling the coffee — it's no big deal. <audio src="没关系_en_1.mp3"></audio>
  - 别担心洒了咖啡——没关系的。

## 2. 日本語:
- **翻訳**: 大丈夫だよ。
- **解説**: <span class="explanation-text">相手の心配や謝罪に対して、問題ないと気軽に伝える表現。</span>
- **例句1**: 遅れてごめんね。ううん、大丈夫だよ。 <audio src="没关系_ja_1.wav"></audio>
  - 对不起我迟到了。不，没关系。

## 3. 中文:
- **翻译**: 没关系
- **语域**: 口语
- **辨析**: “没关系”侧重表示不介意或不成问题。
`;

// Cards generated before 2026-08 carry readings inline.
const LEGACY = `# 使い回せ

## 1. 英文:
- **翻译**: reuse; repurpose

## 2. <ruby>日本語<rt>にほんご</rt></ruby>:
- **翻訳**: <ruby>使<rt>つか</rt></ruby>い<ruby>回<rt>まわ</rt></ruby>せ
- **解説**: <ruby>一<rt>ひと</rt></ruby>つのものを<ruby>繰<rt>く</rt></ruby>り<ruby>返<rt>かえ</rt></ruby>し<ruby>使<rt>つか</rt></ruby>うこと。

## 3. 中文:
- **翻译**: 反复利用
`;

const SCENARIO = `# 会议室临时调整

## 1. 场景说明
- **原始场景**: 团队在共享办公室临时调整会议室预约

## 2. 常用表达

### 01.
- **中文**: 你好，我们团队想临时调整一下今天下午的会议室预约。
- **英文**: Hi, our team would like to make a last-minute change. <audio src="s_en_1.mp3"></audio>
- **日本語**: こんにちは、会議室予約を急遽変更したいのですが。 <audio src="s_ja_1.wav"></audio>
- **使用提示**: 用于开场，语气礼貌。

### 02.
- **中文**: 原定的3号会议室现在方便改到5号吗？
- **英文**: Would it be possible to switch from Room 3 to Room 5?
- **日本語**: 元の3号室から5号室に変更することは可能でしょうか。
- **使用提示**: 用“方便吗”保持委婉。
`;

async function renderCard(markdown, cardType) {
  const { marked } = await import('marked');
  const html = String(marked.parse(markdown))
    .replace(/<audio src="([^"]+)"><\/audio>/gu, '<button type="button" class="audio-btn" data-src="$1">▶</button>');
  const dom = new JSDOM(`<div id="root"><div class="react-card-renderer card-type-${cardType}">${html}</div></div>`);
  return { dom, root: dom.window.document.getElementById('root').firstElementChild };
}

test('section headings lose their number, colon and language note', async () => {
  const { sectionInfo } = await import(moduleUrl('card-layout.mjs'));
  assert.deepEqual(sectionInfo('1. 英文:'), { label: '英文', lang: 'en' });
  assert.deepEqual(sectionInfo('2. 日本語：'), { label: '日本語', lang: 'ja' });
  assert.deepEqual(sectionInfo('3. 中文:'), { label: '中文', lang: 'zh' });
  assert.deepEqual(sectionInfo('1. 语法概述（中文）'), { label: '语法概述', lang: null });
  assert.deepEqual(sectionInfo('2. 常用表达'), { label: '常用表达', lang: null });
});

test('the summary takes each language\'s translation line, without markup', async () => {
  const { extractTrilingualSummary } = await import(moduleUrl('card-layout.mjs'));
  assert.deepEqual(extractTrilingualSummary(TRILINGUAL), {
    en: "It's no big deal.",
    ja: '大丈夫だよ。',
    jaRubyReading: null,
    zh: '没关系',
    register: '口语',
  });
  const legacy = extractTrilingualSummary(LEGACY);
  assert.equal(legacy.ja, '使い回せ');
  assert.equal(legacy.jaRubyReading, 'つかいまわせ');
  assert.equal(extractTrilingualSummary('# 只有标题\n## 1. 英文:\n- **翻译**: only one'), null);
});

test('the Japanese reading comes from the pronunciation tokens after 翻訳', async () => {
  const { readingFromTokens } = await import(moduleUrl('card-layout.mjs'));
  const plainText = '没关系 1. 英文: 翻译: It\'s no big deal. 2. 日本語: 翻訳: 大丈夫だよ。 例句1: 遅れてごめんね。ううん、大丈夫だよ。';
  const start = Array.from(plainText).indexOf('大', Array.from(plainText).indexOf('翻'));
  const at = Array.from(plainText).join('').indexOf('翻訳: 大丈夫') + 4;
  assert.equal(start, at);
  const tokens = [
    { surface: '大丈夫', startCodePoint: at, endCodePoint: at + 3, readingHiragana: 'だいじょうぶ' },
    { surface: 'だ', startCodePoint: at + 3, endCodePoint: at + 4, readingHiragana: 'だ' },
  ];
  assert.equal(readingFromTokens(plainText, tokens, '大丈夫だよ。'), 'だいじょうぶだよ');
  // Kana only: nothing to add, so no reading line.
  assert.equal(readingFromTokens(plainText, [], 'ごめんね'), null);
  assert.equal(readingFromTokens(plainText, tokens, '見つからない'), null);
});

test('a grammar card summary takes 语法点 and 核心结构 from its first section', async () => {
  const { extractGrammarSummary, fieldOf } = await import(moduleUrl('card-layout.mjs'));
  assert.deepEqual(extractGrammarSummary(`# において

## 1. 语法概述（中文）
- **语法点**: において（在……场所、场合、方面、时间）
- **核心结构**: 名词 + において
- **使用场景**: 表示动作或状态发生的场所。

## 2. 日本語:
- **例句1**: 会議室において説明会を行います。
`), { point: 'において（在……场所、场合、方面、时间）', structure: '名词 + において' });
  // Older cards put ruby even on Chinese words; the reading is dropped.
  assert.deepEqual(extractGrammarSummary(`# 〜やすい

## 1. 语法概述
- **语法点**: 表示做某事的难易程度。
- **核心结构**: <ruby>动词<rt>どうし</rt></ruby>ます形 + やすい
`), { point: '表示做某事的难易程度。', structure: '动词ます形 + やすい' });
  assert.equal(extractGrammarSummary('# x\n## 2. 日本語:\n- **语法点**: not in section one'), null);
  assert.equal(fieldOf('语法点'), 'point');
  assert.equal(fieldOf('核心结构'), 'structure');
});

test('loanword notes that only say 无 are marked empty; real ones are not', async () => {
  const { decorateCardRoot } = await import(moduleUrl('card-layout.mjs'));
  const { buildVisibleTextProjection } = await import(moduleUrl('text-projection.mjs'));
  const dom = new JSDOM('<div class="react-card-renderer"><ul><li><strong>例句1</strong>: すみません。<ul><li>不好意思。</li></ul>'
    + '<div class="loanword-block"><span class="loanword-label">外来语标注</span><span class="loanword-line"><span class="loanword-tag">无</span></span></div></li>'
    + '<li><strong>例句2</strong>: プレゼンです。<ul><li>是演示。</li></ul>'
    + '<div class="loanword-block"><span class="loanword-label">外来语标注</span><span class="loanword-line"><span class="loanword-tag">presentation → プレゼン</span></span></div></li></ul></div>');
  try {
    const root = dom.window.document.querySelector('.react-card-renderer');
    const before = buildVisibleTextProjection(root).text;
    decorateCardRoot(root, 'trilingual');
    assert.equal(buildVisibleTextProjection(root).text, before);
    const blocks = root.querySelectorAll('.loanword-block');
    assert.equal(blocks[0].dataset.loanwordEmpty, 'true');
    assert.equal(blocks[1].dataset.loanwordEmpty, undefined);
  } finally {
    dom.window.close();
  }
});

test('the scenario outline labels each expression by its Chinese sentence', async () => {
  const { extractScenarioOutline } = await import(moduleUrl('card-layout.mjs'));
  assert.deepEqual(extractScenarioOutline(SCENARIO), [
    { index: '01', label: '你好，我们团队想临时调整一下今天下午的会议室预约。' },
    { index: '02', label: '原定的3号会议室现在方便改到5号吗？' },
  ]);
});

for (const [name, markdown, cardType] of [
  ['trilingual', TRILINGUAL, 'trilingual'],
  ['legacy ruby', LEGACY, 'trilingual'],
  ['scenario', SCENARIO, 'scenario_phrase'],
]) {
  test(`decorating a ${name} card leaves its visible text untouched`, async () => {
    const { decorateCardRoot } = await import(moduleUrl('card-layout.mjs'));
    const { buildVisibleTextProjection } = await import(moduleUrl('text-projection.mjs'));
    const { dom, root } = await renderCard(markdown, cardType);
    try {
      const before = buildVisibleTextProjection(root).text;
      decorateCardRoot(root, cardType);
      decorateCardRoot(root, cardType);
      assert.equal(buildVisibleTextProjection(root).text, before);
      assert.equal(root.dataset.cardLayout, 'v1');
    } finally {
      dom.window.close();
    }
  });
}

test('fields, section labels and scenario blocks are marked for the layout', async () => {
  const { decorateCardRoot } = await import(moduleUrl('card-layout.mjs'));
  const trilingual = await renderCard(TRILINGUAL, 'trilingual');
  const scenario = await renderCard(SCENARIO, 'scenario_phrase');
  try {
    decorateCardRoot(trilingual.root, 'trilingual');
    const headings = Array.from(trilingual.root.querySelectorAll('h2')).map((h) => [h.dataset.sectionLabel, h.dataset.sectionLang]);
    assert.deepEqual(headings, [['英文', 'en'], ['日本語', 'ja'], ['中文', 'zh']]);
    const translations = trilingual.root.querySelectorAll('li[data-card-field="translation"]');
    assert.equal(translations.length, 3);
    const first = translations[0];
    assert.equal(first.querySelector('.card-field-label').textContent, '翻译');
    assert.equal(first.querySelector('.card-field-sep').textContent, ': ');
    assert.equal(first.querySelector('.card-field-body').textContent, "It's no big deal.");
    // The example keeps its nested translation outside the value column.
    const example = trilingual.root.querySelector('li[data-card-field="example"]');
    assert.ok(example.querySelector('.card-field-body .audio-btn'));
    assert.equal(example.querySelector('.card-field-body ul'), null);

    decorateCardRoot(scenario.root, 'scenario_phrase');
    const blocks = Array.from(scenario.root.querySelectorAll('.card-scenario-block'));
    assert.deepEqual(blocks.map((block) => block.dataset.blockIndex), ['01', '02']);
    assert.equal(blocks[0].querySelector('h3').textContent.trim(), '01.');
    assert.equal(blocks[0].querySelectorAll('li[data-card-field]').length, 4);
    assert.equal(blocks[0].querySelector('li[data-card-field="zh"]').querySelector('.card-field-body').textContent,
      '你好，我们团队想临时调整一下今天下午的会议室预约。');
  } finally {
    trilingual.dom.window.close();
    scenario.dom.window.close();
  }
});

test('a play button is glued to the last word, never to a whole sentence', async () => {
  const { decorateCardRoot } = await import(moduleUrl('card-layout.mjs'));
  const { buildVisibleTextProjection } = await import(moduleUrl('text-projection.mjs'));
  const { dom, root } = await renderCard(TRILINGUAL, 'trilingual');
  try {
    const before = buildVisibleTextProjection(root).text;
    decorateCardRoot(root, 'trilingual');
    assert.equal(buildVisibleTextProjection(root).text, before);
    const tails = Array.from(root.querySelectorAll('.card-field-tail'));
    assert.deepEqual(tails.map((tail) => tail.textContent.replace('▶', '').trim()), ['deal.', 'だよ。']);
    assert.ok(tails.every((tail) => tail.lastElementChild.classList.contains('audio-btn')));
  } finally {
    dom.window.close();
  }
});

test('Card Reader v3 wraps text in spans; the separator is still found', async () => {
  const { decorateCardRoot } = await import(moduleUrl('card-layout.mjs'));
  const { buildVisibleTextProjection } = await import(moduleUrl('text-projection.mjs'));
  const dom = new JSDOM('<div class="react-card-renderer card-reader-v3"><section><h2><span>1. 英文:</span></h2>'
    + '<ul><li><strong><span>翻译</span></strong><span>: It\'s no big deal.</span></li>'
    + '<li><strong><span>例句1</span></strong><span>: Sorry I\'m late, we just started. </span>'
    + '<button type="button" class="audio-btn">▶</button><span>\n</span></li></ul></section></div>');
  try {
    const root = dom.window.document.querySelector('.react-card-renderer');
    const before = buildVisibleTextProjection(root).text;
    decorateCardRoot(root, 'trilingual');
    assert.equal(buildVisibleTextProjection(root).text, before);
    const item = root.querySelector('li');
    assert.equal(item.dataset.cardField, 'translation');
    assert.equal(item.querySelector('.card-field-sep').textContent, ': ');
    assert.equal(item.querySelector('.card-field-body').textContent.replace(': ', ''), "It's no big deal.");
    assert.equal(root.querySelector('h2').dataset.sectionLabel, '英文');
    // The trailing newline span does not stop the button being glued.
    const tail = root.querySelector('li[data-card-field="example"] .card-field-tail');
    assert.equal(tail.textContent.replace('▶', ''), 'started. ');
  } finally {
    dom.window.close();
  }
});

test('a highlight saved on the old layout still lands on the same words', async () => {
  const { decorateCardRoot } = await import(moduleUrl('card-layout.mjs'));
  const anchor = await import(moduleUrl('annotation-anchor.mjs'));
  const plain = await renderCard(TRILINGUAL, 'trilingual');
  const decorated = await renderCard(TRILINGUAL, 'trilingual');
  try {
    const doc = plain.dom.window.document;
    const walker = doc.createTreeWalker(plain.root, plain.dom.window.NodeFilter.SHOW_TEXT);
    let node = walker.nextNode();
    while (node && !node.nodeValue.includes('casual phrase')) node = walker.nextNode();
    const offset = node.nodeValue.indexOf('casual phrase');
    const range = doc.createRange();
    range.setStart(node, offset);
    range.setEnd(node, offset + 'casual phrase'.length);
    const selector = anchor.createAnchor(plain.root, range);

    decorateCardRoot(decorated.root, 'trilingual');
    const resolved = anchor.resolveAnchor(decorated.root, selector);
    assert.equal(resolved.range.toString(), 'casual phrase');
  } finally {
    plain.dom.window.close();
    decorated.dom.window.close();
  }
});
