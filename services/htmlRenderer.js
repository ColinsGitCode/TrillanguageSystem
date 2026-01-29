const { marked } = require('marked');

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

    output.push(line);

    const exampleMatch = line.match(/^\s*-\s*\*\*例句(\d+)\*\*:/);
    if (exampleMatch && currentLang) {
      const index = exampleMatch[1];
      const suffixKey = `${currentLang}:${currentLang}_${index}`;
      const suffix = audioMap.get(suffixKey) || `_${currentLang}_${index}`;
      output.push(
        `  <div class="audio"><audio controls src="${baseName}${suffix}.wav"></audio></div>`
      );
    }
  });

  return output.join('\n');
}

function renderHtmlFromMarkdown(markdown, options = {}) {
  const { baseName = 'phrase', audioTasks = [] } = options;
  const markdownWithAudio = injectAudioTags(markdown, baseName, audioTasks);

  marked.setOptions({ mangle: false, headerIds: false });
  const contentHtml = marked.parse(markdownWithAudio);

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
    .audio { margin: 0.35em 0 0.75em 0; }
    audio { width: 100%; max-width: 360px; }
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

module.exports = { renderHtmlFromMarkdown, buildAudioTasksFromMarkdown };
