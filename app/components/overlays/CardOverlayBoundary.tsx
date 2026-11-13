import { useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { OverlayScope } from './OverlayScope';
import './native-card-owner.css';

// One modal owner survives lazy loading. Every portal stays inside that owner.
export function CardOverlayBoundary({ children, onClose }: { children: ReactNode; onClose: () => void }) {
  const [container, setContainer] = useState<HTMLDialogElement | null>(null);
  const closeRef = useRef(onClose);
  const closeGuard = useRef<(() => void) | null>(null);
  closeRef.current = onClose;
  useLayoutEffect(() => {
    if (!container) return;
    const overflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    container.showModal();
    return () => {
      container.close();
      document.body.style.overflow = overflow;
    };
  }, [container]);
  return <dialog ref={setContainer} className="native-card-owner" aria-label="学习卡片" aria-labelledby="react-card-title"
    onCancel={(event) => { event.preventDefault(); (closeGuard.current || closeRef.current)(); }}>
    <OverlayScope.Provider value={{ native: true, container: container || undefined, closeGuard }}>
      {children}
    </OverlayScope.Provider>
  </dialog>;
}
