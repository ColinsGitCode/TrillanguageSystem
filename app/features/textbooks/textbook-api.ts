import { requestJson } from '../../lib/api/client';
import type {
  TextbookCourse,
  TextbookDerivationPreview,
  TextbookImportSummary,
  TextbookPublishPreview,
  TextbookPublishResult,
  TextbookTrack,
} from './types';

export const textbookApi = {
  courses: () => requestJson<{ success: true; courses: TextbookCourse[] }>('/api/textbooks/courses'),
  course: (id: number) => requestJson<{ success: true; course: TextbookCourse }>(`/api/textbooks/courses/${id}`),
  track: (id: number) => requestJson<{ success: true; track: TextbookTrack }>(`/api/textbooks/tracks/${id}`),
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
