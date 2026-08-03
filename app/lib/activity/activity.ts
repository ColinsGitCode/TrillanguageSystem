import { requestJson } from '../api/client';
import type { ShellActivityCommand } from '../../components/shell/shell-events';

export type ActivitySource = {
  id: 'generation' | 'textbooks' | 'learning' | 'knowledge';
  status: 'available' | 'degraded';
};

export type ActivityFeed = {
  success: true;
  items: ShellActivityCommand[];
  summary: {
    active: number;
    needsAttention: number;
    total: number;
  };
  sources: ActivitySource[];
  generatedAtUtc: string;
};

export const activityApi = {
  get: () => requestJson<ActivityFeed>('/api/activity?limit=30'),
};
