import { useEffect, useRef, useState } from 'react';
import { Ellipsis, Trash2 } from 'lucide-react';

/**
 * "⋯" menu in the card header. Deleting used to be the first control a
 * reader saw, a red button alone in the top-left corner; it lives here now.
 */
export function CardMoreMenu({ onDelete }: { onDelete: () => void }) {
  const [open, setOpen] = useState(false);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return undefined;
    menuRef.current?.querySelector<HTMLButtonElement>('[role="menuitem"]')?.focus();
    const onPointerDown = (event: PointerEvent) => {
      const target = event.target as Node;
      if (!menuRef.current?.contains(target) && !triggerRef.current?.contains(target)) setOpen(false);
    };
    document.addEventListener('pointerdown', onPointerDown);
    return () => document.removeEventListener('pointerdown', onPointerDown);
  }, [open]);

  const close = () => {
    setOpen(false);
    triggerRef.current?.focus();
  };

  return (
    <div className="card-more-menu">
      <button
        ref={triggerRef}
        type="button"
        className="icon-button"
        aria-label="更多操作"
        aria-haspopup="menu"
        aria-expanded={open}
        data-testid="card-more-menu-trigger"
        onClick={() => setOpen((value) => !value)}
      >
        <Ellipsis aria-hidden="true" />
      </button>
      {open && (
        <div
          ref={menuRef}
          className="card-more-menu-list"
          role="menu"
          aria-label="更多操作"
          onKeyDown={(event) => {
            // Handled here so the dialog's own Escape (close the card) does not run.
            if (event.key === 'Escape') {
              event.preventDefault();
              close();
            }
            if (event.key === 'Tab') setOpen(false);
          }}
        >
          <button
            type="button"
            role="menuitem"
            className="is-danger"
            onClick={() => {
              setOpen(false);
              onDelete();
            }}
          >
            <Trash2 aria-hidden="true" />删除这张卡…
          </button>
        </div>
      )}
    </div>
  );
}
