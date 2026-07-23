import type {
  WorkflowOperation,
  WorkflowOperationStep,
  WorkflowStage,
  WorkflowStageItem,
  WorkflowTask,
} from '../../components/workflow';
import type { TextbookOperation, TextbookWorkflow } from './types';

const stageOrder: WorkflowStage[] = ['intake', 'review', 'release', 'processing', 'complete'];
const stageLabels: Record<WorkflowStage, string> = {
  intake: '接收',
  review: '校对',
  release: '发布确认',
  processing: '后台处理',
  complete: '完成',
};

export function workflowStages(workflow: TextbookWorkflow): WorkflowStageItem[] {
  const currentIndex = stageOrder.indexOf(workflow.stage);
  return stageOrder.map((id, index) => {
    if (index < currentIndex) return { id, label: stageLabels[id], state: 'complete' };
    if (index === currentIndex) {
      const failed = id === 'processing' && ['failed', 'partially_failed'].includes(workflow.operation?.status || '');
      return { id, label: stageLabels[id], state: failed ? 'failed' : 'current' };
    }
    if (id === 'release' && workflow.release.available) return { id, label: stageLabels[id], state: 'available' };
    if (id === 'processing' && workflow.operation) return { id, label: stageLabels[id], state: 'available' };
    if (id === 'complete' && (workflow.track.status === 'published' || workflow.operation?.status === 'succeeded')) {
      return { id, label: stageLabels[id], state: 'available' };
    }
    return { id, label: stageLabels[id], state: 'locked', reason: '完成前一阶段后可用' };
  });
}

export function workflowTasks(workflow: TextbookWorkflow): WorkflowTask[] {
  return workflow.review.tasks.map((task) => ({
    id: task.id,
    ordinal: task.ordinal,
    title: task.title,
    summary: task.summary,
    state: task.state,
    reasons: task.reasons,
    metadata: {
      expressionId: task.expressionId,
      expressionRevisionId: task.expressionRevisionId,
    },
  }));
}

function stepsFor(operation: TextbookOperation): WorkflowOperationStep[] {
  const names = operation.kind === 'release'
    ? ['publish', 'materialize', 'tts', 'sync']
    : [operation.kind];
  return names.map((id) => {
    const step = operation.result?.steps?.[id];
    return {
      id,
      label: {
        publish: '发布教材',
        materialize: '建立学习单元',
        tts: '生成单句语音',
        sync: '同步知识信号',
      }[id] || id,
      status: step?.status || (operation.status === 'queued' ? 'queued' : 'queued'),
      errorCode: step?.errorCode,
      retryable: step?.retryable,
    };
  });
}

export function workflowOperation(operation: TextbookOperation | null): WorkflowOperation | null {
  if (!operation) return null;
  return {
    id: String(operation.id),
    kind: operation.kind,
    status: operation.status,
    steps: stepsFor(operation),
    updatedAt: operation.updated_at_utc,
    publicSummary: operation.public_summary,
  };
}
