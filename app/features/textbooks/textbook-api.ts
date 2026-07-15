import { requestJson } from '../../lib/api/client';
import type { TextbookCourse, TextbookImportSummary, TextbookTrack } from './types';

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
};
