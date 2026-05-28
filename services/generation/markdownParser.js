function initSection() {
  return {
    translation: '',
    explanation: '',
    examples: [],
    register: '',
    disambiguation: ''
  };
}

function parseLoanwordLine(text) {
  // Legacy format: 外来语标注: English = カタカナ
  const match = text.match(/外来语标注:\s*([^=]+?)\s*=\s*(.+)$/);
  if (match) return { en: match[1].trim(), ja: match[2].trim() };
  // New HTML span format: <span class="loanword-tag">English → カタカナ</span>
  const tagMatch = text.match(/loanword-tag[^>]*>([^→<]+?)\s*→\s*([^<]+)</);
  if (tagMatch) return { en: tagMatch[1].trim(), ja: tagMatch[2].trim() };
  return null;
}

function parseLoanwordTags(text) {
  const results = [];
  const re = /loanword-tag[^>]*>([^→<]+?)\s*→\s*([^<]+)</g;
  let m;
  while ((m = re.exec(text)) !== null) {
    results.push({ en: m[1].trim(), ja: m[2].trim() });
  }
  return results;
}

function parseTrilingualMarkdown(markdown) {
  const result = {
    title: '',
    sections: {
      en: initSection(),
      ja: initSection(),
      zh: initSection()
    },
    meta: {
      hasTitle: false,
      sectionOrder: []
    }
  };

  if (!markdown) return result;

  const lines = String(markdown).split(/\r?\n/);
  let current = null;
  let lastExample = null;

  for (const line of lines) {
    const h1Match = line.match(/^#\s+(.+)\s*$/);
    if (h1Match && !result.title) {
      result.title = h1Match[1].trim();
      result.meta.hasTitle = true;
      continue;
    }

    const h2Match = line.match(/^##\s*\d+\.\s*(.+)\s*$/);
    if (h2Match) {
      const header = h2Match[1];
      if (/英文/i.test(header)) current = 'en';
      else if (/日本語|日语/i.test(header)) current = 'ja';
      else if (/中文/i.test(header)) current = 'zh';
      else current = null;
      if (current) result.meta.sectionOrder.push(current);
      lastExample = null;
      continue;
    }

    if (!current) continue;

    const labeledMatch = line.match(/^\s*-\s*\*\*([^*]+)\*\*:\s*(.+)$/);
    if (labeledMatch) {
      const label = labeledMatch[1].trim();
      const value = labeledMatch[2].trim();

      if (/翻译|翻訳/.test(label)) {
        result.sections[current].translation = value;
        lastExample = null;
        continue;
      }

      if (/解释|解説/.test(label)) {
        result.sections[current].explanation = value;
        lastExample = null;
        continue;
      }

      if (/语域/.test(label)) {
        result.sections[current].register = value;
        lastExample = null;
        continue;
      }

      if (/辨析/.test(label)) {
        result.sections[current].disambiguation = value;
        lastExample = null;
        continue;
      }

      if (/例句/.test(label)) {
        const example = { text: value, translation: '', loanwords: [] };
        result.sections[current].examples.push(example);
        lastExample = example;
        continue;
      }
    }

    const bulletMatch = line.match(/^\s*-\s+(.+)$/);
    if (bulletMatch && lastExample) {
      const text = bulletMatch[1].trim();
      // Check for multiple loanword tags (new HTML span format)
      const multiTags = parseLoanwordTags(text);
      if (multiTags.length > 0) {
        lastExample.loanwords.push(...multiTags);
        continue;
      }
      // Check for single loanword (legacy format)
      const loanword = parseLoanwordLine(text);
      if (loanword) {
        lastExample.loanwords.push(loanword);
        continue;
      }
      if (!lastExample.translation) {
        lastExample.translation = text;
      }
    }
  }

  return result;
}

module.exports = { parseTrilingualMarkdown };
