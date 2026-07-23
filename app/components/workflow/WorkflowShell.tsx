import { ChevronRight, X } from 'lucide-react';
import { useEffect, useRef } from 'react';
import type { WorkflowSaveState, WorkflowStage, WorkflowStageItem } from './workflow-types';
import { SaveStatus } from './SaveStatus';
import { StageNavigation } from './StageNavigation';

export function WorkflowShell({
  eyebrow,
  title,
  objectLabel,
  breadcrumbs = [],
  saveState = 'clean',
  stages,
  onStageChange,
  onExit,
  children,
}: {
  eyebrow?: string;
  title: string;
  objectLabel?: string;
  breadcrumbs?: string[];
  saveState?: WorkflowSaveState;
  stages: WorkflowStageItem[];
  onStageChange?: (stage: WorkflowStage) => void;
  onExit?: () => void;
  children: React.ReactNode;
}) {
  const titleRef = useRef<HTMLHeadingElement>(null);
  const currentStage = stages.find((stage) => stage.state === 'current')?.id;
  useEffect(() => {
    titleRef.current?.focus({ preventScroll: true });
  }, [currentStage]);
  return (
    <section className="workflow-shell" data-testid="workflow-shell">
      <header className="workflow-header">
        <div>
          {breadcrumbs.length > 0 && <p className="workflow-breadcrumbs">{breadcrumbs.map((item, index) => <span key={`${item}-${index}`}>{index > 0 && <ChevronRight aria-hidden="true" />}{item}</span>)}</p>}
          {eyebrow && <p className="eyebrow">{eyebrow}</p>}
          <h1 ref={titleRef} tabIndex={-1}>{title}</h1>
          {objectLabel && <p>{objectLabel}</p>}
        </div>
        <div className="workflow-header-actions">
          <SaveStatus state={saveState} />
          {onExit && <button className="icon-button" type="button" aria-label="退出流程" title="退出流程" onClick={onExit}><X aria-hidden="true" /></button>}
        </div>
      </header>
      <StageNavigation items={stages} onNavigate={onStageChange} />
      {children}
    </section>
  );
}
