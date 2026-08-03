import type { ReactNode } from 'react';

export function PageHeader({
  eyebrow,
  title,
  description,
  actions,
  className = '',
  compact = false,
  testId,
}: {
  eyebrow?: ReactNode;
  title: ReactNode;
  description?: ReactNode;
  actions?: ReactNode;
  className?: string;
  compact?: boolean;
  testId?: string;
}) {
  return (
    <header
      className={`product-page-header${compact ? ' is-compact' : ''}${className ? ` ${className}` : ''}`}
      data-testid={testId}
    >
      <div className="product-page-header-copy">
        {eyebrow && <p className="eyebrow">{eyebrow}</p>}
        <h1>{title}</h1>
        {description && <p className="product-page-header-description">{description}</p>}
      </div>
      {actions && <div className="product-page-header-actions">{actions}</div>}
    </header>
  );
}
