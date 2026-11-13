import { nativeOverlaysEnabled } from '../../lib/platform/capabilities';
import { lazy, Suspense, useEffect, useRef, useState } from 'react';
import { DialogSurface } from '../../components/overlays';
import { PageState } from '../../components/states';
import { markUiInteractionStart } from '../../lib/performance';
import type { CardSelection } from '../factory/types';

const NativeCardOverlayBoundary = lazy(() => import('../../components/overlays/CardOverlayBoundary').then(m => ({default:m.CardOverlayBoundary})));

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
  const [native] = useState(nativeOverlaysEnabled);
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

  const loading = (<PageState
            variant="loading"
            eyebrow="学习卡"
            title="正在打开学习卡"
            description="正在载入内容、注解和发音工具。"
            compact
            testId="card-modal-module-loading"
          />);
  const content = (
    <Suspense
      fallback={native ? (
        <div className="dialog-backdrop" data-testid="card-modal-loading-backdrop">
          <section className="dialog-surface dialog-size-large">
            <button type="button" className="dialog-close" autoFocus onClick={onClose}>关闭学习卡</button>
            {loading}
          </section>
        </div>
      ) : (
        <DialogSurface
          size="large"
          ariaLabel="正在打开学习卡"
          closeLabel="关闭学习卡"
          onClose={onClose}
          restoreFocus={false}
          backdropTestId="card-modal-loading-backdrop"
        >
          {loading}
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
  return native ? <Suspense fallback={<button type="button" onClick={onClose}>取消打开学习卡</button>}><NativeCardOverlayBoundary onClose={onClose}>{content}</NativeCardOverlayBoundary></Suspense> : content;
}
