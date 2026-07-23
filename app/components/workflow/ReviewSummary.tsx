import { ArrowLeft, ShieldCheck } from 'lucide-react';
import type { WorkflowReviewItem } from './workflow-types';

export function ReviewSummary({ title, description, items, warnings = [], actionLabel, actionDisabled = false, onAction, onChange }: {
  title: string;
  description?: string;
  items: WorkflowReviewItem[];
  warnings?: string[];
  actionLabel: string;
  actionDisabled?: boolean;
  onAction: () => void;
  onChange?: (target: string) => void;
}) {
  return (
    <section className="workflow-review-summary">
      <header><ShieldCheck aria-hidden="true" /><div><p className="eyebrow">REVIEW</p><h2>{title}</h2>{description && <p>{description}</p>}</div></header>
      <dl>{items.map((item) => <div className={`is-${item.tone || 'default'}`} key={item.id}><dt>{item.label}</dt><dd>{item.value}</dd>{item.changeTarget && onChange && <button type="button" onClick={() => onChange(item.changeTarget!)}><ArrowLeft aria-hidden="true" />修改</button>}</div>)}</dl>
      {warnings.length > 0 && <ul className="workflow-review-warnings">{warnings.map((warning) => <li key={warning}>{warning}</li>)}</ul>}
      <footer><button type="button" className="primary" disabled={actionDisabled} onClick={onAction}>{actionLabel}</button></footer>
    </section>
  );
}
