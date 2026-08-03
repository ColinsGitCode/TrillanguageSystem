import { lazy, Suspense, useEffect, useRef } from 'react';
import { DialogSurface } from '../../components/overlays';
import { PageState } from '../../components/states';
import { markUiInteractionStart } from '../../lib/performance';
import type { CardSelection } from '../factory/types';

let cardModalModuleLoaded = false;
const LoadedCardModal = lazy(async () => {
  const module = await import('./CardModal');
  cardModalModuleLoaded = true;
  return { default: module.CardModal };
});

export function DeferredCardModal({
  selection,
  readOnly = false,
  onClose,
}: {
  selection: CardSelection;
  readOnly?: boolean;
  onClose: () => void;
}) {
  const performanceKey = `${selection.folder}/${selection.baseName}`;
  const measuredKeyRef = useRef('');
  if (measuredKeyRef.current !== performanceKey) {
    measuredKeyRef.current = performanceKey;
    markUiInteractionStart('card-modal-open', cardModalModuleLoaded ? 'warm' : 'cold');
  }
  const openerRef = useRef<HTMLElement | null>(
    typeof document !== 'undefined' && document.activeElement instanceof HTMLElement
      ? document.activeElement
      : null
  );

  useEffect(() => () => {
    const opener = openerRef.current;
    if (!opener?.isConnected) return;
    window.requestAnimationFrame(() => opener.focus({ preventScroll: true }));
  }, []);

  return (
    <Suspense
      fallback={(
        <DialogSurface
          size="large"
          ariaLabel="正在打开学习卡"
          closeLabel="关闭学习卡"
          onClose={onClose}
          restoreFocus={false}
          backdropTestId="card-modal-loading-backdrop"
        >
          <PageState
            variant="loading"
            eyebrow="学习卡"
            title="正在打开学习卡"
            description="正在载入内容、注解和发音工具。"
            compact
            testId="card-modal-module-loading"
          />
        </DialogSurface>
      )}
    >
      <LoadedCardModal
        selection={selection}
        readOnly={readOnly}
        onClose={onClose}
        restoreFocusTo={openerRef.current}
      />
    </Suspense>
  );
}
