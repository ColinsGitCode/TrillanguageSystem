import { AlertTriangle, CircleHelp } from 'lucide-react';
import type { ReactNode } from 'react';
import { DialogSurface } from './DialogSurface';

export function ConfirmDialog({
  title,
  description,
  confirmLabel,
  pendingLabel = '处理中…',
  cancelLabel = '取消',
  onConfirm,
  onCancel,
  busy = false,
  tone = 'default',
  ariaLabel,
}: {
  title: string;
  description: ReactNode;
  confirmLabel: string;
  pendingLabel?: string;
  cancelLabel?: string;
  onConfirm: () => void;
  onCancel: () => void;
  busy?: boolean;
  tone?: 'default' | 'warning' | 'danger';
  ariaLabel?: string;
}) {
  const Icon = tone === 'default' ? CircleHelp : AlertTriangle;
  return (
    <DialogSurface
      onClose={onCancel}
      ariaLabel={ariaLabel || title}
      role="alertdialog"
      size="small"
      busy={busy}
    >
      <div className={`confirm-dialog tone-${tone}`}>
        <header>
          <span className="confirm-dialog-icon"><Icon aria-hidden="true" /></span>
          <div>
            <h2>{title}</h2>
            <div className="confirm-dialog-description">{description}</div>
          </div>
        </header>
        <footer>
          <button
            type="button"
            data-dialog-initial-focus
            disabled={busy}
            onClick={onCancel}
          >
            {cancelLabel}
          </button>
          <button
            type="button"
            className={`confirm-dialog-action tone-${tone}`}
            disabled={busy}
            onClick={onConfirm}
          >
            {busy ? pendingLabel : confirmLabel}
          </button>
        </footer>
      </div>
    </DialogSurface>
  );
}
