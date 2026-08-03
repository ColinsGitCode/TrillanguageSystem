import {
  AlertTriangle,
  CircleOff,
  Inbox,
  LoaderCircle,
} from 'lucide-react';
import type { ReactNode } from 'react';

const STATE_ICON = {
  loading: LoaderCircle,
  error: AlertTriangle,
  empty: Inbox,
  unavailable: CircleOff,
} as const;

export type PageStateVariant = keyof typeof STATE_ICON;

export function PageState({
  variant,
  title,
  description,
  eyebrow,
  actions,
  compact = false,
  testId,
}: {
  variant: PageStateVariant;
  title: ReactNode;
  description: ReactNode;
  eyebrow?: ReactNode;
  actions?: ReactNode;
  compact?: boolean;
  testId?: string;
}) {
  const Icon = STATE_ICON[variant];
  return (
    <section
      className={`surface page-state is-${variant}${compact ? ' is-compact' : ''}`}
      data-testid={testId}
      role={variant === 'error' ? 'alert' : 'status'}
      aria-live={variant === 'loading' ? 'polite' : undefined}
      aria-busy={variant === 'loading' || undefined}
    >
      <div className="page-state-icon">
        <Icon aria-hidden="true" />
      </div>
      <div className="page-state-copy">
        {eyebrow && <p className="eyebrow">{eyebrow}</p>}
        <h1>{title}</h1>
        <p>{description}</p>
        {variant === 'loading' && (
          <div className="page-state-skeleton" aria-hidden="true">
            <i />
            <i />
          </div>
        )}
      </div>
      {actions && <div className="page-state-actions">{actions}</div>}
    </section>
  );
}
