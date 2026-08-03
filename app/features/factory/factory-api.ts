import { requestJson, requestText } from '../../lib/api/client';
import type {
  CardSelection,
  CardType,
  FolderFile,
  GenerationJob,
  GenerationJobEvent,
  GenerationRecord,
  HealthResponse,
  QueueSummary,
  SourceMode,
  DuplicateCardSummary,
  CardEngagementStats,
} from './types';
import type {
  CardAnnotationSelector,
  RenderableCardAnnotation,
} from '../card-modal/annotation-render.mjs';
import type { PronunciationToken } from '../card-modal/pronunciation-overlay';

export type CardAnnotation = RenderableCardAnnotation & {
  targetKind: 'generation' | 'textbook_track' | 'textbook_expression';
  targetId: number;
  targetRevision: string;
  noteText: string | null;
  sourceContentHash: string | null;
  version: number;
  createdAtUtc: string;
  updatedAtUtc: string;
};

export type AnnotationColor = 'red' | 'yellow' | 'green' | 'blue';

export type AnnotationTarget = {
  targetKind: CardAnnotation['targetKind'];
  targetId: number;
  targetRevision: string;
  sourceContentHash: string | null;
};

export type PronunciationDocument = {
  id: number;
  targetKind: 'generation' | 'textbook_track' | 'textbook_expression';
  targetId: number;
  sourceContentHash: string;
  projectionVersion: string;
  status: 'partial' | 'ready' | 'stale' | 'archived';
  analyzerVersion: string;
  dictionaryVersion: string;
  documentHash: string;
  revision: number;
};

export const factoryApi = {
  health: () => requestJson<HealthResponse>('/api/health'),
  folders: () => requestJson<{ folders: string[] }>('/api/folders'),
  files: (folder: string) => requestJson<{ files: FolderFile[] }>(
    `/api/folders/${encodeURIComponent(folder)}/files`
  ),
  history: (search = '', page = 1) => {
    const params = new URLSearchParams({ page: String(page), limit: '20' });
    if (search.trim()) params.set('search', search.trim());
    return requestJson<{
      records: GenerationRecord[];
      pagination: { page: number; total: number; totalPages: number; hasNext: boolean; hasPrev: boolean };
    }>(`/api/history?${params}`);
  },
  card: async (selection: CardSelection) => {
    const file = `${selection.baseName}.md`;
    const recordUrl = `/api/records/by-file?folder=${encodeURIComponent(selection.folder)}&base=${encodeURIComponent(selection.baseName)}`;
    const [markdown, recordResult] = await Promise.all([
      requestText(`/api/folders/${encodeURIComponent(selection.folder)}/files/${encodeURIComponent(file)}`),
      requestJson<{ record: GenerationRecord }>(recordUrl).catch(() => null),
    ]);
    return { markdown, record: recordResult?.record || null };
  },
  preflight: (payload: { phrase: string; cardType: CardType; interactionKey: string }) =>
    requestJson<{
      success: true;
      interactionKey: string;
      duplicates: DuplicateCardSummary[];
      activeJob: GenerationJob | null;
    }>('/api/generation-jobs/preflight', {
      method: 'POST',
      body: JSON.stringify({
        phrase: payload.phrase,
        card_type: payload.cardType,
        interaction_key: payload.interactionKey,
      }),
    }),
  enqueue: (payload: {
    phrase: string;
    cardType: CardType;
    sourceMode: SourceMode;
    targetFolder?: string;
    duplicatePolicy?: 'reject' | 'create-version';
    interactionKey?: string;
    preflightRecorded?: boolean;
  }) =>
    requestJson<{ success: true; job: GenerationJob; summary: QueueSummary }>('/api/generation-jobs', {
      method: 'POST',
      body: JSON.stringify({
        phrase: payload.phrase,
        card_type: payload.cardType,
        source_mode: payload.sourceMode,
        target_folder: payload.targetFolder || '',
        duplicate_policy: payload.duplicatePolicy || 'reject',
        interaction_key: payload.interactionKey || '',
        preflight_recorded: payload.preflightRecorded === true,
      }),
    }),
  recordEngagement: (payload: {
    eventKey: string;
    generationId?: number;
    phrase: string;
    cardType: CardType;
    eventKind: 'existing_card_opened' | 'library_search_submitted';
    sourceSurface: 'cards_factory' | 'card_modal';
    metadata?: Record<string, unknown>;
  }) => requestJson('/api/card-engagement/events', {
    method: 'POST',
    body: JSON.stringify(payload),
  }),
  cardStats: (generationId: number) => requestJson<{ success: true; stats: CardEngagementStats }>(
    `/api/card-engagement/generations/${generationId}/stats`
  ),
  todayCards: () => requestJson<{
    success: true;
    learningDay: string;
    timeZone: string;
    cards: Array<{
      id: number;
      phrase: string;
      cardType: CardType;
      folder: string;
      baseFilename: string;
      generationDate: string;
      addedAtUtc: string;
    }>;
  }>('/api/card-engagement/today'),
  addToToday: (generationId: number, requestKey: string) => requestJson<{
    success: true;
    engagement: { id: number; learningDay: string };
    learning: {
      generationId: number;
      total: number;
      eligible: number;
      queued: number;
      planControlled: number;
    };
  }>(`/api/learning/generations/${generationId}/add-to-today`, {
    method: 'POST',
    body: JSON.stringify({ requestKey }),
  }),
  jobs: () => requestJson<{ jobs: GenerationJob[] }>('/api/generation-jobs?limit=30'),
  queueSummary: () => requestJson<{ summary: QueueSummary }>('/api/generation-jobs/summary'),
  events: (jobId: number) => requestJson<{ events: GenerationJobEvent[] }>(
    `/api/generation-jobs/events?jobId=${jobId}&limit=80`
  ),
  retry: (id: number) => requestJson(`/api/generation-jobs/${id}/retry`, { method: 'POST' }),
  cancel: (id: number) => requestJson(`/api/generation-jobs/${id}/cancel`, { method: 'POST' }),
  clearDone: () => requestJson('/api/generation-jobs/clear-done', { method: 'POST' }),
  ocr: (image: string) => requestJson<{ text: string; provider: string }>('/api/ocr', {
    method: 'POST',
    body: JSON.stringify({ image }),
  }),
  annotations: (targetKind: CardAnnotation['targetKind'], targetId: number) =>
    requestJson<{ success: true; target: AnnotationTarget; annotations: CardAnnotation[] }>(
      `/api/annotations?targetKind=${encodeURIComponent(targetKind)}&targetId=${encodeURIComponent(String(targetId))}`
    ),
  pronunciation: (targetKind: 'generation' | 'textbook_track' | 'textbook_expression', targetId: number) =>
    requestJson<{
      success: true;
      target: { targetKind: string; targetId: number };
      plainText: string;
      document: PronunciationDocument;
      tokens: PronunciationToken[];
    }>(`/api/pronunciation?targetKind=${encodeURIComponent(targetKind)}&targetId=${encodeURIComponent(String(targetId))}`),
  correctPronunciation: (payload: {
    targetId: number;
    tokenKey: string;
    eventKey: string;
    eventType: 'reading' | 'boundary' | 'resolve' | 'reject' | 'split' | 'merge';
    expectedRevision: number;
    readingRaw?: string;
    readingHiragana?: string;
    status?: PronunciationToken['status'];
  }) => requestJson<{
    success: true;
    event: { id: number; eventKey: string };
    document: PronunciationDocument;
    tokens: PronunciationToken[];
    idempotent: boolean;
  }>('/api/pronunciation/corrections', {
    method: 'POST',
    body: JSON.stringify(payload),
  }),
  createAnnotation: (payload: {
    id: string;
    targetKind: CardAnnotation['targetKind'];
    targetId: number;
    expectedTargetRevision: string;
    selector: CardAnnotationSelector;
    annotationKind: 'highlight';
    color: AnnotationColor;
  }) => requestJson<{
    success: true;
    annotation: CardAnnotation;
  }>('/api/annotations', {
    method: 'POST',
    body: JSON.stringify(payload),
  }),
  updateAnnotation: (id: string, payload: {
    expectedVersion: number;
    color: AnnotationColor;
  }) => requestJson<{
    success: true;
    annotation: CardAnnotation;
  }>(`/api/annotations/${encodeURIComponent(id)}`, {
    method: 'PATCH',
    body: JSON.stringify(payload),
  }),
  deleteAnnotation: (id: string, expectedVersion: number) => requestJson<{
    success: true;
    annotation: { id: string; status: 'deleted'; version: number };
  }>(`/api/annotations/${encodeURIComponent(id)}`, {
    method: 'DELETE',
    body: JSON.stringify({ expectedVersion }),
  }),
  deleteRecord: (record: GenerationRecord | null, selection: CardSelection) => {
    if (record?.id) return requestJson(`/api/records/${record.id}`, { method: 'DELETE' });
    return requestJson(
      `/api/records/by-file?folder=${encodeURIComponent(selection.folder)}&base=${encodeURIComponent(selection.baseName)}`,
      { method: 'DELETE' }
    );
  },
};
