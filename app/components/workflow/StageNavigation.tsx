import { Check, CircleAlert, LockKeyhole } from 'lucide-react';
import type { WorkflowStageItem } from './workflow-types';

export function StageNavigation<TStage extends string>({ items, onNavigate }: {
  items: WorkflowStageItem<TStage>[];
  onNavigate?: (stage: TStage) => void;
}) {
  return (
    <nav className="workflow-stage-nav" aria-label="流程阶段">
      {items.map((item, index) => {
        const disabled = item.state === 'locked';
        return (
          <button
            key={item.id}
            type="button"
            className={`is-${item.state}`}
            aria-current={item.state === 'current' ? 'step' : undefined}
            disabled={disabled}
            title={item.reason}
            onClick={() => onNavigate?.(item.id)}
          >
            <span>{item.state === 'complete' ? <Check aria-hidden="true" /> : item.state === 'failed' ? <CircleAlert aria-hidden="true" /> : item.state === 'locked' ? <LockKeyhole aria-hidden="true" /> : index + 1}</span>
            {item.label}
          </button>
        );
      })}
    </nav>
  );
}
