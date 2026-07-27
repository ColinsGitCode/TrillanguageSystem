'use strict';
// 注解重锚 dry-run v2 —— 修正统计单位。
//
// v1 把每个 <mark> 元素当一条注解，但真实数据里一次连续划选会因 <ruby> 边界
// 被切成十几个 <mark>（例：吹き出し口 -> 吹/き/出/し/口）。正确单位是
// “逻辑注解” = 可见基文上连续被标记的一段。
//
// 做法：构建整卡可见基文投影的同时，并行记录每个字符是否处于 mark 内，
// 再把连续的 marked 区间合并为逻辑注解，然后做锚定判定。只读。
const path = require('node:path');
// 复用仓库根的 node_modules，不新增依赖；不硬编码宿主机绝对路径。
const ROOT = path.resolve(__dirname, '..', '..');
const Database = require(path.join(ROOT, 'node_modules/better-sqlite3'));
const { marked } = require(path.join(ROOT, 'node_modules/marked'));
const { JSDOM } = require(path.join(ROOT, 'node_modules/jsdom'));

const DB = process.argv[2];
const CONTEXT = 40;

const EXCLUDE_TAGS = new Set(['rt', 'rp', 'button', 'audio', 'source', 'script', 'style']);
const EXCLUDE_CLASS = /(^|\s)(audio-btn|loanword-block|loanword-label|loanword-line|loanword-tag)(\s|$)/;
const BLOCK = new Set(['div', 'p', 'li', 'ul', 'ol', 'section', 'article', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'br', 'tr']);
const CJK = '぀-ヿ㐀-鿿々〆ヵヶ';

// 走一遍 DOM，产出 [{ch, marked}]，随后统一归一
function walk(node, win, inMark, out) {
  if (!node) return;
  if (node.nodeType === win.Node.TEXT_NODE) {
    for (const ch of String(node.nodeValue || '')) out.push({ ch, marked: inMark });
    return;
  }
  if (node.nodeType !== win.Node.ELEMENT_NODE) return;
  const tag = node.tagName.toLowerCase();
  if (EXCLUDE_TAGS.has(tag)) return;
  if (EXCLUDE_CLASS.test(node.getAttribute('class') || '')) return;
  const nowMark = inMark || tag === 'mark';
  if (BLOCK.has(tag)) out.push({ ch: ' ', marked: false });
  for (const child of node.childNodes) walk(child, win, nowMark, out);
  if (BLOCK.has(tag)) out.push({ ch: ' ', marked: false });
}

// 归一化（保持与投影一致），同时保留 marked 标记的对应关系
function normalizePairs(pairs) {
  // NFKC 逐字符 + 去 ▶
  let arr = [];
  for (const p of pairs) {
    const n = p.ch.normalize('NFKC');
    if (n === '▶') { arr.push({ ch: ' ', marked: false }); continue; }
    for (const c of n) arr.push({ ch: c, marked: p.marked });
  }
  // 折叠空白（关键：空格必须保留自身的 marked 标记，否则
  // "a short burst of" 这类含空格的短语会被空格切断成多条注解）
  const collapsed = [];
  for (const p of arr) {
    const isSpace = /\s/.test(p.ch);
    if (isSpace) {
      if (collapsed.length && /\s/.test(collapsed[collapsed.length - 1].ch)) {
        // 连续空白合并；marked 取或，避免边界丢失
        collapsed[collapsed.length - 1].marked = collapsed[collapsed.length - 1].marked || p.marked;
        continue;
      }
      collapsed.push({ ch: ' ', marked: p.marked });
    } else collapsed.push(p);
  }
  // CJK 间空格收敛
  const out = [];
  for (let i = 0; i < collapsed.length; i += 1) {
    const cur = collapsed[i];
    if (cur.ch === ' ' && i > 0 && i < collapsed.length - 1) {
      const prev = collapsed[i - 1].ch, next = collapsed[i + 1].ch;
      const re = new RegExp(`[${CJK}]`);
      if (re.test(prev) && (re.test(next) || /[、。！？：；，．]/.test(next))) continue;
    }
    out.push(cur);
  }
  while (out.length && out[0].ch === ' ') out.shift();
  while (out.length && out[out.length - 1].ch === ' ') out.pop();
  return out;
}

function normalizeText(text) {
  let s = String(text || '').normalize('NFKC').replace(/▶/g, ' ').replace(/[\s ]+/g, ' ');
  s = s.replace(new RegExp(`([${CJK}])\\s+([${CJK}])`, 'g'), '$1$2')
       .replace(new RegExp(`([${CJK}])\\s+([、。！？：；，．])`, 'g'), '$1$2');
  return s.replace(/\s{2,}/g, ' ').trim();
}

function projectionFromMarkdown(markdown) {
  const html = marked.parse(String(markdown || ''), { async: false });
  const dom = new JSDOM(`<div id="__root">${html}</div>`);
  const out = [];
  walk(dom.window.document.getElementById('__root'), dom.window, false, out);
  return normalizePairs(out).map((p) => p.ch).join('');
}

// 从存储 HTML 中提取“逻辑注解”：连续 marked 区间
function extractLogicalAnnotations(storedHtml) {
  const dom = new JSDOM(`<div id="__root">${storedHtml}</div>`);
  const raw = [];
  walk(dom.window.document.getElementById('__root'), dom.window, false, raw);
  const pairs = normalizePairs(raw);
  const flat = pairs.map((p) => p.ch).join('');

  const runs = [];
  let start = -1;
  for (let i = 0; i <= pairs.length; i += 1) {
    const on = i < pairs.length && pairs[i].marked;
    if (on && start === -1) start = i;
    if (!on && start !== -1) {
      let s = start, e = i;
      while (s < e && /\s/.test(pairs[s].ch)) s += 1;
      while (e > s && /\s/.test(pairs[e - 1].ch)) e -= 1;
      if (e > s) {
        runs.push({
          quote: flat.slice(s, e),
          prefix: flat.slice(Math.max(0, s - CONTEXT), s).trim(),
          suffix: flat.slice(e, e + CONTEXT).trim(),
        });
      }
      start = -1;
    }
  }
  return runs;
}

function allIndexes(hay, needle) {
  const out = [];
  if (!needle) return out;
  let i = hay.indexOf(needle);
  while (i !== -1) { out.push(i); i = hay.indexOf(needle, i + 1); }
  return out;
}

function classify(ann, projection) {
  if (!ann.quote) return { status: 'empty-quote' };
  const hits = allIndexes(projection, ann.quote);
  if (hits.length === 0) return { status: 'not-found', hits: 0 };
  if (hits.length === 1) return { status: 'exact-unique', hits: 1, offset: hits[0] };
  const scored = hits.filter((idx) => {
    const pOk = !ann.prefix || projection.slice(Math.max(0, idx - CONTEXT * 2), idx).includes(ann.prefix.slice(-14));
    const sOk = !ann.suffix || projection.slice(idx + ann.quote.length, idx + ann.quote.length + CONTEXT * 2).includes(ann.suffix.slice(0, 14));
    return pOk && sOk;
  });
  if (scored.length === 1) return { status: 'ctx-resolved', hits: hits.length, offset: scored[0] };
  return { status: 'ambiguous', hits: hits.length, resolved: scored.length };
}

const db = new Database(DB, { readonly: true });
const rows = db.prepare(`
  SELECT h.id, h.generation_id, h.html_content, g.markdown_content, g.card_type
  FROM card_highlights h LEFT JOIN generations g ON g.id = h.generation_id ORDER BY h.id
`).all();

let rawMarks = 0, logical = 0;
const tally = {};
const perRow = [];
const failures = [];
const lens = [];

for (const row of rows) {
  const rawCount = (String(row.html_content || '').match(/<mark[^>]*>/g) || []).length;
  rawMarks += rawCount;
  const anns = extractLogicalAnnotations(row.html_content || '');
  logical += anns.length;
  anns.forEach((a) => lens.push([...a.quote].length));

  if (!row.markdown_content) {
    anns.forEach((a) => { tally['no-source'] = (tally['no-source'] || 0) + 1; failures.push({ row: row.id, quote: a.quote, why: 'no-source' }); });
    perRow.push({ id: row.id, raw: rawCount, log: anns.length, note: '无当前内容' });
    continue;
  }
  const projection = projectionFromMarkdown(row.markdown_content);
  if (process.env.SHOW_QUOTES === '1') {
    console.log(`\n[行#${row.id}] ${rawCount} 个 mark 合并为 ${anns.length} 条注解：`);
    anns.forEach((a, i) => console.log(`   [${i}] "${a.quote}"`));
  }
  const stats = {};
  for (const a of anns) {
    const r = classify(a, projection);
    tally[r.status] = (tally[r.status] || 0) + 1;
    stats[r.status] = (stats[r.status] || 0) + 1;
    if (r.status !== 'exact-unique' && r.status !== 'ctx-resolved') {
      failures.push({ row: row.id, gen: row.generation_id, quote: a.quote, why: r.status, hits: r.hits });
    }
  }
  perRow.push({ id: row.id, gen: row.generation_id, type: row.card_type, raw: rawCount, log: anns.length, stats });
}
db.close();

console.log('='.repeat(74));
console.log('注解重锚 dry-run v2（单位：逻辑注解 = 合并碎片后的连续标记）');
console.log('='.repeat(74));
console.log(`highlight 行数 = ${rows.length}`);
console.log(`原始 <mark> 元素 = ${rawMarks}   ->   逻辑注解 = ${logical}   (碎片压缩 ${(rawMarks / Math.max(1, logical)).toFixed(1)}x)\n`);

console.log('--- 逐行 ---');
for (const r of perRow) {
  const s = r.stats ? Object.entries(r.stats).map(([k, v]) => `${k}:${v}`).join(' ') : r.note;
  console.log(`  #${String(r.id).padStart(3)} gen=${String(r.gen || '-').padStart(4)} ${String(r.type || '?').padEnd(16)} mark=${String(r.raw).padStart(2)} -> 注解=${String(r.log).padStart(2)}  ${s}`);
}

lens.sort((a, b) => a - b);
console.log(`\n--- 逻辑注解文字长度 ---`);
console.log(`  最短 ${lens[0]}  中位 ${lens[Math.floor(lens.length / 2)]}  最长 ${lens[lens.length - 1]}`);
console.log(`  ≤3 字的短注解: ${lens.filter((l) => l <= 3).length} / ${lens.length}`);

console.log('\n--- 汇总 ---');
const ok = (tally['exact-unique'] || 0) + (tally['ctx-resolved'] || 0);
for (const [k, v] of Object.entries(tally).sort((a, b) => b[1] - a[1])) {
  console.log(`  ${k.padEnd(14)} ${String(v).padStart(3)}  ${(v / logical * 100).toFixed(1)}%`);
}
console.log(`\n  >>> 可重锚 = ${ok}/${logical} = ${(ok / logical * 100).toFixed(1)}%`);
console.log(`  >>> 需降级/人工 = ${logical - ok}/${logical} = ${((logical - ok) / logical * 100).toFixed(1)}%`);

if (failures.length) {
  console.log('\n--- 失败明细 ---');
  failures.forEach((f) => console.log(`  行#${f.row} gen=${f.gen} [${f.why}${f.hits !== undefined ? ' hits=' + f.hits : ''}] "${String(f.quote).slice(0, 60)}"`));
}
