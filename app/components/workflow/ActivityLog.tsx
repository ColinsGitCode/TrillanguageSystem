import type { WorkflowActivity } from './workflow-types';

export function ActivityLog({ items }: { items: WorkflowActivity[] }) {
  return (
    <ol className="workflow-activity-log">
      {items.map((item) => <li className={`is-${item.type}`} key={item.id}><span aria-hidden="true" /><div><strong>{item.title}</strong><p>{item.summary}</p>{item.occurredAt && <time>{item.occurredAt}</time>}</div></li>)}
    </ol>
  );
}
