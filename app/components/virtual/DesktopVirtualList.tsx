import { useVirtualizer } from '@tanstack/react-virtual';
import { useCallback, useEffect, useState, type Key, type ReactNode } from 'react';
import '../../styles/virtual-list.css';

export function DesktopVirtualList<T>({
  items,
  getItemKey,
  estimateSize,
  renderItem,
  activeKey,
  ariaLabel,
  className = '',
  overscan = 6,
  testId,
}: {
  items: readonly T[];
  getItemKey: (item: T, index: number) => Key;
  estimateSize: number;
  renderItem: (item: T, index: number) => ReactNode;
  activeKey?: Key | null;
  ariaLabel: string;
  className?: string;
  overscan?: number;
  testId?: string;
}) {
  const [scrollElement, setScrollElement] = useState<HTMLDivElement | null>(null);
  const itemKey = useCallback(
    (index: number) => getItemKey(items[index]!, index),
    [getItemKey, items]
  );
  const virtualizer = useVirtualizer({
    count: items.length,
    getScrollElement: () => scrollElement,
    estimateSize: () => estimateSize,
    getItemKey: itemKey,
    overscan,
  });

  useEffect(() => {
    if (activeKey === null || activeKey === undefined || !scrollElement) return;
    const index = items.findIndex((item, itemIndex) => Object.is(getItemKey(item, itemIndex), activeKey));
    if (index >= 0) virtualizer.scrollToIndex(index, { align: 'auto' });
  }, [activeKey, getItemKey, items, scrollElement, virtualizer]);

  const virtualItems = virtualizer.getVirtualItems();
  return (
    <div
      ref={setScrollElement}
      className={`desktop-virtual-list ${className}`.trim()}
      role="region"
      aria-label={ariaLabel}
      data-testid={testId}
      data-total-count={items.length}
      data-rendered-count={virtualItems.length}
    >
      <ol className="desktop-virtual-list-items" style={{ height: `${virtualizer.getTotalSize()}px` }}>
        {virtualItems.map((virtualItem) => (
          <li
            ref={virtualizer.measureElement}
            className="desktop-virtual-list-row"
            data-index={virtualItem.index}
            key={virtualItem.key}
            style={{ transform: `translateY(${virtualItem.start}px)` }}
          >
            {renderItem(items[virtualItem.index]!, virtualItem.index)}
          </li>
        ))}
      </ol>
    </div>
  );
}
