import { useEffect, useRef, type ReactNode } from 'react';
import { X } from 'lucide-react';
import { focusableElements } from './focus-management';

export function DialogSurface({
  children,
  onClose,
  ariaLabel,
  ariaLabelledBy,
  role = 'dialog',
  size = 'medium',
  className = '',
  busy = false,
  closeOnBackdrop = false,
  closeOnEscape = true,
  restoreFocus = true,
  closeLabel,
  backdropTestId = 'dialog-backdrop',
}: {
  children: ReactNode;
  onClose: () => void;
  ariaLabel?: string;
  ariaLabelledBy?: string;
  role?: 'dialog' | 'alertdialog';
  size?: 'small' | 'medium' | 'large';
  className?: string;
  busy?: boolean;
  closeOnBackdrop?: boolean;
  closeOnEscape?: boolean;
  restoreFocus?: boolean;
  closeLabel?: string;
  backdropTestId?: string;
}) {
  const surfaceRef = useRef<HTMLElement>(null);
  const onCloseRef = useRef(onClose);
  const busyRef = useRef(busy);

  useEffect(() => {
    onCloseRef.current = onClose;
    busyRef.current = busy;
  }, [busy, onClose]);

  useEffect(() => {
    const surface = surfaceRef.current;
    if (!surface) return undefined;

    const previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';

    const focusFrame = window.requestAnimationFrame(() => {
      const preferred = surface.querySelector<HTMLElement>('[data-dialog-initial-focus]');
      const fallback = focusableElements(surface)[0];
      (preferred || fallback || surface).focus({ preventScroll: true });
    });

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && closeOnEscape) {
        event.preventDefault();
        if (!busyRef.current) onCloseRef.current();
        return;
      }
      if (event.key !== 'Tab') return;

      const focusable = focusableElements(surface);
      if (!focusable.length) {
        event.preventDefault();
        surface.focus({ preventScroll: true });
        return;
      }

      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      const active = document.activeElement;
      if (event.shiftKey && (active === first || !surface.contains(active))) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && active === last) {
        event.preventDefault();
        first.focus();
      }
    };

    document.addEventListener('keydown', handleKeyDown);
    return () => {
      window.cancelAnimationFrame(focusFrame);
      document.removeEventListener('keydown', handleKeyDown);
      document.body.style.overflow = previousOverflow;
      if (restoreFocus && previousFocus?.isConnected) {
        window.requestAnimationFrame(() => {
          const active = document.activeElement;
          if (!active || active === document.body || !(active instanceof HTMLElement) || !active.isConnected) {
            previousFocus.focus({ preventScroll: true });
          }
        });
      }
    };
  }, [closeOnEscape, restoreFocus]);

  const requestClose = () => {
    if (!busy) onClose();
  };

  return (
    <div
      className="dialog-backdrop"
      data-testid={backdropTestId}
      onMouseDown={(event) => {
        if (closeOnBackdrop && event.target === event.currentTarget) requestClose();
      }}
    >
      <section
        ref={surfaceRef}
        className={`dialog-surface dialog-size-${size} ${className}`.trim()}
        role={role}
        aria-modal="true"
        aria-label={ariaLabel}
        aria-labelledby={ariaLabelledBy}
        aria-busy={busy || undefined}
        tabIndex={-1}
      >
        {closeLabel && (
          <button
            className="icon-button dialog-close"
            type="button"
            aria-label={closeLabel}
            disabled={busy}
            data-dialog-initial-focus
            onClick={requestClose}
          >
            <X aria-hidden="true" />
          </button>
        )}
        {children}
      </section>
    </div>
  );
}
