import { CheckCircle2, CircleAlert, CircleStop, Clock3, LoaderCircle, RotateCcw } from 'lucide-react';
import type { WorkflowOperation } from './workflow-types';

function StatusIcon({ status }: { status: WorkflowOperation['status'] }) {
  if (status === 'succeeded') return <CheckCircle2 aria-hidden="true" />;
  if (status === 'running') return <LoaderCircle aria-hidden="true" />;
  if (status === 'queued') return <Clock3 aria-hidden="true" />;
  return <CircleAlert aria-hidden="true" />;
}

export function AsyncOperationPanel({ operation, onRetry, onCancel, busy = false }: {
  operation: WorkflowOperation;
  onRetry?: (stepIds: string[]) => void;
  onCancel?: () => void;
  busy?: boolean;
}) {
  const retryable = operation.steps
    .filter((step) => step.status !== 'succeeded' && (
      step.retryable
      || operation.status === 'cancelled'
    ))
    .map((step) => step.id);
  const retryLabel = operation.status === 'cancelled' ? '继续未完成步骤' : '仅重试失败步骤';
  return (
    <section className={`workflow-operation is-${operation.status}`} aria-live="polite">
      <header><StatusIcon status={operation.status} /><div><p className="eyebrow">{operation.kind} · #{operation.id}</p><h2>{operation.publicSummary || operation.status}</h2></div></header>
      <ol>{operation.steps.map((step) => <li className={`is-${step.status}`} key={step.id}><StatusIcon status={step.status} /><span>{step.label}</span>{step.errorCode && <code>{step.errorCode}</code>}</li>)}</ol>
      {operation.retainedSummary && <p className="workflow-operation-retention">{operation.retainedSummary}</p>}
      <div className="workflow-operation-actions">
        {operation.canCancel && onCancel && (
          <button type="button" disabled={busy} onClick={onCancel}>
            <CircleStop aria-hidden="true" />{operation.status === 'running' ? '停止后续处理' : '取消任务'}
          </button>
        )}
        {operation.canRetry && retryable.length > 0 && onRetry && (
          <button type="button" disabled={busy} onClick={() => onRetry(retryable)}>
            <RotateCcw aria-hidden="true" />{retryLabel}
          </button>
        )}
      </div>
    </section>
  );
}
