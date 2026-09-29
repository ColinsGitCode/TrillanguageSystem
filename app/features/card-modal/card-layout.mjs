// Reading-layout helpers for the card modal, kept in plain JavaScript so the
// unit tests can load them without a TypeScript toolchain.
//
// Highlights and notes are anchored to the card's visible text (see
// text-projection.mjs). Everything here therefore either reads the Markdown or
// adds attributes and inline wrappers to the rendered card: it never adds,
// removes or reorders a character of that text. Hiding is done with CSS.

import { showsReadingAbove } from './reading-layer.mjs';

const SECTION_LANGS = [
  [/^(英文|英语|English)$/iu, 'en'],
  [/^(日本語|日语|日文)$/u, 'ja'],
  [/^(中文|汉语)$/u, 'zh'],
];

const FIELD_LABELS = [
  [/^(翻译|翻訳)$/u, 'translation'],
  [/^(解释|解説)$/u, 'explanation'],
  [/^例句\s*\d*$/u, 'example'],
  [/^语域$/u, 'register'],
  [/^辨析$/u, 'distinction'],
  [/^中文$/u, 'zh'],
  [/^(英文|英语)$/u, 'en'],
  [/^(日本語|日语|日文)$/u, 'ja'],
  [/^使用提示$/u, 'tip'],
];

const FIELD_LINE = /^\s*[-*]\s*\*\*(.+?)\*\*\s*[:：]\s*(.*)$/u;
const STOP_TAGS = new Set(['UL', 'OL', 'DIV', 'ASIDE', 'P', 'BLOCKQUOTE']);

/** "1. 英文:" → { label: "英文", lang: "en" }; "3. 常见误用（中文）" → { label: "常见误用", lang: null }. */
export function sectionInfo(headingText) {
  const label = String(headingText || '')
    .replace(/\s+/gu, ' ')
    .trim()
    .replace(/^\d+\s*[.．、]\s*/u, '')
    .replace(/\s*[:：]\s*$/u, '')
    .replace(/\s*[（(](中文|日文|英文)[)）]\s*$/u, '')
    .trim();
  const lang = SECTION_LANGS.find(([pattern]) => pattern.test(label))?.[1] || null;
  return { label, lang };
}

/** The role of a "**label**: value" line, from its label. */
export function fieldOf(label) {
  const text = String(label || '').trim();
  return FIELD_LABELS.find(([pattern]) => pattern.test(text))?.[1] || 'other';
}

/** Plain text of a Markdown value: no audio tags, ruby readings, markup or emphasis. */
export function cleanMarkdownValue(value) {
  return String(value || '')
    .replace(/<audio\b[^>]*>(?:<\/audio>)?/giu, '')
    .replace(/<rt>[\s\S]*?<\/rt>|<rp>[\s\S]*?<\/rp>/giu, '')
    .replace(/<[^>]+>/gu, '')
    .replace(/\*\*|__/gu, '')
    .replace(/\s+/gu, ' ')
    .trim();
}

function trimTrailingPunctuation(text) {
  return String(text || '').replace(/[。．.！!？?、,，\s]+$/u, '');
}

/** The reading an older card wrote inline as <ruby>, or null when it has none. */
export function rubyReading(value) {
  const source = String(value || '');
  if (!/<ruby\b/iu.test(source)) return null;
  const reading = source
    .replace(/<audio\b[^>]*>(?:<\/audio>)?/giu, '')
    .replace(/<ruby>([\s\S]*?)<\/ruby>/giu, (_whole, inner) => {
      const rt = /<rt>([\s\S]*?)<\/rt>/iu.exec(inner);
      return rt ? rt[1] : inner;
    })
    .replace(/<[^>]+>/gu, '')
    .replace(/\*\*/gu, '')
    .trim();
  return trimTrailingPunctuation(reading) || null;
}

function markdownFields(markdown) {
  const sections = {};
  let current = null;
  for (const line of String(markdown || '').split(/\r?\n/u)) {
    const heading = /^##\s+(.+)$/u.exec(line);
    if (heading) {
      current = sectionInfo(cleanMarkdownValue(heading[1])).lang;
      continue;
    }
    if (/^#\s/u.test(line)) current = null;
    if (!current) continue;
    const field = FIELD_LINE.exec(line);
    if (!field) continue;
    const kind = fieldOf(cleanMarkdownValue(field[1]));
    sections[current] ||= {};
    if (!(kind in sections[current])) sections[current][kind] = field[2];
  }
  return sections;
}

/**
 * The three translations a trilingual card opens with, or null when the card
 * does not have all three. `jaRubyReading` is set only for older cards that
 * carried the reading inline.
 */
export function extractTrilingualSummary(markdown) {
  const sections = markdownFields(markdown);
  const en = cleanMarkdownValue(sections.en?.translation);
  const jaRaw = sections.ja?.translation;
  const ja = cleanMarkdownValue(jaRaw);
  const zh = cleanMarkdownValue(sections.zh?.translation);
  if (!en || !ja || !zh) return null;
  return {
    en,
    ja,
    jaRubyReading: rubyReading(jaRaw),
    zh,
    register: cleanMarkdownValue(sections.zh?.register) || null,
  };
}

function indexOfSequence(haystack, needle, from = 0) {
  outer: for (let index = Math.max(0, from); index + needle.length <= haystack.length; index += 1) {
    for (let offset = 0; offset < needle.length; offset += 1) {
      if (haystack[index + offset] !== needle[offset]) continue outer;
    }
    return index;
  }
  return -1;
}

/**
 * The kana reading of `text` as it appears after the 翻訳 label in the
 * pronunciation plain text: each word with kanji contributes its reading and
 * everything else stays as written. Null when no word in it needed one.
 */
export function readingFromTokens(plainText, tokens, text) {
  const chars = Array.from(String(plainText || ''));
  const target = Array.from(String(text || '').trim());
  if (!chars.length || !target.length || !Array.isArray(tokens)) return null;
  const label = indexOfSequence(chars, Array.from('翻訳'));
  const start = indexOfSequence(chars, target, label >= 0 ? label : 0);
  if (start < 0) return null;
  const end = start + target.length;
  const byStart = new Map();
  for (const token of tokens) {
    if (token && Number.isInteger(token.startCodePoint) && !byStart.has(token.startCodePoint)) {
      byStart.set(token.startCodePoint, token);
    }
  }
  let reading = '';
  let usedReading = false;
  for (let point = start; point < end;) {
    const token = byStart.get(point);
    if (token && token.endCodePoint <= end && token.endCodePoint > point
      && showsReadingAbove(token.surface, token.readingHiragana)) {
      reading += String(token.readingHiragana).trim();
      usedReading = true;
      point = token.endCodePoint;
      continue;
    }
    reading += chars[point];
    point += 1;
  }
  return usedReading ? trimTrailingPunctuation(reading) || null : null;
}

/** One entry per scenario expression, labelled by its Chinese sentence. */
export function extractScenarioOutline(markdown) {
  const items = [];
  let current = null;
  for (const line of String(markdown || '').split(/\r?\n/u)) {
    const heading = /^###\s+(\d{1,2})\s*[.．]\s*(.*)$/u.exec(line);
    if (heading) {
      current = { index: heading[1].padStart(2, '0'), title: cleanMarkdownValue(heading[2]), zh: '' };
      items.push(current);
      continue;
    }
    if (/^#{1,2}\s/u.test(line)) {
      current = null;
      continue;
    }
    const field = current && !current.zh ? FIELD_LINE.exec(line) : null;
    if (field && fieldOf(cleanMarkdownValue(field[1])) === 'zh') current.zh = cleanMarkdownValue(field[2]);
  }
  return items.map(({ index, title, zh }) => ({ index, label: zh || title || `表达 ${index}` }));
}

function visibleText(element) {
  let text = '';
  for (const node of element.childNodes) {
    if (node.nodeType === 3) text += node.nodeValue || '';
    else if (node.nodeType === 1 && !/^(RT|RP|BUTTON|AUDIO)$/u.test(node.tagName)) text += visibleText(node);
  }
  return text;
}

function leadingTextNode(node) {
  if (!node) return null;
  if (node.nodeType === 3) return node;
  if (node.nodeType === 1 && !isStop(node) && node.firstChild) return leadingTextNode(node.firstChild);
  return null;
}

function isStop(node) {
  return node.nodeType === 1 && STOP_TAGS.has(node.tagName);
}

// Splits "**label**: value" into label, separator and value spans so the value
// can sit in its own column and the ": " can be hidden. Text is only wrapped.
function decorateField(owner, doc) {
  let label = null;
  for (const node of owner.childNodes) {
    if (node.nodeType === 3 && !(node.nodeValue || '').trim()) continue;
    label = node.nodeType === 1 && node.tagName === 'STRONG' ? node : null;
    break;
  }
  if (!label) return null;
  label.classList.add('card-field-label');

  let next = label.nextSibling;
  // The separator is a bare text node in the Markdown renderer and the first
  // text inside a <span> in Card Reader v3.
  const firstText = leadingTextNode(next);
  const match = firstText ? /^\s*[:：]\s*/u.exec(firstText.nodeValue || '') : null;
  if (match) {
    if (match[0].length < firstText.nodeValue.length) firstText.splitText(match[0].length);
    const separator = doc.createElement('span');
    separator.className = 'card-field-sep';
    firstText.before(separator);
    separator.appendChild(firstText);
    if (next === firstText) next = separator.nextSibling;
  }
  const moving = [];
  while (next && !isStop(next)) {
    moving.push(next);
    next = next.nextSibling;
  }
  if (moving.length) {
    const body = doc.createElement('span');
    body.className = 'card-field-body';
    moving[0].before(body);
    moving.forEach((node) => body.appendChild(node));
    glueTrailingButton(body, doc);
  }
  return visibleText(label);
}

function lastTextNode(node) {
  if (!node) return null;
  if (node.nodeType === 3) return (node.nodeValue || '').trim() ? node : null;
  if (node.nodeType !== 1 || /^(BUTTON|AUDIO|RT|RP)$/u.test(node.tagName)) return null;
  for (let child = node.lastChild; child; child = child.previousSibling) {
    const found = lastTextNode(child);
    if (found) return found;
  }
  return null;
}

// Keeps a trailing play button on the line of the sentence's last word, so it
// never wraps onto a line of its own. Only wraps nodes; no text changes. A run
// without spaces (Japanese, Chinese) contributes its last few characters, so
// a whole sentence is never held on one line.
function glueTrailingButton(body, doc) {
  // Card Reader v3 follows the button with a <span> holding only a newline.
  const blank = (node) => (node.nodeType === 3 || (node.nodeType === 1 && node.tagName === 'SPAN' && !node.children.length))
    && !(node.textContent || '').trim();
  let button = body.lastChild;
  while (button && blank(button)) button = button.previousSibling;
  if (!button || button.nodeType !== 1 || !button.classList.contains('audio-btn')) return;
  let text = null;
  for (let node = button.previousSibling; node && !text; node = node.previousSibling) text = lastTextNode(node);
  if (!text) return;
  const value = text.nodeValue || '';
  const run = /(\S+)\s*$/u.exec(value);
  if (!run) return;
  const chars = Array.from(run[1]);
  const keep = chars.length > 12 ? chars.slice(-3).join('') : run[1];
  const tail = text.splitText(value.length - (value.length - run.index - run[1].length) - keep.length);
  const glue = doc.createElement('span');
  glue.className = 'card-field-tail';
  tail.before(glue);
  glue.appendChild(tail);
  glue.appendChild(button);
}

function groupScenarioBlocks(root, doc) {
  const headings = Array.from(root.querySelectorAll('h3'))
    .filter((heading) => /^\s*\d{1,2}\s*[.．]/u.test(visibleText(heading)));
  for (const heading of headings) {
    const index = /\d{1,2}/u.exec(visibleText(heading))[0].padStart(2, '0');
    const members = [heading];
    let next = heading.nextSibling;
    while (next && !(next.nodeType === 1 && /^(H1|H2|H3|HR)$/u.test(next.tagName))) {
      members.push(next);
      next = next.nextSibling;
    }
    const block = doc.createElement('article');
    block.className = 'card-scenario-block';
    block.dataset.blockIndex = index;
    heading.before(block);
    members.forEach((node) => block.appendChild(node));
  }
}

/**
 * Marks up a rendered card for the reading layout: section headings get a
 * clean label and language, "label: value" items get a field role and a value
 * column, and scenario expressions are grouped into blocks. Idempotent.
 */
export function decorateCardRoot(root, cardType) {
  if (!root || root.dataset?.cardLayout === 'v1') return;
  const doc = root.ownerDocument;
  root.querySelectorAll('h2').forEach((heading) => {
    const { label, lang } = sectionInfo(visibleText(heading));
    if (!label) return;
    heading.dataset.sectionLabel = label;
    if (lang) heading.dataset.sectionLang = lang;
  });
  root.querySelectorAll('li').forEach((item) => {
    let owner = item;
    const first = Array.from(item.children)[0];
    if (first && first.tagName === 'P' && item.firstElementChild === first) owner = first;
    const label = decorateField(owner, doc);
    if (label !== null) item.dataset.cardField = fieldOf(label);
  });
  if (cardType === 'scenario_phrase') groupScenarioBlocks(root, doc);
  root.dataset.cardLayout = 'v1';
}
