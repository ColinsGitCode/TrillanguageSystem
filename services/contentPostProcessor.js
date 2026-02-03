const KANA_REGEX = /[\u3040-\u309F\u30A0-\u30FF\uFF65-\uFF9F]/g;
const KANA_PAREN_REGEX = /[（(][\u3040-\u309F\u30A0-\u30FF\uFF65-\uFF9F\u30FC\s]+[）)]/g;

function stripRuby(text) {
  if (!text) return '';
  return String(text)
    .replace(/<rt>.*?<\/rt>/gi, '')
    .replace(/<rp>.*?<\/rp>/gi, '')
    .replace(/<\/?ruby>/gi, '');
}

function cleanChineseTranslation(text) {
  let cleaned = stripRuby(text);
  cleaned = cleaned.replace(KANA_PAREN_REGEX, '');
  cleaned = cleaned.replace(KANA_REGEX, '');
  cleaned = cleaned.replace(/[\u30FC]+/g, '');
  cleaned = cleaned.replace(/\s+/g, ' ').trim();
  return cleaned;
}

function normalizeJapaneseHeader(line) {
  if (!/^\s*##\s*\d+\./.test(line)) return line;
  if (!/日本語|日语/.test(line)) return line;
  return '## 2. 日本語:';
}

function cleanJapaneseTranslations(markdown) {
  if (!markdown) return markdown;
  const lines = String(markdown).split(/\r?\n/);
  const output = [];
  let inJapanese = false;

  for (const line of lines) {
    const headerMatch = line.match(/^\s*##\s*(\d+)\.\s*(.+)$/);
    if (headerMatch) {
      const headerText = headerMatch[2];
      inJapanese = /日本語|日语/.test(headerText);
      output.push(normalizeJapaneseHeader(line));
      continue;
    }

    if (!inJapanese) {
      output.push(line);
      continue;
    }

    const translationMatch = line.match(/^(\s*-\s+)(.*)$/);
    const isLabeled = /\*\*[^*]+?\*\*:\s*/.test(line);
    if (translationMatch && !isLabeled) {
      const prefix = translationMatch[1];
      const content = translationMatch[2];
      const cleaned = cleanChineseTranslation(content);
      output.push(`${prefix}${cleaned}`);
      continue;
    }

    output.push(line);
  }

  return output.join('\n');
}

function dedupeTechSection(markdown) {
  if (!markdown) return markdown;
  const lines = String(markdown).split(/\r?\n/);
  const output = [];
  let seenTech = false;
  let skipping = false;

  for (const line of lines) {
    const isHeading = /^\s*##\s*\d+\./.test(line);
    const isTech = /^\s*##\s*4\.\s*技术概念简要说明/.test(line);

    if (skipping) {
      if (isHeading && !isTech) {
        skipping = false;
      } else {
        continue;
      }
    }

    if (isTech) {
      if (seenTech) {
        skipping = true;
        continue;
      }
      seenTech = true;
      output.push(line);
      continue;
    }

    output.push(line);
  }

  return output.join('\n');
}

function sanitizeAudioTasks(tasks = []) {
  if (!Array.isArray(tasks)) return [];
  return tasks.map((task) => {
    const normalized = { ...task };
    let text = stripRuby(normalized.text || '').trim();
    if (normalized.lang === 'en') {
      text = text.replace(/[.!?。！？]+$/g, '');
    }
    if (normalized.lang === 'ja') {
      text = text.replace(KANA_PAREN_REGEX, '').replace(/\s+/g, ' ').trim();
    }
    normalized.text = text;
    return normalized;
  });
}

function postProcessGeneratedContent(content) {
  if (!content || typeof content !== 'object') return content;
  let markdown = content.markdown_content || '';
  markdown = cleanJapaneseTranslations(markdown);
  markdown = dedupeTechSection(markdown);
  content.markdown_content = markdown;
  if (Array.isArray(content.audio_tasks)) {
    content.audio_tasks = sanitizeAudioTasks(content.audio_tasks);
  }
  return content;
}

module.exports = {
  postProcessGeneratedContent,
};
