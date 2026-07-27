'use strict';
// 注解重锚 dry-run v3。
//
// 审计必须和生产 CardModal 走同一条 Markdown -> HTML -> safe DOM 渲染链路，
// 否则 ruby、音频适配和外来语标签会导致选择器偏移与真实阅读面不一致。这个脚本
// 只读 SQLite；它不写入数据库，也不把教材或卡片正文输出到 Git。
const crypto = require('node:crypto');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const ROOT = path.resolve(__dirname, '..', '..');
const Database = require(path.join(ROOT, 'node_modules/better-sqlite3'));
const createDOMPurify = require(path.join(ROOT, 'node_modules/dompurify'));
const { marked } = require(path.join(ROOT, 'node_modules/marked'));
const { JSDOM } = require(path.join(ROOT, 'node_modules/jsdom'));

const DB = process.argv.find((arg) => !arg.startsWith('--') && arg.endsWith('.db'));
const JSON_OUTPUT = process.argv.includes('--json');
const CONTEXT = 40;

if (!DB) {
  console.error('Usage: node reanchor-dryrun.js /absolute/path/to/records.db [--json]');
  process.exit(2);
}

function moduleUrl(relativePath) {
  return pathToFileURL(path.join(ROOT, relativePath)).href;
}

function renderCardMarkdown(markdown, cardType, folder, transforms) {
  const parsed = String(marked.parse(transforms.normalizeLoanwordAnnotations(markdown || ''), { async: false }));
  const withAudioButtons = transforms.adaptAudioToButtons(parsed, folder || '');
  const dom = new JSDOM('');
  const DOMPurify = createDOMPurify(dom.window);
  const safe = DOMPurify.sanitize(withAudioButtons, {
    USE_PROFILES: { html: true },
    ADD_TAGS: transforms.CARD_RENDER_ALLOWED_TAGS,
    ADD_ATTR: transforms.CARD_RENDER_ALLOWED_ATTR,
    FORBID_TAGS: ['script', 'style', 'iframe', 'object', 'embed'],
    FORBID_ATTR: ['style'],
  });
  dom.window.close();
  return `<div class="react-card-renderer card-type-${cardType}" data-card-renderer-version="2" data-card-type="${cardType}">${safe}</div>`;
}

function allIndexes(haystack, needle) {
  const indexes = [];
  if (!needle) return indexes;
  let index = haystack.indexOf(needle);
  while (index !== -1) {
    indexes.push(index);
    index = haystack.indexOf(needle, index + 1);
  }
  return indexes;
}

function extractInferredContinuousRuns(storedHtml, projection) {
  const dom = new JSDOM(`<div id="__root">${storedHtml || ''}</div>`);
  const root = dom.window.document.getElementById('__root');
  const pairs = projection.buildVisibleTextProjection(root).pairs;
  const flat = pairs.map((pair) => pair.ch).join('');
  const runs = [];
  let start = -1;
  for (let index = 0; index <= pairs.length; index += 1) {
    const marked = index < pairs.length && pairs[index].marked;
    if (marked && start === -1) start = index;
    if (!marked && start !== -1) {
      let runStart = start;
      let runEnd = index;
      while (runStart < runEnd && /\s/.test(pairs[runStart].ch)) runStart += 1;
      while (runEnd > runStart && /\s/.test(pairs[runEnd - 1].ch)) runEnd -= 1;
      if (runEnd > runStart) {
        runs.push({
          quote: flat.slice(runStart, runEnd),
          prefix: flat.slice(Math.max(0, runStart - CONTEXT), runStart).trim(),
          suffix: flat.slice(runEnd, runEnd + CONTEXT).trim(),
        });
      }
      start = -1;
    }
  }
  dom.window.close();
  return runs;
}

function classify(run, renderedProjection) {
  if (!run.quote) return { status: 'empty-quote' };
  const hits = allIndexes(renderedProjection, run.quote);
  if (hits.length === 0) return { status: 'not-found', hits: 0 };
  if (hits.length === 1) return { status: 'exact-unique', hits: 1, offset: hits[0] };
  const resolved = hits.filter((index) => {
    const prefixMatches = !run.prefix || renderedProjection
      .slice(Math.max(0, index - CONTEXT * 2), index)
      .includes(run.prefix.slice(-14));
    const suffixMatches = !run.suffix || renderedProjection
      .slice(index + run.quote.length, index + run.quote.length + CONTEXT * 2)
      .includes(run.suffix.slice(0, 14));
    return prefixMatches && suffixMatches;
  });
  if (resolved.length === 1) return { status: 'ctx-resolved', hits: hits.length, offset: resolved[0] };
  return { status: 'ambiguous', hits: hits.length, resolved: resolved.length };
}

async function main() {
  const [transforms, projection] = await Promise.all([
    import(moduleUrl('app/features/card-modal/card-render-transforms.mjs')),
    import(moduleUrl('app/features/card-modal/text-projection.mjs')),
  ]);
  const db = new Database(DB, { readonly: true });
  const rows = db.prepare(`
    SELECT h.id, h.generation_id, h.html_content, g.markdown_content, g.card_type, g.folder_name
    FROM card_highlights h
    LEFT JOIN generations g ON g.id = h.generation_id
    ORDER BY h.id
  `).all();

  let rawMarks = 0;
  let inferredRuns = 0;
  const tally = {};
  const perRow = [];
  const failures = [];
  const lengths = [];

  for (const row of rows) {
    const markCount = (String(row.html_content || '').match(/<mark\b[^>]*>/gi) || []).length;
    rawMarks += markCount;
    const runs = extractInferredContinuousRuns(row.html_content, projection);
    inferredRuns += runs.length;
    runs.forEach((run) => lengths.push([...run.quote].length));

    if (!row.markdown_content) {
      runs.forEach((run) => {
        tally['no-source'] = (tally['no-source'] || 0) + 1;
        failures.push({ row: row.id, quote: run.quote, why: 'no-source' });
      });
      perRow.push({ id: row.id, raw: markCount, inferred: runs.length, note: '无当前内容' });
      continue;
    }

    const renderedHtml = renderCardMarkdown(row.markdown_content, row.card_type, row.folder_name, transforms);
    const renderedDom = new JSDOM(`<div id="__root">${renderedHtml}</div>`);
    const renderedProjection = projection.buildVisibleTextProjection(renderedDom.window.document.getElementById('__root')).text;
    renderedDom.window.close();
    const stats = {};
    for (const run of runs) {
      const result = classify(run, renderedProjection);
      tally[result.status] = (tally[result.status] || 0) + 1;
      stats[result.status] = (stats[result.status] || 0) + 1;
      if (result.status !== 'exact-unique' && result.status !== 'ctx-resolved') {
        failures.push({ row: row.id, generation: row.generation_id, quote: run.quote, why: result.status, hits: result.hits });
      }
    }
    perRow.push({
      id: row.id,
      generation: row.generation_id,
      type: row.card_type,
      raw: markCount,
      inferred: runs.length,
      stats,
    });
  }
  db.close();

  lengths.sort((left, right) => left - right);
  const reanchorable = (tally['exact-unique'] || 0) + (tally['ctx-resolved'] || 0);
  const summary = {
    schemaVersion: 3,
    source: 'local SQLite volume; read-only; source text omitted',
    renderPipeline: 'normalizeLoanwordAnnotations -> marked -> adaptAudioToButtons -> DOMPurify -> visibleTextProjection',
    dbSha256: crypto.createHash('sha256').update(require('node:fs').readFileSync(DB)).digest('hex'),
    highlightRows: rows.length,
    rawMarkElements: rawMarks,
    inferredContinuousMarkedRuns: inferredRuns,
    reanchorable,
    reanchorRate: inferredRuns ? Number((reanchorable / inferredRuns).toFixed(4)) : 0,
    statuses: tally,
    runLength: {
      min: lengths[0] || 0,
      median: lengths[Math.floor(lengths.length / 2)] || 0,
      max: lengths.at(-1) || 0,
      atMostThree: lengths.filter((length) => length <= 3).length,
    },
    failureCount: failures.length,
  };

  if (JSON_OUTPUT) {
    console.log(JSON.stringify(summary, null, 2));
    return;
  }

  console.log('='.repeat(74));
  console.log('注解重锚 dry-run v3（单位：推断出的连续标红区间）');
  console.log('='.repeat(74));
  console.log('渲染链路 = 生产 CardModal: loanword -> marked -> audio button -> DOMPurify -> projection');
  console.log(`highlight 行数 = ${rows.length}`);
  console.log(`原始 <mark> 元素 = ${rawMarks}   ->   推断连续区间 = ${inferredRuns}   (碎片压缩 ${(rawMarks / Math.max(1, inferredRuns)).toFixed(1)}x)\n`);
  console.log('--- 逐行 ---');
  perRow.forEach((row) => {
    const stats = row.stats ? Object.entries(row.stats).map(([key, value]) => `${key}:${value}`).join(' ') : row.note;
    console.log(`  #${String(row.id).padStart(3)} gen=${String(row.generation || '-').padStart(4)} ${String(row.type || '?').padEnd(16)} mark=${String(row.raw).padStart(2)} -> 区间=${String(row.inferred).padStart(2)}  ${stats}`);
  });
  console.log('\n--- 连续区间文字长度 ---');
  console.log(`  最短 ${summary.runLength.min}  中位 ${summary.runLength.median}  最长 ${summary.runLength.max}`);
  console.log(`  <=3 字的短区间: ${summary.runLength.atMostThree} / ${inferredRuns}`);
  console.log('\n--- 汇总 ---');
  Object.entries(tally).sort((left, right) => right[1] - left[1]).forEach(([key, value]) => {
    console.log(`  ${key.padEnd(14)} ${String(value).padStart(3)}  ${(value / inferredRuns * 100).toFixed(1)}%`);
  });
  console.log(`\n  >>> 可重锚 = ${reanchorable}/${inferredRuns} = ${(reanchorable / inferredRuns * 100).toFixed(1)}%`);
  console.log(`  >>> 需降级/人工 = ${inferredRuns - reanchorable}/${inferredRuns} = ${((inferredRuns - reanchorable) / inferredRuns * 100).toFixed(1)}%`);
  if (failures.length) {
    console.log('\n--- 失败明细 ---');
    failures.forEach((failure) => console.log(`  行#${failure.row} gen=${failure.generation || '-'} [${failure.why}${failure.hits !== undefined ? ` hits=${failure.hits}` : ''}] "${String(failure.quote).slice(0, 60)}"`));
  }
}

main().catch((error) => {
  console.error(error.stack || error.message || error);
  process.exit(1);
});
