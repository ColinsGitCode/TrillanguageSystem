const CJK = '぀-ヿ㐀-鿿々〆ヵヶ';
const EXCLUDED_TAGS = new Set(['audio', 'button', 'rp', 'rt', 'script', 'source', 'style']);
const EXCLUDED_CLASSES = new Set([
  'audio-btn',
  'card-selection-toolbar',
  'loanword-block',
  'loanword-label',
  'loanword-line',
  'loanword-tag',
]);
const BLOCK_TAGS = new Set(['article', 'div', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'li', 'ol', 'p', 'section', 'tr', 'ul']);

function appendPair(output, ch, marked = false) {
  output.push({ ch, marked: Boolean(marked) });
}

function isExcludedElement(element) {
  if (EXCLUDED_TAGS.has(element.tagName.toLowerCase())) return true;
  return Array.from(element.classList || []).some((className) => EXCLUDED_CLASSES.has(className));
}

function walk(node, output, marked = false) {
  if (!node) return;
  if (node.nodeType === 3) {
    for (const ch of String(node.nodeValue || '')) appendPair(output, ch, marked);
    return;
  }
  if (node.nodeType !== 1 && node.nodeType !== 11) return;

  if (node.nodeType === 11) {
    Array.from(node.childNodes).forEach((child) => walk(child, output, marked));
    return;
  }

  const element = node;
  if (isExcludedElement(element)) return;
  const tag = element.tagName.toLowerCase();
  if (tag === 'br') {
    appendPair(output, ' ');
    return;
  }

  const inStudyHighlight = marked || (tag === 'mark' && element.classList.contains('study-highlight-red'));
  const block = BLOCK_TAGS.has(tag);
  if (block) appendPair(output, ' ');
  Array.from(element.childNodes).forEach((child) => walk(child, output, inStudyHighlight));
  if (block) appendPair(output, ' ');
}

export function normalizeProjectionPairs(pairs) {
  const normalized = [];
  for (const pair of pairs) {
    const source = String(pair.ch || '').normalize('NFKC');
    for (const ch of source === '▶' ? ' ' : source) appendPair(normalized, ch, pair.marked);
  }

  const collapsed = [];
  for (const pair of normalized) {
    if (/\s/.test(pair.ch)) {
      const previous = collapsed.at(-1);
      if (previous && previous.ch === ' ') {
        previous.marked = previous.marked || pair.marked;
      } else {
        appendPair(collapsed, ' ', pair.marked);
      }
    } else {
      appendPair(collapsed, pair.ch, pair.marked);
    }
  }

  const cjk = new RegExp(`[${CJK}]`);
  const output = [];
  for (let index = 0; index < collapsed.length; index += 1) {
    const pair = collapsed[index];
    const previous = collapsed[index - 1]?.ch;
    const next = collapsed[index + 1]?.ch;
    if (pair.ch === ' ' && previous && next && (
      (cjk.test(previous) && (cjk.test(next) || /[、。！？：；，．）)]/.test(next))) ||
      (/[（(]/.test(previous) && cjk.test(next))
    )) continue;
    appendPair(output, pair.ch, pair.marked);
  }

  while (output[0]?.ch === ' ') output.shift();
  while (output.at(-1)?.ch === ' ') output.pop();
  return output;
}

export function normalizeProjectionText(text) {
  const pairs = Array.from(String(text || ''), (ch) => ({ ch, marked: false }));
  return normalizeProjectionPairs(pairs).map((pair) => pair.ch).join('');
}

export function buildVisibleTextProjection(root) {
  const rawPairs = [];
  walk(root, rawPairs);
  const pairs = normalizeProjectionPairs(rawPairs);
  return {
    rawText: rawPairs.map((pair) => pair.ch).join(''),
    text: pairs.map((pair) => pair.ch).join(''),
    pairs,
  };
}
