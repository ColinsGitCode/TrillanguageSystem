import type { WorkflowTask, WorkflowTaskState } from './workflow-types';
import { ContextTools } from './ContextTools';
import { TaskRail } from './TaskRail';

export function TaskWorkbench({ tasks, activeId, filter, onFilter, onSelect, children, tools }: {
  tasks: WorkflowTask[];
  activeId: string | null;
  filter: 'all' | WorkflowTaskState;
  onFilter: (filter: 'all' | WorkflowTaskState) => void;
  onSelect: (id: string) => void;
  children: React.ReactNode;
  tools?: React.ReactNode;
}) {
  return (
    <div className="workflow-task-workbench">
      <TaskRail tasks={tasks} activeId={activeId} filter={filter} onFilter={onFilter} onSelect={onSelect} />
      <main className="workflow-task-detail">{children}</main>
      {tools || <ContextTools />}
    </div>
  );
}
