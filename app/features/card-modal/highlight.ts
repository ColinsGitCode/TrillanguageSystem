export function applyMarkerHighlight(container: HTMLElement, range: Range) {
  if (range.collapsed || !container.contains(range.commonAncestorContainer)) return false;

  try {
    const marker = document.createElement('mark');
    marker.className = 'study-highlight-red';
    range.surroundContents(marker);
    return true;
  } catch {
    // A selection spanning partially-selected elements cannot be surrounded as
    // one node. Fall back to wrapping each intersecting text fragment.
  }

  const nodes: Text[] = [];
  const walker = document.createTreeWalker(container, NodeFilter.SHOW_TEXT);
  let current = walker.nextNode();
  while (current) {
    const textNode = current as Text;
    const parent = textNode.parentElement;
    if (
      textNode.nodeValue?.trim() &&
      parent &&
      !parent.closest('rt, rp, button, audio, source, script, style, mark.study-highlight-red') &&
      range.intersectsNode(textNode)
    ) {
      nodes.push(textNode);
    }
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
    if (!selected.parentNode || selected.parentElement?.closest('mark.study-highlight-red')) continue;
    const marker = document.createElement('mark');
    marker.className = 'study-highlight-red';
    selected.parentNode.insertBefore(marker, selected);
    marker.appendChild(selected);
    applied = true;
  }
  return applied;
}

export function applyTextHighlight(container: HTMLElement, selectedText: string) {
  const needle = selectedText.trim();
  if (!needle) return false;
  const walker = document.createTreeWalker(container, NodeFilter.SHOW_TEXT);
  let current = walker.nextNode();
  while (current) {
    const text = current as Text;
    const parent = text.parentElement;
    const index = text.nodeValue?.indexOf(needle) ?? -1;
    if (index >= 0 && parent && !parent.closest('rt, rp, button, mark.study-highlight-red')) {
      const range = document.createRange();
      range.setStart(text, index);
      range.setEnd(text, index + needle.length);
      return applyMarkerHighlight(container, range);
    }
    current = walker.nextNode();
  }
  return false;
}
