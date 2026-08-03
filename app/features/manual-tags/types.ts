export type ManualTagCategory = 'priority' | 'status' | 'skill' | 'topic' | 'custom';
export type ManualTagColor = 'gray' | 'blue' | 'cyan' | 'green' | 'yellow' | 'orange' | 'red' | 'purple';
export type ManualTagTargetKind = 'generation' | 'textbook_track' | 'textbook_expression' | 'knowledge_point';

export type ManualTag = {
  id: number;
  name: string;
  category: ManualTagCategory;
  color: ManualTagColor;
  status: 'active' | 'archived';
  isSeed: boolean;
  version: number;
  usageCount: number;
  createdAtUtc: string;
  updatedAtUtc: string;
};

export type ManualTagTarget = {
  targetKind: ManualTagTargetKind;
  targetId: number;
  title: string;
  subtitle: string;
  createdAtUtc: string;
};
