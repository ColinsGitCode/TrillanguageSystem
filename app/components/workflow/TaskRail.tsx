import { Search, X } from 'lucide-react';
import { useCallback } from 'react';
import { DesktopVirtualList } from '../virtual';
import type { WorkflowTask, WorkflowTaskState } from './workflow-types';
import { filterWorkflowTasks } from './workflow-state';

export type TaskRailFilterOption = { id: 'all' | WorkflowTaskState; label: string };

const defaultFilters: ReadonlyArray<TaskRailFilterOption> = [
  { id: 'all', label: '全部' },
  { id: 'needs_attention', label: '需注意' },
  { id: 'pending', label: '待确认' },
  { id: 'confirmed', label: '已确认' },
];

const defaultStateLabels: Record<WorkflowTaskState, string> = {
  needs_attention: '需注意',
  pending: '待确认',
  confirmed: '已确认',
};

export function TaskRail({
  tasks,
  activeId,
  filter,
  onFilter,
  onSelect,
  query = '',
  onQuery,
  searchPlaceholder = '搜索任务',
  selectedIds,
  onToggleSelection,
  isSelectable = () => true,
  toolbar,
  filterOptions = defaultFilters,
  stateLabels,
}: {
  tasks: WorkflowTask[];
  activeId: string | null;
  filter: 'all' | WorkflowTaskState;
  onFilter: (filter: 'all' | WorkflowTaskState) => void;
  onSelect: (id: string) => void;
  query?: string;
  onQuery?: (query: string) => void;
  searchPlaceholder?: string;
  selectedIds?: ReadonlySet<string>;
  onToggleSelection?: (id: string) => void;
  isSelectable?: (task: WorkflowTask) => boolean;
  toolbar?: React.ReactNode;
  filterOptions?: ReadonlyArray<TaskRailFilterOption>;
  stateLabels?: Partial<Record<WorkflowTaskState, string>>;
}) {
  const visible = filterWorkflowTasks(tasks, filter, query);
  const labels = { ...defaultStateLabels, ...stateLabels };
  const getTaskKey = useCallback((task: WorkflowTask) => task.id, []);
  const moveSelection = (taskId: string, direction: -1 | 1) => {
    const currentIndex = visible.findIndex((task) => task.id === taskId);
    const next = visible[Math.min(Math.max(currentIndex + direction, 0), visible.length - 1)];
    if (next && next.id !== taskId) onSelect(next.id);
  };
  return (
    <aside className="workflow-task-rail">
      <div className="workflow-task-filters" role="group" aria-label="任务筛选">
        {filterOptions.map((item) => <button key={item.id} type="button" aria-pressed={filter === item.id} onClick={() => onFilter(item.id)}>{item.label}<span>{item.id === 'all' ? tasks.length : tasks.filter((task) => task.state === item.id).length}</span></button>)}
      </div>
      {onQuery && (
        <label className="workflow-task-search">
          <Search aria-hidden="true" />
          <input
            type="search"
            value={query}
            placeholder={searchPlaceholder}
            aria-label={searchPlaceholder}
            onChange={(event) => onQuery(event.target.value)}
          />
          {query && <button type="button" aria-label="清除任务搜索" onClick={() => onQuery('')}><X aria-hidden="true" /></button>}
        </label>
      )}
      {toolbar}
      <DesktopVirtualList
        items={visible}
        getItemKey={getTaskKey}
        estimateSize={72}
        activeKey={activeId}
        ariaLabel="任务列表"
        className="workflow-task-list"
        testId="workflow-task-virtual-list"
        renderItem={(task) => (
          <div className={onToggleSelection ? 'workflow-task-row is-selectable' : 'workflow-task-row'}>
            {onToggleSelection && (
              <input
                type="checkbox"
                checked={selectedIds?.has(task.id) || false}
                disabled={!isSelectable(task)}
                aria-label={`选择任务 ${String(task.ordinal).padStart(2, '0')} ${task.title}`}
                onChange={() => onToggleSelection(task.id)}
              />
            )}
            <button
              type="button"
              data-task-id={task.id}
              className={activeId === task.id ? 'active' : ''}
              aria-current={activeId === task.id ? 'true' : undefined}
              onClick={() => onSelect(task.id)}
              onKeyDown={(event) => {
                if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
                  event.preventDefault();
                  moveSelection(task.id, event.key === 'ArrowDown' ? 1 : -1);
                } else if (event.key === 'Home' && visible[0]) {
                  event.preventDefault();
                  onSelect(visible[0].id);
                } else if (event.key === 'End' && visible.at(-1)) {
                  event.preventDefault();
                  onSelect(visible.at(-1)!.id);
                }
              }}
            >
              <span>{String(task.ordinal).padStart(2, '0')}</span>
              <strong>{task.title}</strong>
              {task.summary && <small>{task.summary}</small>}
              <i className={`is-${task.state}`}>{labels[task.state]}</i>
            </button>
          </div>
        )}
      />
      {!visible.length && (
        <div className="workflow-task-empty">
          <strong>没有匹配任务</strong>
          <span>调整状态筛选或搜索内容。</span>
        </div>
      )}
    </aside>
  );
}
