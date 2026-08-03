import type { CardType } from '../factory/types';

export type LearningScope = {
  version: 1 | 2;
  languages: Array<'en' | 'ja'>;
  cardTypes: Array<CardType | 'whole_card' | 'textbook_track'>;
  dateRange: { from: string; to: string } | null;
  tags: Array<{ namespace: string; value: string }>;
  textbookTrackIds?: number[];
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
  textbookTracks: Array<{
    id: number;
    trackNumber: number;
    title: string;
    status: 'published';
    courseKey: string;
    courseTitle: string;
    studyItemCount: number;
  }>;
};

export type QueueEntry = {
  id: number;
  studyItemId: number;
  reason: string;
  bucket: number;
  providerScore: number | null;
  explanation: {
    code?: string;
    label?: string;
    recentlyFailed?: boolean;
    provider?: {
      contractVersion?: number;
      id: string;
      version: string;
      score: number | null;
      sources?: Array<{
        providerId: string;
        providerVersion: string;
        providerKind: string;
        score: number;
        groups: string[];
        reasons: Array<{ code: string; label: string }>;
        evidence: Array<{ source: string; ruleVersion: string | null; ruleKey: string | null }>;
      }>;
    };
  };
  availableAtUtc: string | null;
  dueAtUtc: string | null;
  status: 'pending' | 'active' | 'deferred' | 'completed' | 'skipped';
  attempts: number;
  itemSummary: {
    unitKind: string;
    unitKey: string;
    title: string;
    cardType: CardType | 'textbook_track';
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
    planning?: {
      contractVersion: number;
      providers: Array<{ id: string; version: string; kind: string; maxDurationMs: number }>;
      diagnostics: Record<string, {
        id: string;
        version: string;
        kind: string;
        applied: number;
        empty: number;
        failed: number;
        timedOut: number;
      }>;
    };
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
    cardType: CardType | 'textbook_track';
    title: string;
    folder: string;
    baseFilename: string;
    generationDate: string;
    contentHash: string;
  };
  prompt: { language: 'zh'; text: string; targetLanguages: string[] };
  answer: { targetText: string | { en: string; ja: string } | null; markdown: string };
  scheduleState: {
    fsrsState: string;
    dueAtUtc: string;
    lastReviewedAtUtc: string | null;
    reps: number;
    lapses: number;
    version: number;
  } | null;
  expectedScheduleVersion: number;
  audioFiles: Array<{
    id: number;
    language: string;
    text: string;
    filename_suffix: string;
    file_path?: string;
    status: string;
    playback_url?: string;
  }>;
  annotationReference?: {
    targetKind: 'generation' | 'textbook_track' | 'textbook_expression';
    targetId: number;
    targetRevision: string;
    count: number;
    source: 'card_annotations';
  } | null;
};

export type ManualQueueIntent = {
  id: number;
  intentKey: string;
  planId: number;
  learningDay: string;
  timeZone: string;
  queueId: number;
  queueEntryId: number;
  studyItemId: number;
  policyVersion: string;
  status: 'active' | 'completed' | 'expired' | 'cancelled';
  completionReviewEventId: number | null;
  createdAtUtc: string;
  updatedAtUtc: string;
  completedAtUtc: string | null;
  expiredAtUtc: string | null;
  cancelledAtUtc: string | null;
  entry?: QueueEntry;
};

export type ManualIntentCapacity = {
  policyVersion: string;
  limit: number;
  used: number;
  remaining: number;
};

export type ManualIntentResponse = {
  success: true;
  idempotent: boolean;
  reused: boolean;
  alreadyQueued: boolean;
  intent: ManualQueueIntent | null;
  entry: QueueEntry;
  capacity: ManualIntentCapacity;
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
  | 'textbook_en'
  | 'textbook_ja'
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
    manualAssigned: number;
    manualReviewed: number;
    manualCompletionRate: number;
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
    manualAssigned: number;
    manualReviewed: number;
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
  engagement: {
    generationRequests: number;
    duplicateHits: number;
    existingCardOpens: number;
    addedToToday: number;
    newVersionRequests: number;
    librarySearches: number;
    activeDays: number;
    recent: Array<{
      id: number;
      eventKind: string;
      learningDay: string;
      createdAtUtc: string;
      generationId: number | null;
      phrase: string;
      cardType: string;
      folder: string | null;
      baseFilename: string | null;
    }>;
  };
  dataQuality: {
    historicalSkipMetricsAvailable: boolean;
    notes: string[];
  };
};
