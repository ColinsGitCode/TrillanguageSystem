import { AlertCircle, CheckCircle2, Info, TriangleAlert, X } from 'lucide-react';
import type { ShellFeedbackCommand } from './shell-events';

function FeedbackIcon({ tone }: { tone: ShellFeedbackCommand['tone'] }) {
  if (tone === 'success') return <CheckCircle2 aria-hidden="true" />;
  if (tone === 'warning') return <TriangleAlert aria-hidden="true" />;
  if (tone === 'error') return <AlertCircle aria-hidden="true" />;
  return <Info aria-hidden="true" />;
}

export function GlobalFeedback({ items, onDismiss }: {
  items: Array<ShellFeedbackCommand & { id: string }>;
  onDismiss: (id: string) => void;
}) {
  if (!items.length) return null;
  return (
    <div className="shell-feedback-stack" aria-live="polite" data-testid="shell-feedback">
      {items.map((item) => (
        <section className={`shell-feedback is-${item.tone}`} key={item.id}>
          <FeedbackIcon tone={item.tone} />
          <p>{item.message}</p>
          {item.actionHref && <a href={item.actionHref}>{item.actionLabel || '查看'}</a>}
          <button type="button" className="icon-button" aria-label="关闭提示" onClick={() => onDismiss(item.id)}><X aria-hidden="true" /></button>
        </section>
      ))}
    </div>
  );
}
