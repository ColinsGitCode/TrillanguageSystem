import { buildVisibleTextProjection } from './text-projection.mjs';

export const PROJECTION_VERSION = 'card-visible-text-v1';
const DEFAULT_CONTEXT = 32;
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

function domBoundary(container, offset) {
  return container ? { container, offset } : null;
}

function appendPair(output, ch, start = null, end = null) {
  output.push({ ch, start, end });
}

function elementBoundary(element, after = false) {
  const parent = element.parentNode;
  if (!parent) return null;
  const index = Array.prototype.indexOf.call(parent.childNodes, element);
  return index < 0 ? null : domBoundary(parent, index + (after ? 1 : 0));
}

function isExcludedElement(element) {
  if (EXCLUDED_TAGS.has(element.tagName.toLowerCase())) return true;
  return Array.from(element.classList || []).some((className) => EXCLUDED_CLASSES.has(className));
}

function walkMapped(node, output) {
  if (!node) return;
  if (node.nodeType === 3) {
    const value = String(node.nodeValue || '');
    let offset = 0;
    for (const ch of value) {
      const nextOffset = offset + ch.length;
      appendPair(output, ch, domBoundary(node, offset), domBoundary(node, nextOffset));
      offset = nextOffset;
    }
    return;
  }
  if (node.nodeType !== 1 && node.nodeType !== 11) return;
  if (node.nodeType === 11) {
    Array.from(node.childNodes).forEach((child) => walkMapped(child, output));
    return;
  }

  const element = node;
  if (isExcludedElement(element)) return;
  const tag = element.tagName.toLowerCase();
  if (tag === 'br') {
    appendPair(output, ' ', elementBoundary(element), elementBoundary(element, true));
    return;
  }

  const block = BLOCK_TAGS.has(tag);
  if (block) appendPair(output, ' ', elementBoundary(element), elementBoundary(element));
  Array.from(element.childNodes).forEach((child) => walkMapped(child, output));
  if (block) appendPair(output, ' ', elementBoundary(element, true), elementBoundary(element, true));
}

function normalizeMappedPairs(rawPairs) {
  const normalized = [];
  for (const pair of rawPairs) {
    const source = String(pair.ch || '').normalize('NFKC');
    const visible = source === '▶' ? ' ' : source;
    // TextPositionSelector offsets use DOM/JavaScript UTF-16 code units.
    for (let index = 0; index < visible.length; index += 1) {
      appendPair(normalized, visible[index], pair.start, pair.end);
    }
  }

  const collapsed = [];
  for (const pair of normalized) {
    if (/\s/u.test(pair.ch)) {
      const previous = collapsed.at(-1);
      if (previous?.ch === ' ') {
        if (!previous.start && pair.start) previous.start = pair.start;
        if (pair.end) previous.end = pair.end;
      } else {
        appendPair(collapsed, ' ', pair.start, pair.end);
      }
    } else {
      appendPair(collapsed, pair.ch, pair.start, pair.end);
    }
  }

  const cjk = new RegExp(`[${CJK}]`, 'u');
  const output = [];
  for (let index = 0; index < collapsed.length; index += 1) {
    const pair = collapsed[index];
    const previous = collapsed[index - 1]?.ch;
    const next = collapsed[index + 1]?.ch;
    if (pair.ch === ' ' && previous && next && (
      (cjk.test(previous) && (cjk.test(next) || /[、。！？：；，．）)]/u.test(next))) ||
      (/[（(]/u.test(previous) && cjk.test(next))
    )) continue;
    output.push(pair);
  }

  while (output[0]?.ch === ' ') output.shift();
  while (output.at(-1)?.ch === ' ') output.pop();
  return output;
}

export function buildCanonicalDomMap(root) {
  const rawPairs = [];
  walkMapped(root, rawPairs);
  const pairs = normalizeMappedPairs(rawPairs);
  const text = pairs.map((pair) => pair.ch).join('');
  const productionText = buildVisibleTextProjection(root).text;
  if (text !== productionText) {
    throw new Error(`Anchor projection drifted from production: ${JSON.stringify({ text, productionText })}`);
  }
  return { projectionVersion: PROJECTION_VERSION, offsetUnit: 'utf16', text, pairs };
}

function allIndexes(text, exact) {
  const indexes = [];
  if (!exact) return indexes;
  let index = text.indexOf(exact);
  while (index !== -1) {
    indexes.push(index);
    index = text.indexOf(exact, index + 1);
  }
  return indexes;
}

function projectedPrefixLength(root, container, offset) {
  const range = root.ownerDocument.createRange();
  range.selectNodeContents(root);
  range.setEnd(container, offset);
  return buildVisibleTextProjection(range.cloneContents()).text.length;
}

function projectedSelection(range) {
  return buildVisibleTextProjection(range.cloneContents()).text;
}

function nearestIndex(indexes, expected) {
  return [...indexes].sort((left, right) => (
    Math.abs(left - expected) - Math.abs(right - expected) || left - right
  ))[0];
}

export function createAnchor(root, range, contextLength = DEFAULT_CONTEXT) {
  if (!root.contains(range.startContainer) || !root.contains(range.endContainer) || range.collapsed) {
    throw new TypeError('Selection must be a non-collapsed Range inside the annotation root');
  }
  const map = buildCanonicalDomMap(root);
  const exact = projectedSelection(range);
  if (!exact) throw new TypeError('Selection has no visible canonical text');
  const expectedStart = projectedPrefixLength(root, range.startContainer, range.startOffset);
  const hits = allIndexes(map.text, exact);
  if (!hits.length) throw new Error('Selected canonical text does not exist in the root projection');
  const start = nearestIndex(hits, expectedStart);
  const end = start + exact.length;
  return {
    projectionVersion: PROJECTION_VERSION,
    textQuote: {
      type: 'TextQuoteSelector',
      exact,
      prefix: map.text.slice(Math.max(0, start - contextLength), start),
      suffix: map.text.slice(end, end + contextLength),
    },
    textPosition: {
      type: 'TextPositionSelector',
      start,
      end,
    },
  };
}

function contextMatches(text, index, selector) {
  const end = index + selector.textQuote.exact.length;
  const prefix = selector.textQuote.prefix || '';
  const suffix = selector.textQuote.suffix || '';
  return (!prefix || text.slice(Math.max(0, index - prefix.length), index) === prefix)
    && (!suffix || text.slice(end, end + suffix.length) === suffix);
}

function nearestMappedPair(pairs, start, step) {
  for (let index = start; index >= 0 && index < pairs.length; index += step) {
    if (pairs[index]?.start && pairs[index]?.end) return pairs[index];
  }
  return null;
}

function rangeFromOffsets(root, map, start, end) {
  if (!Number.isInteger(start) || !Number.isInteger(end) || start < 0 || end <= start || end > map.pairs.length) {
    return null;
  }
  const first = nearestMappedPair(map.pairs, start, 1);
  const last = nearestMappedPair(map.pairs, end - 1, -1);
  if (!first?.start || !last?.end) return null;
  const range = root.ownerDocument.createRange();
  range.setStart(first.start.container, first.start.offset);
  range.setEnd(last.end.container, last.end.offset);
  return range;
}

export function resolveAnchor(root, selector) {
  if (selector?.projectionVersion !== PROJECTION_VERSION || !selector?.textQuote) {
    return { status: 'projection-version-mismatch', range: null };
  }
  const map = buildCanonicalDomMap(root);
  const exact = String(selector.textQuote.exact || '');
  const hits = allIndexes(map.text, exact);
  const contextual = hits.filter((index) => contextMatches(map.text, index, selector));

  let start = null;
  let status = 'orphaned';
  if (contextual.length === 1) {
    start = contextual[0];
    status = hits.length === 1 ? 'quote-unique' : 'quote-context';
  } else if (hits.length === 1) {
    start = hits[0];
    status = 'quote-unique';
  } else {
    const position = selector.textPosition;
    if (
      hits.includes(position?.start) &&
      map.text.slice(position.start, position.end) === exact
    ) {
      start = position.start;
      status = 'position-confirmed';
    }
  }

  if (start === null) return { status, range: null, projection: map.text };
  const end = start + exact.length;
  const range = rangeFromOffsets(root, map, start, end);
  if (!range || projectedSelection(range) !== exact) {
    return { status: 'orphaned', range: null, projection: map.text };
  }
  return { status, range, start, end, projection: map.text };
}

export function canonicalRangeText(range) {
  return projectedSelection(range);
}
