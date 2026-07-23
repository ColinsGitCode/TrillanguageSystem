import { CheckCircle2, CircleAlert, Clock3, LoaderCircle, RotateCcw } from 'lucide-react';
import type { WorkflowOperation } from './workflow-types';

function StatusIcon({ status }: { status: WorkflowOperation['status'] }) {
  if (status === 'succeeded') return <CheckCircle2 aria-hidden="true" />;
  if (status === 'running') return <LoaderCircle aria-hidden="true" />;
  if (status === 'queued') return <Clock3 aria-hidden="true" />;
  return <CircleAlert aria-hidden="true" />;
}

export function AsyncOperationPanel({ operation, onRetry }: {
  operation: WorkflowOperation;
  onRetry?: (stepIds: string[]) => void;
}) {
  const retryable = operation.steps.filter((step) => step.retryable && ['failed', 'partially_failed'].includes(step.status)).map((step) => step.id);
  return (
    <section className={`workflow-operation is-${operation.status}`} aria-live="polite">
      <header><StatusIcon status={operation.status} /><div><p className="eyebrow">{operation.kind} · #{operation.id}</p><h2>{operation.publicSummary || operation.status}</h2></div></header>
      <ol>{operation.steps.map((step) => <li className={`is-${step.status}`} key={step.id}><StatusIcon status={step.status} /><span>{step.label}</span>{step.errorCode && <code>{step.errorCode}</code>}</li>)}</ol>
      {retryable.length > 0 && onRetry && <button type="button" onClick={() => onRetry(retryable)}><RotateCcw aria-hidden="true" />仅重试失败步骤</button>}
    </section>
  );
}
