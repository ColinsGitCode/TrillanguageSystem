import { requestJson } from '../../lib/api/client';
import type {
  DailyQueue,
  LearningPlan,
  LearningHistoryRange,
  LearningHistoryResponse,
  LearningScope,
  LearningSession,
  LearningUnitKind,
  PlanResponse,
  ReviewResponse,
  ScopeOptionsResponse,
  ScopePreview,
  StudyItem,
} from './types';

export const learningApi = {
  plan: () => requestJson<PlanResponse>('/api/learning/plan'),
  previewPlan: (scope: LearningScope) => requestJson<{
    success: true;
    scope: LearningScope;
    scopePreview: ScopePreview;
    admissionSummary: Record<string, number>;
  }>('/api/learning/plan/preview', {
    method: 'POST',
    body: JSON.stringify({ scope }),
  }),
  scopeOptions: () => requestJson<ScopeOptionsResponse>('/api/learning/scope-options'),
  history: (range: LearningHistoryRange, unitKind: LearningUnitKind | null) => {
    const params = new URLSearchParams({ range });
    if (unitKind) params.set('unitKind', unitKind);
    return requestJson<LearningHistoryResponse>(`/api/learning/history?${params.toString()}`);
  },
  savePlan: (payload: {
    expectedRevision: number;
    scope: LearningScope;
    dailyActionGoal: number;
    dailyNewLimit: number;
    timeZone: string;
  }) => requestJson<PlanResponse>('/api/learning/plan', {
    method: 'PUT',
    body: JSON.stringify(payload),
  }),
  pausePlan: () => requestJson<PlanResponse>('/api/learning/plan/pause', { method: 'POST' }),
  resumePlan: () => requestJson<PlanResponse>('/api/learning/plan/resume', { method: 'POST' }),
  todayQueue: () => requestJson<{ success: true; queue: DailyQueue | null; emptyReason?: string }>('/api/learning/queues/today'),
  ensureTodayQueue: () => requestJson<{ success: true; queue: DailyQueue }>('/api/learning/queues/today', { method: 'POST' }),
  activeSession: () => requestJson<{ success: true; session: LearningSession | null }>('/api/learning/sessions/active'),
  startSession: (queueId?: number) => requestJson<{
    success: true;
    session: LearningSession | null;
    resumed: boolean;
    empty: boolean;
  }>('/api/learning/sessions', {
    method: 'POST',
    body: JSON.stringify(queueId ? { queueId } : {}),
  }),
  item: (id: number) => requestJson<{ success: true; item: StudyItem }>(`/api/learning/items/${id}`),
  reveal: (sessionId: number, queueEntryId: number) => requestJson<{ success: true; session: LearningSession }>(
    `/api/learning/sessions/${sessionId}/reveal`,
    { method: 'POST', body: JSON.stringify({ queueEntryId }) }
  ),
  review: (sessionId: number, payload: {
    eventKey: string;
    queueEntryId: number;
    studyItemId: number;
    rating: number;
    expectedScheduleVersion: number;
    responseMs: number;
  }) => requestJson<ReviewResponse>(`/api/learning/sessions/${sessionId}/reviews`, {
    method: 'POST',
    body: JSON.stringify(payload),
  }),
  skip: (sessionId: number, queueEntryId: number) => requestJson<{ success: true; session: LearningSession }>(
    `/api/learning/sessions/${sessionId}/skip`,
    { method: 'POST', body: JSON.stringify({ queueEntryId }) }
  ),
  endSession: (sessionId: number) => requestJson<{ success: true; session: LearningSession }>(
    `/api/learning/sessions/${sessionId}/end`,
    { method: 'POST' }
  ),
};

export type { DailyQueue, LearningPlan, LearningScope, LearningSession, StudyItem };
