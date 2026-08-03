import { requestJson } from '../../lib/api/client';
import type { CardAnnotationSelector } from '../card-modal/annotation-render.mjs';
import type { AnnotationTarget, CardAnnotation } from '../factory/factory-api';
import type {
  TextbookCourse,
  TextbookDerivationPreview,
  TextbookImportSummary,
  TextbookOperation,
  TextbookOperationEvent,
  TextbookPublishPreview,
  TextbookPublishResult,
  TextbookTrack,
  TextbookWorkflow,
} from './types';

export const textbookApi = {
  courses: () => requestJson<{ success: true; courses: TextbookCourse[] }>('/api/textbooks/courses'),
  course: (id: number) => requestJson<{ success: true; course: TextbookCourse }>(`/api/textbooks/courses/${id}`),
  track: (id: number) => requestJson<{ success: true; track: TextbookTrack }>(`/api/textbooks/tracks/${id}`),
  workflow: (id: number, operationId?: number | null) => requestJson<{ success: true; workflow: TextbookWorkflow }>(
    `/api/textbooks/tracks/${id}/workflow${operationId ? `?operation=${operationId}` : ''}`
  ),
  revision: (id: number) => requestJson<{ success: true; revision: TextbookTrack }>(
    `/api/textbooks/revisions/${id}`
  ),
  updateRevision: (revisionId: number, payload: {
    expectedRevisionId: number;
    expressionId: number;
    changes: Partial<{
      officialEnText: string;
      officialJaText: string;
      zhCueText: string;
      jaRubyHtml: string;
      phraseAnalysisJson: string;
      grammarPointsJson: string;
      editorNote: string | null;
    }>;
  }) => requestJson<{ success: true; result: { trackId: number; revisionId: number; revisionNumber: number }; track: TextbookTrack; workflow: TextbookWorkflow }>(
    `/api/textbooks/revisions/${revisionId}`,
    { method: 'PATCH', body: JSON.stringify(payload) }
  ),
  updateReview: (revisionId: number, expressionId: number, payload: {
    expressionRevisionId: number;
    status: 'pending' | 'needs_attention' | 'confirmed';
    reasonCode?: string | null;
    reviewer?: string;
  }) => requestJson<{ success: true; review: Record<string, unknown>; workflow: TextbookWorkflow }>(
    `/api/textbooks/revisions/${revisionId}/expressions/${expressionId}/review`,
    { method: 'PUT', body: JSON.stringify(payload) }
  ),
  bulkUpdateReview: (revisionId: number, payload: {
    updates: Array<{
      expressionId: number;
      expressionRevisionId: number;
      status: 'pending' | 'needs_attention' | 'confirmed';
      reasonCode?: string | null;
      reviewer?: string;
    }>;
  }) => requestJson<{ success: true; reviews: Array<Record<string, unknown>>; workflow: TextbookWorkflow }>(
    `/api/textbooks/revisions/${revisionId}/reviews`,
    { method: 'PUT', body: JSON.stringify(payload) }
  ),
  createOperation: (trackId: number, payload: {
    kind: 'release' | 'tts' | 'sync';
    idempotencyKey: string;
    previewRevision?: string;
    payload: Record<string, unknown>;
  }) => requestJson<{ success: true; operation: TextbookOperation }>(
    `/api/textbooks/tracks/${trackId}/operations`,
    { method: 'POST', body: JSON.stringify(payload) }
  ),
  operation: (id: number) => requestJson<{ success: true; operation: TextbookOperation }>(
    `/api/textbooks/operations/${id}`
  ),
  operationEvents: (id: number) => requestJson<{ success: true; events: TextbookOperationEvent[] }>(
    `/api/textbooks/operations/${id}/events`
  ),
  retryOperation: (id: number) => requestJson<{ success: true; operation: TextbookOperation }>(
    `/api/textbooks/operations/${id}/retry`,
    { method: 'POST' }
  ),
  cancelOperation: (id: number) => requestJson<{ success: true; operation: TextbookOperation }>(
    `/api/textbooks/operations/${id}/cancel`,
    { method: 'POST' }
  ),
  dryRunImport: (payload: { manifestRelativePath: string; expectedManifestHash: string }) => requestJson<{
    success: true;
    summary: TextbookImportSummary;
    manifestHash: string;
  }>('/api/textbooks/imports/dry-run', { method: 'POST', body: JSON.stringify(payload) }),
  importDraft: (payload: { manifestRelativePath: string; expectedManifestHash: string }) => requestJson<{
    success: true;
    track: TextbookTrack;
    summary: TextbookImportSummary;
    manifestHash: string;
  }>('/api/textbooks/imports', { method: 'POST', body: JSON.stringify(payload) }),
  verifyRevision: (revisionId: number, expectedTrackStatus: string) => requestJson<{ success: true; track: TextbookTrack }>(
    `/api/textbooks/revisions/${revisionId}/verify`,
    { method: 'POST', body: JSON.stringify({ expectedTrackStatus }) }
  ),
  publishPreview: (trackId: number) => requestJson<{ success: true; preview: TextbookPublishPreview }>(
    `/api/textbooks/tracks/${trackId}/publish-preview`
  ),
  publishTrack: (trackId: number, payload: {
    expectedTrackRevision: number | null;
    confirmUnitCount: number;
    expectedPlanRevision: number;
  }) => requestJson<TextbookPublishResult>(`/api/textbooks/tracks/${trackId}/publish`, {
    method: 'POST',
    body: JSON.stringify(payload),
  }),
  generateTts: (trackId: number, force = false) => requestJson<{
    success: true;
    track: TextbookTrack;
    summary: { requested: number; generated: number; failed: number; skipped: number };
  }>(`/api/textbooks/tracks/${trackId}/tts`, {
    method: 'POST',
    body: JSON.stringify({ force }),
  }),
  annotations: (trackId: number) => requestJson<{
    success: true;
    target: AnnotationTarget;
    annotations: CardAnnotation[];
  }>(`/api/annotations?targetKind=textbook_track&targetId=${encodeURIComponent(String(trackId))}`),
  createAnnotation: (payload: {
    id: string;
    targetId: number;
    expectedTargetRevision: string;
    selector: CardAnnotationSelector;
  }) => requestJson<{
    success: true;
    annotation: CardAnnotation;
  }>('/api/annotations', {
    method: 'POST',
    body: JSON.stringify({
      ...payload,
      targetKind: 'textbook_track',
      annotationKind: 'highlight',
      color: 'red',
    }),
  }),
  previewDerivation: (expressionId: number, payload: {
    selectionText: string;
    selectionLanguage?: 'en' | 'ja';
    targetCardType: 'trilingual' | 'grammar_ja';
  }) => requestJson<{ success: true; preview: TextbookDerivationPreview }>(
    `/api/textbooks/expressions/${expressionId}/derivations/preview`,
    { method: 'POST', body: JSON.stringify(payload) }
  ),
  createDerivation: (expressionId: number, payload: {
    selectionText: string;
    selectionLanguage?: 'en' | 'ja';
    targetCardType: 'trilingual' | 'grammar_ja';
  }) => requestJson<{ success: true; derivation: Record<string, unknown>; job: { id: number; status: string }; summary: Record<string, unknown> }>(
    `/api/textbooks/expressions/${expressionId}/derivations`,
    { method: 'POST', body: JSON.stringify(payload) }
  ),
};
