import { AlertTriangle } from 'lucide-react';
import { useEffect, useRef } from 'react';
import type { WorkflowError } from './workflow-types';

export function ErrorSummary({ errors, onRetry, retryLabel = '重试', onReload, onDismiss, dismissLabel = '关闭' }: {
  errors: WorkflowError[];
  onRetry?: () => void;
  retryLabel?: string;
  onReload?: () => void;
  onDismiss?: () => void;
  dismissLabel?: string;
}) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (errors.length) ref.current?.focus({ preventScroll: true });
  }, [errors]);
  if (!errors.length) return null;
  return (
    <div ref={ref} className="workflow-error-summary" role="alert" tabIndex={-1}>
      <AlertTriangle aria-hidden="true" />
      <div><h2>请处理以下问题</h2><ul>{errors.map((error) => <li key={`${error.code}-${error.fieldId || ''}`}><button type="button" onClick={() => error.fieldId && document.getElementById(error.fieldId)?.focus()}>{error.message}</button><code>{error.code}</code></li>)}</ul></div>
      {onRetry && <button type="button" onClick={onRetry}>{retryLabel}</button>}
      {onDismiss && <button type="button" onClick={onDismiss}>{dismissLabel}</button>}
      {onReload && <button type="button" onClick={onReload}>重新载入</button>}
    </div>
  );
}
