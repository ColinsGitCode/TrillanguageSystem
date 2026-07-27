import { resolveAnchor } from './annotation-anchor.mjs';

const COLOR_CLASS = {
  red: 'study-highlight-red',
  yellow: 'study-highlight-yellow',
  green: 'study-highlight-green',
  blue: 'study-highlight-blue',
};

function markerClass(annotation) {
  const colorClass = COLOR_CLASS[annotation?.color] || COLOR_CLASS.red;
  return `${colorClass} card-annotation-highlight`;
}

function createMarker(document, annotation) {
  const marker = document.createElement('mark');
  marker.className = markerClass(annotation);
  marker.dataset.annotationId = String(annotation.id || '');
  return marker;
}

function canWrapTextNode(node) {
  const parent = node.parentElement;
  return Boolean(
    node.nodeValue?.trim()
    && parent
    && !parent.closest('rt, rp, button, audio, source, script, style')
  );
}

export function applyAnnotationRange(root, range, annotation) {
  if (!range || range.collapsed || !root.contains(range.commonAncestorContainer)) return false;
  const document = root.ownerDocument;

  try {
    const marker = createMarker(document, annotation);
    range.surroundContents(marker);
    return true;
  } catch {
    // Selections crossing ruby or block boundaries need one marker per text fragment.
  }

  const nodeFilter = document.defaultView?.NodeFilter;
  if (!nodeFilter) return false;
  const nodes = [];
  const walker = document.createTreeWalker(root, nodeFilter.SHOW_TEXT);
  let current = walker.nextNode();
  while (current) {
    if (canWrapTextNode(current) && range.intersectsNode(current)) nodes.push(current);
    current = walker.nextNode();
  }

  let applied = false;
  for (const original of nodes) {
    if (!original.parentNode) continue;
    const length = original.nodeValue?.length || 0;
    const start = original === range.startContainer ? range.startOffset : 0;
    const end = original === range.endContainer ? range.endOffset : length;
    if (start >= end) continue;
    let selected = original;
    if (start > 0) selected = selected.splitText(start);
    const selectedLength = end - start;
    if (selectedLength < selected.length) selected.splitText(selectedLength);
    if (!selected.parentNode) continue;
    const marker = createMarker(document, annotation);
    selected.parentNode.insertBefore(marker, selected);
    marker.appendChild(selected);
    applied = true;
  }
  return applied;
}

export function applyAnnotations(root, annotations = []) {
  const diagnostics = [];
  const ordered = [...annotations].sort((left, right) => (
    Number(right?.selector?.textPosition?.start || 0)
      - Number(left?.selector?.textPosition?.start || 0)
  ));

  for (const annotation of ordered) {
    if (annotation?.status !== 'active' || annotation?.annotationKind !== 'highlight') continue;
    const resolved = resolveAnchor(root, annotation.selector);
    const applied = Boolean(resolved.range)
      && applyAnnotationRange(root, resolved.range, annotation);
    diagnostics.push({
      id: annotation.id,
      status: applied ? 'rendered' : 'orphaned',
      resolution: resolved.status,
    });
  }
  return diagnostics;
}
