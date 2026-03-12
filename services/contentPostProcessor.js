const KANA_REGEX = /[\u3040-\u309F\u30A0-\u30FF\uFF65-\uFF9F]/g;
const KANA_PAREN_REGEX = /[（(][\u3040-\u309F\u30A0-\u30FF\uFF65-\uFF9F\u30FC\s]+[）)]/g;
const LOANWORD_PAREN_REGEX = /([\u30A0-\u30FF\u30FC]+)\(([A-Za-z0-9][A-Za-z0-9\s._-]*)\)/g;
const LOANWORD_READING_REGEX =
  /([\u30A1-\u30FA\u30FC\u30FB\u30FD\u30FEA-Za-zＡ-Ｚａ-ｚ0-9０-９._/-]+)\s*[（(][\u3041-\u3096\u30A1-\u30FA\u30FC\u30FB\s]+[）)]/g;
const LOANWORD_LABEL = '外来语标注';
const LEGACY_LOANWORD_LINE_REGEX = /^(\s*)-\s*外来语标注[:：]\s*(.*)$/i;
const INLINE_LOANWORD_SPLIT_REGEX = /^(.*?)\s+[-—–]\s*外来语标注[:：]\s*(.+)$/i;

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
    const isLoanwordLine = line.includes(LOANWORD_LABEL);
    if (translationMatch && !isLabeled && !isLoanwordLine) {
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

function stripKatakanaReadings(text) {
  let cleaned = String(text || '');
  let previous = '';
  while (cleaned !== previous) {
    previous = cleaned;
    cleaned = cleaned.replace(LOANWORD_READING_REGEX, '$1');
  }
  return cleaned;
}

function stripLoanwordReadingsInJapanese(markdown) {
  if (!markdown) return markdown;
  const lines = String(markdown).split(/\r?\n/);
  const output = [];
  let inJapanese = false;

  for (const line of lines) {
    const headerMatch = line.match(/^\s*##\s*(\d+)\.\s*(.+)$/);
    if (headerMatch) {
      const headerText = headerMatch[2];
      inJapanese = /日本語|日语/.test(headerText);
      output.push(line);
      continue;
    }

    if (!inJapanese) {
      output.push(line);
      continue;
    }

    if (line.includes('loanword-block') || line.includes(LOANWORD_LABEL)) {
      output.push(line);
      continue;
    }

    output.push(stripKatakanaReadings(line));
  }

  return output.join('\n');
}

function relocateLoanwordAnnotations(markdown) {
  if (!markdown) return markdown;
  const lines = String(markdown).split(/\r?\n/);
  const output = [];
  let inJapanese = false;
  let pending = null;
  let pendingIndent = '  ';

  function renderLoanwordBlock(items = [], indent = '  ') {
    if (!items.length) return null;
    const tags = items
      .map((item) => {
        const en = String(item.en || '').trim();
        const ja = String(item.ja || '').trim();
        if (!en && !ja) return '';
        if (!ja) return `<span class="loanword-tag">${en}</span>`;
        return `<span class="loanword-tag">${en} → ${ja}</span>`;
      })
      .filter(Boolean)
      .join(' ');
    if (!tags) return null;
    return `${indent}<div class="loanword-block"><span class="loanword-label">${LOANWORD_LABEL}</span><span class="loanword-line">${tags}</span></div>`;
  }

  function parseLegacyLoanwordPairs(text) {
    const looksKana = (s) => /[\u30A0-\u30FF]/.test(String(s || ''));
    const looksLatin = (s) => /[A-Za-z]/.test(String(s || ''));
    return String(text || '')
      .split(/[，,、；;]+/)
      .map((chunk) => chunk.trim())
      .filter(Boolean)
      .map((chunk) => {
        const match = chunk.match(/^([^=]+?)\s*=\s*(.+)$/);
        if (!match) return { en: chunk, ja: '' };
        let left = match[1].trim();
        let right = match[2].trim();
        if (looksKana(left) && looksLatin(right)) {
          const tmp = left;
          left = right;
          right = tmp;
        }
        return { en: left, ja: right };
      })
      .filter(Boolean);
  }

  function flushPending() {
    if (!pending || !pending.length) return;
    const block = renderLoanwordBlock(pending, pendingIndent);
    if (block) output.push(block);
    pending = null;
  }

  for (const line of lines) {
    const headerMatch = line.match(/^\s*##\s*(\d+)\.\s*(.+)$/);
    if (headerMatch) {
      if (pending) flushPending();
      const headerText = headerMatch[2];
      inJapanese = /日本語|日语/.test(headerText);
      output.push(line);
      continue;
    }

    const legacyLoanwordMatch = line.match(LEGACY_LOANWORD_LINE_REGEX);
    if (legacyLoanwordMatch) {
      const indent = legacyLoanwordMatch[1] || '  ';
      const pairs = parseLegacyLoanwordPairs(legacyLoanwordMatch[2]);
      const block = renderLoanwordBlock(
        pairs.length ? pairs : [{ en: legacyLoanwordMatch[2].trim() || '无', ja: '' }],
        indent
      );
      if (block) {
        output.push(block);
      } else {
        output.push(line);
      }
      continue;
    }

    if (!inJapanese) {
      output.push(line);
      continue;
    }

    const exampleMatch = line.match(/^(\s*-\s*\*\*例句(\d+)\*\*:\s*)(.+)$/);
    if (exampleMatch) {
      if (pending) flushPending();
      const prefix = exampleMatch[1];
      let content = exampleMatch[3];
      const extracted = [];
      content = content.replace(LOANWORD_PAREN_REGEX, (full, ja, en) => {
        extracted.push({ ja, en: en.trim() });
        return ja;
      });
      pending = extracted.length ? extracted : null;
      pendingIndent = '  ';
      output.push(`${prefix}${content}`);
      continue;
    }

    const translationMatch = line.match(/^(\s*-\s+)(.*)$/);
    const isLabeled = /\*\*[^*]+?\*\*:\s*/.test(line);
    if (translationMatch && !isLabeled) {
      const prefix = translationMatch[1];
      const content = translationMatch[2];
      const inlineLoanwordMatch = content.match(INLINE_LOANWORD_SPLIT_REGEX);

      if (inlineLoanwordMatch) {
        const translatedText = inlineLoanwordMatch[1].trim();
        const rawPairs = inlineLoanwordMatch[2].trim();
        const parsedPairs = parseLegacyLoanwordPairs(rawPairs);
        const block = renderLoanwordBlock(
          parsedPairs.length ? parsedPairs : [{ en: rawPairs, ja: '' }],
          prefix.replace(/-\s*$/, '')
        );
        output.push(`${prefix}${translatedText}`);
        if (block) output.push(block);
        pending = null;
      } else {
        output.push(line);
        if (pending) {
          pendingIndent = prefix.replace(/-\s*$/, '');
          flushPending();
        }
      }
      continue;
    }

    output.push(line);
  }

  if (pending) flushPending();
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
      text = text
        .replace(LOANWORD_READING_REGEX, '$1')
        .replace(KANA_PAREN_REGEX, '')
        .replace(/\([A-Za-z0-9][A-Za-z0-9\s._-]*\)/g, '')
        .replace(/\s+/g, ' ')
        .trim();
    }
    normalized.text = text;
    return normalized;
  });
}

function markExplanationLines(markdown) {
  if (!markdown) return markdown;
  let normalized = String(markdown);

  // Collapse duplicated wrappers produced by repeated migrations.
  const nestedWrapper =
    /<span\s+class=["']explanation-text["']>\s*<span\s+class=["']explanation-text["']>([\s\S]*?)<\/span>\s*<\/span>/gi;
  let prev = '';
  while (normalized !== prev) {
    prev = normalized;
    normalized = normalized.replace(nestedWrapper, '<span class="explanation-text">$1</span>');
  }

  return normalized.replace(
    /^(\s*-\s*\*\*)(解释|解説)(\*\*:\s*)(.+)$/gm,
    (full, head, label, tail, content) => {
      const text = String(content || '').trim();
      if (/^<span\s+class=["']explanation-text["'][^>]*>[\s\S]*<\/span>$/i.test(text)) {
        return `${head}${label}${tail}${text}`;
      }
      return `${head}${label}${tail}<span class="explanation-text">${text}</span>`;
    }
  );
}

function postProcessGeneratedContent(content) {
  if (!content || typeof content !== 'object') return content;
  let markdown = content.markdown_content || '';
  markdown = relocateLoanwordAnnotations(markdown);
  markdown = stripLoanwordReadingsInJapanese(markdown);
  markdown = cleanJapaneseTranslations(markdown);
  markdown = dedupeTechSection(markdown);
  markdown = markExplanationLines(markdown);
  content.markdown_content = markdown;
  if (Array.isArray(content.audio_tasks)) {
    content.audio_tasks = sanitizeAudioTasks(content.audio_tasks);
  }
  return content;
}

module.exports = {
  postProcessGeneratedContent,
};
