import { ActivityLog, AsyncOperationPanel, type WorkflowActivity, type WorkflowOperation } from '../../../components/workflow';
import type { TextbookOperationEvent } from '../types';

export function TextbookProcessingView({
  operation,
  events,
  onRetry,
}: {
  operation: WorkflowOperation;
  events: TextbookOperationEvent[];
  onRetry: () => void;
}) {
  const activities: WorkflowActivity[] = events.map((event) => ({
    id: String(event.id),
    type: event.status === 'failed' ? 'error' : event.status === 'succeeded' ? 'success' : 'info',
    title: event.step || event.event_type,
    summary: event.public_summary || event.status,
    occurredAt: event.occurred_at_utc,
  }));
  return (
    <div className="textbook-processing-layout">
      <AsyncOperationPanel operation={operation} onRetry={onRetry ? () => onRetry() : undefined} />
      <section className="surface textbook-operation-activity">
        <header><p className="eyebrow">PUBLIC ACTIVITY</p><h2>处理记录</h2></header>
        <ActivityLog items={activities} />
      </section>
    </div>
  );
}
