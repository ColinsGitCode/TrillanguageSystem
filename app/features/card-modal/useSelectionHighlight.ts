import { useEffect, type RefObject } from 'react';
import { supportsHighlights } from '../../lib/platform/capabilities';

const NAME = 'three-lans-active-selection';

export function useSelectionHighlight(rangeRef: RefObject<Range | null>, activeKey: object | null) {
  useEffect(() => {
    if (!activeKey || !supportsHighlights()) return;
    const range = rangeRef.current;
    if (!range || !range.commonAncestorContainer.isConnected || range.collapsed) return;
    const ownedRange = range.cloneRange();
    const quote = ownedRange.toString();
    const highlight = new Highlight(ownedRange);
    CSS.highlights.set(NAME, highlight);
    const clearOwned = () => {
      if (CSS.highlights.get(NAME) === highlight) CSS.highlights.delete(NAME);
    };
    const root = range.commonAncestorContainer.parentElement?.closest('[data-testid="react-card-content"]');
    const observer = new MutationObserver(() => {
      if (!ownedRange.commonAncestorContainer.isConnected || ownedRange.collapsed || ownedRange.toString() !== quote) clearOwned();
    });
    if (root) observer.observe(root, { subtree: true, childList: true, characterData: true });
    return () => { observer.disconnect(); clearOwned(); };
  }, [activeKey, rangeRef]);
}
