import type { WorkflowTask, WorkflowTaskState } from './workflow-types';
import { filterWorkflowTasks } from './workflow-state';

const filters: Array<{ id: 'all' | WorkflowTaskState; label: string }> = [
  { id: 'all', label: '全部' },
  { id: 'needs_attention', label: '需注意' },
  { id: 'pending', label: '待确认' },
  { id: 'confirmed', label: '已确认' },
];

export function TaskRail({ tasks, activeId, filter, onFilter, onSelect }: {
  tasks: WorkflowTask[];
  activeId: string | null;
  filter: 'all' | WorkflowTaskState;
  onFilter: (filter: 'all' | WorkflowTaskState) => void;
  onSelect: (id: string) => void;
}) {
  const visible = filterWorkflowTasks(tasks, filter);
  return (
    <aside className="workflow-task-rail">
      <div className="workflow-task-filters" role="group" aria-label="任务筛选">
        {filters.map((item) => <button key={item.id} type="button" aria-pressed={filter === item.id} onClick={() => onFilter(item.id)}>{item.label}<span>{item.id === 'all' ? tasks.length : tasks.filter((task) => task.state === item.id).length}</span></button>)}
      </div>
      <ol>
        {visible.map((task) => (
          <li key={task.id}>
            <button type="button" className={activeId === task.id ? 'active' : ''} aria-current={activeId === task.id ? 'true' : undefined} onClick={() => onSelect(task.id)}>
              <span>{String(task.ordinal).padStart(2, '0')}</span>
              <strong>{task.title}</strong>
              {task.summary && <small>{task.summary}</small>}
              <i className={`is-${task.state}`}>{task.state === 'needs_attention' ? '需注意' : task.state === 'pending' ? '待确认' : '已确认'}</i>
            </button>
          </li>
        ))}
      </ol>
    </aside>
  );
}
