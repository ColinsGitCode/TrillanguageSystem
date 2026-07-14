import type { CardType } from '../factory/types';

export type LearningScope = {
  version: 1;
  languages: Array<'en' | 'ja'>;
  cardTypes: Array<CardType | 'whole_card'>;
  dateRange: { from: string; to: string } | null;
  tags: Array<{ namespace: string; value: string }>;
};
export type ScopePreview = {
  generationCount: number;
  studyItemCount: number;
  byKind: Record<string, number>;
};

export type LearningPlan = {
  id: number;
  status: 'active' | 'paused';
  scope: LearningScope;
  dailyActionGoal: number;
  dailyNewLimit: number;
  revision: number;
  createdAtUtc: string;
  updatedAtUtc: string;
};

export type LearningProfile = {
  persisted: boolean;
  timeZone: string;
  revision: number;
};

export type PlanResponse = {
  success: true;
  plan: LearningPlan | null;
  profile: LearningProfile;
  scopePreview: ScopePreview;
  admissionSummary: Record<string, number>;
  defaults: {
    dailyActionGoal: number;
    dailyNewLimit: number;
    scope: LearningScope;
  };
};

export type ScopeOptionsResponse = {
  success: true;
  dateRange: { min: string | null; max: string | null };
  tags: Array<{ namespace: string; value: string; generationCount: number }>;
};

export type QueueEntry = {
  id: number;
  studyItemId: number;
  reason: string;
  bucket: number;
  explanation: { code?: string; label?: string; recentlyFailed?: boolean };
  availableAtUtc: string | null;
  dueAtUtc: string | null;
  status: 'pending' | 'active' | 'deferred' | 'completed' | 'skipped';
  attempts: number;
  itemSummary: {
    unitKind: string;
    unitKey: string;
    title: string;
    cardType: CardType;
  } | null;
};

export type QueueProgress = {
  total: number;
  byStatus: Record<string, number>;
  actionCount: number;
  actionGoal: number;
  goalReached: boolean;
};

export type DailyQueue = {
  id: number;
  learningDay: string;
  timeZone: string;
  status: 'ready' | 'active' | 'completed' | 'superseded';
  snapshot: {
    summary?: { due?: number; new?: number; newAvailable?: number; deferredToday?: number };
    dailyActionGoal?: number;
    dailyNewLimit?: number;
  };
  progress: QueueProgress;
  entries: QueueEntry[];
};

export type LearningSession = {
  id: number;
  queueId: number;
  status: 'active' | 'ended' | 'completed';
  currentEntry: QueueEntry | null;
  revealedEntryId: number | null;
  revealedAtUtc: string | null;
  nextAvailableAtUtc: string | null;
  startedAtUtc: string;
  endedAtUtc: string | null;
  queueProgress: QueueProgress;
  reviewSummary: {
    total: number;
    byRating: Record<'1' | '2' | '3' | '4', number>;
  };
};

export type StudyItem = {
  id: number;
  unitKind: string;
  unitKey: string;
  locator: Record<string, unknown>;
  source: {
    generationId: number;
    cardType: CardType;
    title: string;
    folder: string;
    baseFilename: string;
    generationDate: string;
    contentHash: string;
  };
  prompt: { language: 'zh'; text: string; targetLanguages: string[] };
  answer: { targetText: string | { en: string; ja: string } | null; markdown: string };
  expectedScheduleVersion: number;
  audioFiles: Array<{
    id: number;
    language: string;
    text: string;
    filename_suffix: string;
    file_path: string;
    status: string;
  }>;
  highlightReference: { id: number; sourceHash: string; version: number } | null;
};

export type ReviewResponse = {
  success: true;
  idempotent: boolean;
  publicExplanation: {
    rating: string;
    nextDueAtUtc: string;
    scheduledDays: number;
    shortTerm: boolean;
  };
  queueProgress: QueueProgress;
  session: LearningSession;
};

export type LearningHistoryRange = '7' | '30' | '90' | 'all';

export type LearningUnitKind =
  | 'trilingual_en'
  | 'trilingual_ja'
  | 'grammar_ja'
  | 'scenario_bilingual'
  | 'whole_card';

export type LearningHistoryResponse = {
  success: true;
  range: {
    preset: LearningHistoryRange;
    startDay: string;
    endDay: string;
    timeZone: string;
    availableStartDay: string | null;
    availableEndDay: string | null;
    unitKind: LearningUnitKind | null;
  };
  overview: {
    totalReviews: number;
    activeDays: number;
    queueDays: number;
    startedDays: number;
    learningStartRate: number | null;
    totalSessions: number;
    sessionsWithProgress: number;
    validSessions: number;
    sessionCompletionRate: number | null;
    goalReachedDays: number;
    goalCompletionRate: number | null;
    dueAssigned: number;
    dueCompleted: number;
    dueCompletionRate: number;
    newAssigned: number;
    newReviewed: number;
    newConversionRate: number;
    currentOverdue: number;
    averageResponseMs: number;
    medianResponseMs: number;
    repeatedFailureCount: number;
    repeatedFailureRate: number;
    recentActiveDays7: number;
    recentActiveDays30: number;
    baselineEstablished: boolean;
    baselineRemainingDays: number;
  };
  daily: Array<{
    learningDay: string;
    actions: number;
    actionGoal: number;
    goalReached: boolean;
    dueAssigned: number;
    dueCompleted: number;
    backlog: number;
    newAssigned: number;
    newReviewed: number;
    averageResponseMs: number;
    sessionCount: number;
  }>;
  ratings: Array<{ rating: number; count: number; percentage: number }>;
  breakdown: Array<{
    unitKind: LearningUnitKind;
    cardType: string;
    reviews: number;
    averageRating: number;
    failureRate: number;
    averageResponseMs: number;
  }>;
  recent: Array<{
    id: number;
    eventKey: string;
    learningDay: string;
    occurredAtUtc: string;
    rating: number;
    responseMs: number;
    unitKind: LearningUnitKind;
    unitKey: string;
    cardType: string;
    title: string;
    contentAvailable: boolean;
  }>;
  dataQuality: {
    historicalSkipMetricsAvailable: boolean;
    notes: string[];
  };
};
