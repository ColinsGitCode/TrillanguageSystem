export type WorkflowStage = 'intake' | 'review' | 'release' | 'processing' | 'complete';
export type WorkflowStageState = 'complete' | 'current' | 'available' | 'locked' | 'failed';
export type WorkflowSaveState = 'clean' | 'dirty' | 'saving' | 'saved' | 'failed' | 'conflict';
export type WorkflowTaskState = 'pending' | 'needs_attention' | 'confirmed';
export type WorkflowOperationStatus = 'queued' | 'running' | 'succeeded' | 'partially_failed' | 'failed' | 'cancelled';

export type WorkflowStageItem = {
  id: WorkflowStage;
  label: string;
  state: WorkflowStageState;
  reason?: string;
};

export type WorkflowTask = {
  id: string;
  ordinal: number;
  title: string;
  summary?: string;
  state: WorkflowTaskState;
  reasons?: string[];
  metadata?: Record<string, string | number | boolean | null>;
};

export type WorkflowCommand = {
  id: string;
  label: string;
  enabled: boolean;
  disabledReason?: string;
};

export type WorkflowError = {
  code: string;
  message: string;
  fieldId?: string;
  retryable?: boolean;
};

export type WorkflowReviewItem = {
  id: string;
  label: string;
  value: string | number;
  tone?: 'default' | 'warning' | 'danger' | 'success';
  changeTarget?: string;
};

export type WorkflowOperationStep = {
  id: string;
  label: string;
  status: WorkflowOperationStatus;
  errorCode?: string | null;
  retryable?: boolean;
};

export type WorkflowOperation = {
  id: string;
  kind: string;
  status: WorkflowOperationStatus;
  steps: WorkflowOperationStep[];
  updatedAt?: string | null;
  publicSummary?: string | null;
};

export type WorkflowActivity = {
  id: string;
  type: 'info' | 'success' | 'warning' | 'error';
  title: string;
  summary: string;
  occurredAt?: string | null;
};
