import { buildCanonicalDomMap, createAnchor, resolveAnchor } from './annotation-anchor.mjs';

// Work in the annotation projection so ruby readings and audio controls never
// become part of a selected word, clause or sentence.
export function resizeSelectionRange(container, original, scope) {
  if (original.collapsed || !container.contains(original.startContainer) || !container.contains(original.endContainer)) return null;
  const node = original.startContainer;
  const element = node.nodeType === 1 ? node : node.parentElement;
  const block = element?.closest('li, p, h1, h2, h3, h4, blockquote, td, th, dt, dd') || container;
  if (!container.contains(block) || !block.contains(original.endContainer)) return null;
  const anchor = createAnchor(block, original);
  const { text } = buildCanonicalDomMap(block);
  const offset = anchor.textPosition.start;
  let start;
  let end;
  if (scope === 'word' || scope === 'sentence') {
    const segmenter = new Intl.Segmenter('ja', { granularity: scope });
    const match = Array.from(segmenter.segment(text)).find((item) => (
      item.index <= offset && item.index + item.segment.length > offset
    ));
    if (!match || (scope === 'word' && !match.isWordLike)) return null;
    start = match.index;
    end = start + match.segment.length;
  } else if (scope === 'phrase') {
    const separators = /[、，,。！？!?;；\n]/u;
    start = offset;
    end = Math.max(offset, anchor.textPosition.end);
    while (start > 0 && !separators.test(text[start - 1])) start -= 1;
    while (end < text.length && !separators.test(text[end])) end += 1;
  } else return null;
  while (start < end && /\s/u.test(text[start])) start += 1;
  while (end > start && /\s/u.test(text[end - 1])) end -= 1;
  if (end <= start || Array.from(text.slice(start, end)).length > 200) return null;
  return resolveAnchor(block, {
    ...anchor,
    textQuote: { type: 'TextQuoteSelector', exact: text.slice(start, end), prefix: text.slice(Math.max(0, start - 32), start), suffix: text.slice(end, end + 32) },
    textPosition: { type: 'TextPositionSelector', start, end },
  }).range;
}
