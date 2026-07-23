import type {
  WorkflowOperation,
  WorkflowStage,
  WorkflowStageItem,
  WorkflowTask,
  WorkflowTaskState,
} from './workflow-types';

export const WORKFLOW_STAGES: ReadonlyArray<{ id: WorkflowStage; label: string }> = [
  { id: 'intake', label: '接收草稿' },
  { id: 'review', label: '人工确认' },
  { id: 'release', label: '发布检查' },
  { id: 'processing', label: '后台处理' },
  { id: 'complete', label: '完成' },
];

export function normalizeWorkflowStage(value: string | null | undefined, fallback: WorkflowStage): WorkflowStage {
  return WORKFLOW_STAGES.some((stage) => stage.id === value) ? value as WorkflowStage : fallback;
}

export function stageItems(current: WorkflowStage, availableThrough: WorkflowStage, failed = false): WorkflowStageItem[] {
  const currentIndex = WORKFLOW_STAGES.findIndex((stage) => stage.id === current);
  const availableIndex = WORKFLOW_STAGES.findIndex((stage) => stage.id === availableThrough);
  return WORKFLOW_STAGES.map((stage, index) => ({
    ...stage,
    state: index < currentIndex
      ? 'complete'
      : index === currentIndex
        ? failed ? 'failed' : 'current'
        : index <= availableIndex
          ? 'available'
          : 'locked',
  }));
}

export function filterWorkflowTasks(tasks: WorkflowTask[], filter: 'all' | WorkflowTaskState) {
  const filtered = filter === 'all' ? tasks : tasks.filter((task) => task.state === filter);
  return [...filtered].sort((left, right) => {
    const priority = { needs_attention: 0, pending: 1, confirmed: 2 };
    return priority[left.state] - priority[right.state] || left.ordinal - right.ordinal;
  });
}

export function nextWorkflowTask(tasks: WorkflowTask[], currentId: string | null) {
  if (!tasks.length) return null;
  const currentIndex = tasks.findIndex((task) => task.id === currentId);
  return tasks[Math.min(Math.max(currentIndex + 1, 0), tasks.length - 1)]?.id || null;
}

export function isActiveOperation(operation: WorkflowOperation | null | undefined) {
  return Boolean(operation && ['queued', 'running', 'partially_failed', 'failed'].includes(operation.status));
}
