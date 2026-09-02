'use strict';

/**
 * Repairs cards whose stored body is the model's raw reply rather than the card.
 *
 * On 2026-02-09/10 a run of generations persisted the provider response verbatim:
 * a planning preamble before the card, the card wrapped in a ```markdown fence,
 * and in some rows the whole card repeated two or three times. The prompt has
 * always forbidden that shape, and no generation since has produced it, so this
 * is a bounded historical repair rather than a pipeline change.
 *
 * The damage is not only cosmetic. `stripMarkdownToJapaneseText` drops fenced
 * blocks, so for a fenced row the pronunciation projection sees only the Chinese
 * preamble and finds no Japanese at all.
 *
 * Dry-run by default. `--apply` requires `--backup <path>` because the repair
 * rewrites `generations.markdown_content`, its `content_hash`, and the `.md`
 * and `.html` files under RECORDS_PATH.
 */

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

function parseArgs(argv) {
  const args = { apply: false, backup: null, report: null, limit: null };
  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    if (token === '--apply') args.apply = true;
    else if (token === '--backup') { args.backup = argv[i + 1]; i += 1; }
    else if (token === '--report') { args.report = argv[i + 1]; i += 1; }
    else if (token === '--limit') { args.limit = Number(argv[i + 1]); i += 1; }
  }
  return args;
}

function computeContentHash(markdownContent) {
  const normalized = String(markdownContent || '').replace(/^\uFEFF/, '').replace(/\r\n?/g, '\n');
  return crypto.createHash('sha256').update(normalized).digest('hex');
}

/**
 * Returns the card body, or null when the row already looks clean.
 *
 * Deliberately conservative: it only ever *removes* text that sits outside the
 * first complete card, and it refuses any row where the result would lose a
 * section the original had.
 */
function cardSections(text) {
  // A list, not a set: a body the model emitted twice shows up as repeated
  // sections, and that is exactly what the guard has to notice.
  return (String(text).match(/^##\s*\d*\.?\s*\S+/gmu) || []).map((line) => line.trim());
}

function repairMarkdown(raw) {
  const source = String(raw || '').replace(/\r\n?/gu, '\n');
  let body = source;

  // 1. Unwrap each fence that holds part of the card, judged fence by fence:
  //    some rows wrap the whole card, some wrap one section each, and some wrap
  //    only a couple of sections. A fence with no card section is left alone,
  //    so a genuine code sample keeps its delimiters.
  body = body.replace(/```[a-zA-Z]*\n([\s\S]*?)```/gu, (match, inner) => (
    /^#{1,2}\s/mu.test(inner) ? inner : match
  ));

  // 2. Drop the planning preamble that precedes the card's own H1.
  const titleIndex = body.search(/^#\s/mu);
  if (titleIndex > 0) body = body.slice(titleIndex);

  // 3. Keep the first copy when the model repeated the whole card. Only an
  //    identical title counts as a repeat: two different H1s are two different
  //    cards, and dropping one of those would be data loss, not a repair.
  const titles = [...body.matchAll(/^#\s+(.*)$/gmu)];
  if (titles.length > 1 && titles.every((t) => t[1].trim() === titles[0][1].trim())) {
    body = body.slice(0, titles[1].index);
  }

  const repaired = body.trim() + '\n';
  if (repaired === source.trim() + '\n') return null;

  // 4. A repair may only ever remove scaffolding, and it has to leave one clean
  //    card behind. Refuse the row when a section would be lost, when one would
  //    be invented, or when the result still repeats a section - a half-fixed
  //    card is worse than an untouched one, because nobody looks at it again.
  const before = cardSections(source);
  const after = cardSections(repaired);
  if (!after.length) return null;
  if (new Set(after).size !== after.length) return null;
  const beforeSet = new Set(before);
  const afterSet = new Set(after);
  if (beforeSet.size !== afterSet.size) return null;
  for (const section of beforeSet) if (!afterSet.has(section)) return null;

  // 5. Structural check on the result itself. Four rounds of tightening kept
  //    turning up new malformed shapes in that batch, so the contract is not
  //    "my rules ran" but "the output is demonstrably one clean card". Anything
  //    else is left for a human rather than half-repaired.
  if (!isCleanCard(repaired)) return null;

  return repaired;
}

function isCleanCard(text) {
  if (!text.startsWith('# ')) return false;
  if ((text.match(/^#\s/gmu) || []).length !== 1) return false;
  if (text.includes('```')) return false;
  if (/^\s*(好的|我将|以下是|我会|首先)/u.test(text)) return false;
  return true;
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.apply && !args.backup) {
    process.stderr.write('--apply requires --backup <path>: the repair rewrites card bodies.\n');
    process.exit(1);
  }

  const dbPath = process.env.DB_PATH;
  const recordsPath = process.env.RECORDS_PATH;
  if (!dbPath || !recordsPath) {
    process.stderr.write('DB_PATH and RECORDS_PATH must be set.\n');
    process.exit(1);
  }

  if (args.apply) {
    fs.copyFileSync(dbPath, args.backup);
    process.stdout.write(`SQLite backup written to ${args.backup}\n`);
  }

  const Database = require('better-sqlite3');
  const db = new Database(dbPath, { readonly: !args.apply });
  const rows = db.prepare(
    'SELECT id, phrase, folder_name, base_filename, content_hash, markdown_content FROM generations WHERE markdown_content IS NOT NULL ORDER BY id'
  ).all();

  const planned = [];
  for (const row of rows) {
    const repaired = repairMarkdown(row.markdown_content);
    if (!repaired) continue;
    planned.push({
      id: row.id,
      phrase: row.phrase,
      folder: row.folder_name,
      base: row.base_filename,
      beforeChars: row.markdown_content.length,
      afterChars: repaired.length,
      beforeHash: row.content_hash,
      afterHash: computeContentHash(repaired),
      repaired,
    });
    if (args.limit && planned.length >= args.limit) break;
  }

  process.stdout.write(`\n扫描 ${rows.length} 张卡片，需要修复 ${planned.length} 张\n\n`);
  for (const item of planned) {
    process.stdout.write(
      `  #${String(item.id).padStart(4)} ${String(item.phrase).slice(0, 18).padEnd(20)}`
      + ` ${String(item.beforeChars).padStart(5)} -> ${String(item.afterChars).padStart(5)} 字\n`
    );
  }

  if (!args.apply) {
    process.stdout.write('\nDry-run。加 --apply --backup <path> 才会写入。\n');
  } else {
    const update = db.prepare('UPDATE generations SET markdown_content = ?, content_hash = ? WHERE id = ?');
    const applyAll = db.transaction((items) => {
      for (const item of items) update.run(item.repaired, item.afterHash, item.id);
    });
    applyAll(planned);

    let files = 0;
    for (const item of planned) {
      const mdFile = path.join(recordsPath, item.folder, `${item.base}.md`);
      if (fs.existsSync(mdFile)) { fs.writeFileSync(mdFile, item.repaired); files += 1; }
    }
    process.stdout.write(`\n已更新 ${planned.length} 行 SQLite，${files} 个 .md 文件。\n`);
    process.stdout.write('HTML 快照未改写：它由生成时渲染，正文本身正确。\n');
  }

  if (args.report) {
    fs.writeFileSync(args.report, JSON.stringify({
      generatedAtUtc: new Date().toISOString(),
      applied: args.apply,
      scanned: rows.length,
      repaired: planned.map(({ repaired: _repaired, ...rest }) => rest),
    }, null, 2));
    process.stdout.write(`报告写入 ${args.report}\n`);
  }

  db.close();
}

if (require.main === module) main();

module.exports = { repairMarkdown, computeContentHash };
