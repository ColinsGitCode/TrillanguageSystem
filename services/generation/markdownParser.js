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
  const match = text.match(/外来语标注:\s*(.+)$/);
  if (match) return parseLoanwordContent(match[1]);
  const tagMatch = text.match(/loanword-tag[^>]*>([^<]+)</);
  if (tagMatch) return parseLoanwordContent(tagMatch[1]);
  return null;
}

function parseLoanwordContent(text) {
  const dotted = String(text || '').split(/\s*·\s*/u).map((part) => part.trim()).filter(Boolean);
  if (dotted.length >= 3) return { zh: dotted[0], en: dotted[1], ja: dotted.slice(2).join(' · ') };
  const equals = String(text || '').split(/\s*=\s*/u).map((part) => part.trim()).filter(Boolean);
  if (equals.length >= 3) return { zh: equals[0], en: equals[1], ja: equals.slice(2).join(' = ') };
  const arrow = String(text || '').split(/\s*→\s*/u).map((part) => part.trim()).filter(Boolean);
  if (arrow.length >= 2) return { en: arrow[0], ja: arrow.slice(1).join(' → ') };
  if (equals.length >= 2) return { en: equals[0], ja: equals.slice(1).join(' = ') };
  return null;
}

function parseLoanwordTags(text) {
  const results = [];
  const re = /loanword-tag[^>]*>([^<]+)</g;
  let m;
  while ((m = re.exec(text)) !== null) {
    const parsed = parseLoanwordContent(m[1]);
    if (parsed) results.push(parsed);
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

    const standaloneLoanwords = lastExample ? parseLoanwordTags(line) : [];
    if (standaloneLoanwords.length > 0) {
      lastExample.loanwords.push(...standaloneLoanwords);
      continue;
    }

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
