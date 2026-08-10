const assert = require('node:assert/strict');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const test = require('node:test');
const { JSDOM } = require('jsdom');

const projectionUrl = pathToFileURL(path.resolve(__dirname, '../../app/features/card-modal/text-projection.mjs')).href;

test('visible text projection matches card reading text and keeps only study highlights', async () => {
  const { buildVisibleTextProjection } = await import(projectionUrl);
  const dom = new JSDOM(`
    <div id="card">
      <p><ruby><mark class="study-highlight-red">吹</mark><rt>ふ</rt></ruby><mark class="study-highlight-red">き</mark>出し口</p>
      <button class="audio-btn">▶</button>
      <span class="loanword-tag">loanword</span>
      <mark class="editor-preview">not a stored highlight</mark>
    </div>
  `);
  const result = buildVisibleTextProjection(dom.window.document.getElementById('card'));

  assert.equal(result.text, '吹き出し口 not a stored highlight');
  assert.equal(result.pairs.filter((pair) => pair.marked).map((pair) => pair.ch).join(''), '吹き');
  dom.window.close();
});

test('visible text projection normalizes Unicode and CJK whitespace consistently', async () => {
  const { buildVisibleTextProjection, normalizeProjectionText } = await import(projectionUrl);
  const dom = new JSDOM('<div id="card">Ａ　Ｂ　<ruby>食<rt>た</rt></ruby> べ る 。</div>');

  assert.equal(buildVisibleTextProjection(dom.window.document.getElementById('card')).text, 'A B 食べる。');
  assert.equal(normalizeProjectionText('Ａ　Ｂ　食 べ る 。'), 'A B 食べる。');
  assert.equal(normalizeProjectionText('（ 食 べ る ）'), '(食べる)');
  dom.window.close();
});

test('legacy loanword blocks and A2 omission produce the same selectable text', async () => {
  const { buildVisibleTextProjection } = await import(projectionUrl);
  const dom = new JSDOM('<div></div>');
  const oldRoot = dom.window.document.createElement('div');
  const newRoot = dom.window.document.createElement('div');
  oldRoot.innerHTML = '<p>スケジュールを確認します。</p><div class="loanword-block">schedule → スケジュール</div>';
  newRoot.innerHTML = '<p>スケジュールを確認します。</p>';

  assert.equal(buildVisibleTextProjection(oldRoot).text, buildVisibleTextProjection(newRoot).text);
  dom.window.close();
});
