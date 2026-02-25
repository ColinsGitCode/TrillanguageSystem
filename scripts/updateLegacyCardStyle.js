#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');

const { postProcessGeneratedContent } = require('../services/contentPostProcessor');
const {
  buildAudioTasksFromMarkdown,
  prepareMarkdownForCard,
  renderHtmlFromMarkdown,
} = require('../services/htmlRenderer');

const RECORDS_PATH = process.env.RECORDS_PATH || '/data/trilingual_records';
const APPLY = process.argv.includes('--apply');
const VERBOSE = process.argv.includes('--verbose');
const TARGET_FOLDER_ARG = process.argv.find((arg) => arg.startsWith('--folder='));
const TARGET_FOLDER = TARGET_FOLDER_ARG ? TARGET_FOLDER_ARG.slice('--folder='.length) : '';

function isCardMarkdown(markdown) {
  if (!markdown) return false;
  const text = String(markdown);
  const hasEnglishSection = /##\s*1\.\s*英文/i.test(text);
  const hasJapaneseSection = /##\s*2\.\s*(?:日本語|日语|<ruby>\s*日本語)/i.test(text);
  const hasExample = /\*\*例句\d+\*\*:\s*/.test(text);
  const hasLoanwordLabel = /外来语标注[:：]/i.test(text);
  return hasExample && (hasEnglishSection || hasJapaneseSection || hasLoanwordLabel);
}

function walkMarkdownFiles(rootDir) {
  const files = [];
  const queue = [rootDir];

  while (queue.length) {
    const current = queue.shift();
    const entries = fs.readdirSync(current, { withFileTypes: true });
    for (const entry of entries) {
      const full = path.join(current, entry.name);
      if (entry.isDirectory()) {
        queue.push(full);
      } else if (entry.isFile() && entry.name.toLowerCase().endsWith('.md')) {
        files.push(full);
      }
    }
  }
  return files;
}

function diffCount(before, after) {
  return before === after ? 0 : 1;
}

function repairLoanwordSpanBalance(markdown) {
  const lines = String(markdown || '').split(/\r?\n/);
  const repaired = lines.map((line) => {
    if (!line.includes('loanword-block') || !line.includes('loanword-line')) return line;
    const openCount = (line.match(/<span\b/gi) || []).length;
    const closeCount = (line.match(/<\/span>/gi) || []).length;
    const missing = openCount - closeCount;
    if (missing <= 0) return line;
    return line.replace(/<\/div>/i, `${'</span>'.repeat(missing)}</div>`);
  });
  return repaired.join('\n');
}

async function processOne(mdPath) {
  const dir = path.dirname(mdPath);
  const base = path.basename(mdPath, '.md');
  const htmlPath = path.join(dir, `${base}.html`);

  const originalMarkdown = fs.readFileSync(mdPath, 'utf8');
  const normalizedMarkdown = repairLoanwordSpanBalance(originalMarkdown);
  if (!isCardMarkdown(originalMarkdown)) {
    return { skipped: true, reason: 'not-card' };
  }

  const content = {
    markdown_content: normalizedMarkdown,
    audio_tasks: buildAudioTasksFromMarkdown(normalizedMarkdown),
  };
  postProcessGeneratedContent(content);

  const audioTasks = buildAudioTasksFromMarkdown(content.markdown_content);
  const preparedMarkdown = await prepareMarkdownForCard(content.markdown_content, {
    baseName: base,
    audioTasks,
  });
  const renderedHtml = await renderHtmlFromMarkdown(preparedMarkdown, {
    baseName: base,
    audioTasks,
    prepared: true,
  });

  const mdChanged = diffCount(originalMarkdown, preparedMarkdown);
  let htmlChanged = 0;
  let originalHtml = '';
  if (fs.existsSync(htmlPath)) {
    originalHtml = fs.readFileSync(htmlPath, 'utf8');
    htmlChanged = diffCount(originalHtml, renderedHtml);
  } else {
    htmlChanged = 1;
  }

  if (APPLY) {
    if (mdChanged) fs.writeFileSync(mdPath, preparedMarkdown, 'utf8');
    if (htmlChanged) fs.writeFileSync(htmlPath, renderedHtml, 'utf8');
  }

  return {
    skipped: false,
    mdChanged: Boolean(mdChanged),
    htmlChanged: Boolean(htmlChanged),
    folder: path.basename(path.dirname(mdPath)),
    base,
  };
}

async function main() {
  if (!fs.existsSync(RECORDS_PATH)) {
    throw new Error(`RECORDS_PATH does not exist: ${RECORDS_PATH}`);
  }

  const root = TARGET_FOLDER ? path.join(RECORDS_PATH, TARGET_FOLDER) : RECORDS_PATH;
  if (!fs.existsSync(root)) {
    throw new Error(`Target folder not found: ${root}`);
  }

  const mdFiles = walkMarkdownFiles(root);
  const stats = {
    scanned: mdFiles.length,
    eligible: 0,
    skipped: 0,
    mdChanged: 0,
    htmlChanged: 0,
    errors: 0,
  };

  for (const mdPath of mdFiles) {
    try {
      const result = await processOne(mdPath);
      if (result.skipped) {
        stats.skipped += 1;
        continue;
      }
      stats.eligible += 1;
      if (result.mdChanged) stats.mdChanged += 1;
      if (result.htmlChanged) stats.htmlChanged += 1;

      if (VERBOSE && (result.mdChanged || result.htmlChanged)) {
        console.log(
          `${APPLY ? '[updated]' : '[dry-run]'} ${result.folder}/${result.base} md:${result.mdChanged ? 'Y' : 'N'} html:${result.htmlChanged ? 'Y' : 'N'}`
        );
      }
    } catch (err) {
      stats.errors += 1;
      console.error(`[error] ${mdPath}: ${err.message}`);
    }
  }

  console.log('=== Legacy Card Style Migration ===');
  console.log(`Records Path : ${RECORDS_PATH}`);
  console.log(`Target       : ${TARGET_FOLDER || '(all folders)'}`);
  console.log(`Mode         : ${APPLY ? 'APPLY' : 'DRY-RUN'}`);
  console.log(`Scanned MD   : ${stats.scanned}`);
  console.log(`Eligible     : ${stats.eligible}`);
  console.log(`Skipped      : ${stats.skipped}`);
  console.log(`MD Changed   : ${stats.mdChanged}`);
  console.log(`HTML Changed : ${stats.htmlChanged}`);
  console.log(`Errors       : ${stats.errors}`);

  if (!APPLY) {
    console.log('\nTip: add --apply to persist changes.');
  }
}

main().catch((err) => {
  console.error('[fatal]', err.message);
  process.exit(1);
});
