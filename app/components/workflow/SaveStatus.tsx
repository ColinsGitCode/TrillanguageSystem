import { AlertCircle, Check, LoaderCircle, Save } from 'lucide-react';
import type { WorkflowSaveState } from './workflow-types';

const labels: Record<WorkflowSaveState, string> = {
  clean: '未修改',
  dirty: '有未保存修改',
  saving: '保存中',
  saved: '已保存',
  failed: '保存失败',
  conflict: '版本冲突',
};

export function SaveStatus({ state }: { state: WorkflowSaveState }) {
  const Icon = state === 'saving' ? LoaderCircle : state === 'saved' ? Check : state === 'failed' || state === 'conflict' ? AlertCircle : Save;
  return <span className={`workflow-save-status is-${state}`} role="status"><Icon aria-hidden="true" />{labels[state]}</span>;
}
