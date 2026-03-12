const { marked } = require('marked');
const { toRuby } = require('./japaneseFurigana');
const LOANWORD_READING_REGEX =
  /([\u30A1-\u30FA\u30FC\u30FB\u30FD\u30FEA-Za-zＡ-Ｚａ-ｚ0-9０-９._/-]+)\s*[（(][\u3041-\u3096\u30A1-\u30FA\u30FC\u30FB\s]+[）)]/g;

function stripMarkup(text) {
  if (!text) return '';
  return String(text)
    .replace(/<rt>.*?<\/rt>/gi, '')
    .replace(/<rp>.*?<\/rp>/gi, '')
    .replace(/<\/?ruby>/gi, '')
    .replace(/<[^>]+>/g, '')
    .replace(/[`*_]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function stripKatakanaReadings(text) {
  let cleaned = String(text || '');
  let previous = '';
  while (cleaned !== previous) {
    previous = cleaned;
    cleaned = cleaned.replace(LOANWORD_READING_REGEX, '$1');
  }
  return cleaned;
}

function buildAudioTasksFromMarkdown(markdown) {
  const tasks = [];
  if (!markdown) return tasks;
  const lines = String(markdown).split(/\r?\n/);
  let currentLang = null;
  lines.forEach((line) => {
    const headerMatch = line.match(/^##\s*\d+\.\s*(.+)\s*$/);
    if (headerMatch) {
      const header = headerMatch[1];
      if (/英文/i.test(header)) currentLang = 'en';
      else if (/日本語|日语/i.test(header)) currentLang = 'ja';
      else currentLang = null;
    }

    const exampleMatch = line.match(/^\s*-\s*\*\*例句(\d+)\*\*:\s*(.+)$/);
    if (exampleMatch && currentLang) {
      const index = exampleMatch[1];
      const rawText = exampleMatch[2];
      const cleanText = stripMarkup(rawText);
      if (cleanText) {
        tasks.push({
          text: cleanText,
          lang: currentLang,
          filename_suffix: `_${currentLang}_${index}`,
        });
      }
    }
  });
  return tasks;
}

async function normalizeJapaneseRuby(markdown) {
  if (!markdown) return '';
  const lines = String(markdown).split(/\r?\n/);
  let inJapanese = false;
  const rubyPattern = /([\u3400-\u9FFF々〆ヵヶ]+)\s*[（(]([\u3041-\u3096\u30A1-\u30FA\u30FC]+)[）)]/g;
  const output = [];
  for (const line of lines) {
    const headerMatch = line.match(/^##\s*\d+\.\s*(.+)\s*$/);
    if (headerMatch) {
      const header = headerMatch[1];
      if (/日本語|日语/i.test(header)) {
        inJapanese = true;
      } else {
        inJapanese = false;
      }
    }

    if (!inJapanese) {
      output.push(line);
      continue;
    }

    if (line.includes('<ruby>') || line.includes('<rt>')) {
      output.push(line);
      continue;
    }

    // Do not mutate existing HTML fragments (e.g. audio tags), otherwise
    // filenames/attributes can be corrupted by ruby conversion.
    if (/<[^>]+>/.test(line)) {
      output.push(line);
      continue;
    }

    const hasKanji = /[\u3400-\u9FFF々〆ヵヶ]/.test(line);
    if (!hasKanji) {
      output.push(line);
      continue;
    }

    const inlineMatch = line.match(/^(\s*-\s*\*\*[^*]+?\*\*:\s*)(.+)$/);
    const isTranslationLine = /^\s*-\s+/.test(line) && !/\*\*[^*]+?\*\*:\s*/.test(line);
    if (isTranslationLine) {
      output.push(line);
      continue;
    }
    if (inlineMatch) {
      const prefix = inlineMatch[1];
      const content = stripKatakanaReadings(inlineMatch[2]);
      const withRuby = content.replace(rubyPattern, '<ruby>$1<rt>$2</rt></ruby>');
      if (withRuby !== content) {
        output.push(`${prefix}${withRuby}`);
        continue;
      }
      const converted = await toRuby(content);
      output.push(`${prefix}${converted}`);
      continue;
    }

    const sanitizedLine = stripKatakanaReadings(line);
    const replaced = sanitizedLine.replace(rubyPattern, '<ruby>$1<rt>$2</rt></ruby>');
    if (replaced !== sanitizedLine) {
      output.push(replaced);
      continue;
    }
    const converted = await toRuby(sanitizedLine);
    output.push(converted);
  }
  return output.join('\n');
}

function injectAudioTags(markdown, baseName, audioTasks) {
  if (!markdown) return '';
  const audioMap = new Map();
  (audioTasks || []).forEach((task) => {
    if (!task || !task.lang || !task.filename_suffix) return;
    const key = `${task.lang}:${task.filename_suffix.replace(/^_/, '')}`;
    audioMap.set(key, task.filename_suffix);
  });

  const lines = String(markdown).split(/\r?\n/);
  let currentLang = null;
  const output = [];

  lines.forEach((line) => {
    const headerMatch = line.match(/^##\s*\d+\.\s*(.+)\s*$/);
    if (headerMatch) {
      const header = headerMatch[1];
      if (/英文/i.test(header)) currentLang = 'en';
      else if (/日本語|日语/i.test(header)) currentLang = 'ja';
      else currentLang = null;
    }

    const exampleMatch = line.match(/^\s*-\s*\*\*例句(\d+)\*\*:/);
    if (exampleMatch && currentLang) {
      const index = exampleMatch[1];
      const suffixKey = `${currentLang}:${currentLang}_${index}`;
      const suffix = audioMap.get(suffixKey) || `_${currentLang}_${index}`;
      output.push(`${line} <audio src="${baseName}${suffix}.wav"></audio>`);
    } else {
      output.push(line);
    }
  });

  return output.join('\n');
}

async function prepareMarkdownForCard(markdown, options = {}) {
  const { baseName = 'phrase', audioTasks = [] } = options;
  const normalized = await normalizeJapaneseRuby(markdown);
  const hasAudio =
    /<div\s+class=["']audio["']\s*>/i.test(normalized) || /<audio\b/i.test(normalized);
  if (hasAudio) return normalized;
  return injectAudioTags(normalized, baseName, audioTasks);
}

async function renderHtmlFromMarkdown(markdown, options = {}) {
  const { baseName = 'phrase', audioTasks = [], prepared = false } = options;
  const markdownWithAudio = prepared
    ? markdown
    : await prepareMarkdownForCard(markdown, { baseName, audioTasks });

  marked.setOptions({ mangle: false, headerIds: false });
  const contentHtml = marked.parse(markdownWithAudio);
  const faviconDataUri =
    "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 64 64'%3E%3Crect x='2' y='2' width='60' height='60' rx='12' fill='%231f3b8f'/%3E%3Ctext x='32' y='40' text-anchor='middle' font-family='Arial,Helvetica,sans-serif' font-size='24' font-weight='700' fill='white'%3ELAN%3C/text%3E%3C/svg%3E";

  const styles = `
    :root { --accent: #c48a3b; --ink: #1d1c1a; --paper: #ffffff; }
    html, body { font-size: 1.5rem; }
    body {
      margin: 0;
      padding: 0;
      color: var(--ink);
      background: linear-gradient(135deg, #f3f1ec, #e7e1d7);
      font-family: 'Noto Serif CJK JP', 'Noto Serif CJK SC', 'Source Han Serif', 'Songti SC',
        'Hiragino Mincho ProN', 'Yu Mincho', 'SimSun', 'Georgia', 'Times New Roman', serif;
      line-height: 1.6;
    }
    .main {
      max-width: 1200px;
      width: 90%;
      margin: 2.5rem auto;
    }
    .card {
      background: var(--paper);
      border-radius: 18px;
      border: 1px solid rgba(30, 30, 30, 0.1);
      box-shadow: 0 12px 30px rgba(0, 0, 0, 0.08);
      padding: 2.4rem 2.8rem;
    }
    h1 {
      font-size: 2.1rem;
      line-height: 1.35;
      margin: 0 0 1rem 0;
    }
    h2 {
      font-size: 1.5rem;
      line-height: 1.35;
      margin-top: 1.6rem;
      padding-left: 0.75rem;
      border-left: 4px solid var(--accent);
    }
    ul { list-style: none; padding-left: 1rem; }
    li { margin: 0.2em 0; }
    li::before { content: '•'; color: var(--accent); display: inline-block; width: 1em; }
    rt { font-size: 0.65em; color: #666; font-family: 'Noto Sans JP', 'Hiragino Sans',
         'Noto Sans SC', 'PingFang SC', 'Microsoft YaHei', 'Source Han Sans', sans-serif; }
    .explanation-text { font-size: 0.9em; color: #888; }
    .loanword-block { display: block; margin-top: 0.5em; padding: 0.35em 0.55em 0.45em 0.6em; border-left: 3px solid rgba(249,115,22,0.9); background: linear-gradient(90deg, rgba(249,115,22,0.1), rgba(249,115,22,0.03)); border-radius: 8px; }
    .loanword-label { display: block; font-size: 0.68em; font-weight: 700; color: #b45309; margin-bottom: 0.25em; letter-spacing: .02em; }
    .loanword-line { display: flex; flex-wrap: wrap; gap: 6px; }
    .loanword-tag { display: inline-block; font-size: 0.75em; font-family: monospace; font-weight: 700; background: rgba(251,146,60,0.16); color: #9a3412; border: 1px solid rgba(249,115,22,0.4); border-radius: 999px; padding: 2px 10px; white-space: nowrap; }
    .audio { margin: 0.35em 0 0.75em 0; }
    audio { display: inline-block; width: auto; max-width: 200px; height: 28px; vertical-align: middle; margin-left: 0.3em; }
    @media (max-width: 720px) {
      .card { padding: 1.6rem 1.4rem; }
      h1 { font-size: 1.8rem; }
      h2 { font-size: 1.3rem; }
    }
  `;

  return `<!doctype html>
<html lang="ja">
  <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <title>${baseName}</title>
    <link rel="icon" type="image/svg+xml" href="${faviconDataUri}">
    <link rel="shortcut icon" href="${faviconDataUri}">
    <style>${styles}</style>
  </head>
  <body>
    <main class="main">
      <article class="card">
        ${contentHtml}
      </article>
    </main>
  </body>
</html>`;
}

module.exports = { renderHtmlFromMarkdown, buildAudioTasksFromMarkdown, prepareMarkdownForCard };
