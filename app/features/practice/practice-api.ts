import { useQuery } from '@tanstack/react-query';
import { requestJson } from '../../lib/api/client';
import { workspaceRuntimeApi } from '../../lib/runtime/workspace';

export type PracticeLanguage = 'ja' | 'en';
export type PracticeRating = 'independent' | 'keep_practicing';
export type PracticePrompt = {
  id: string;
  generationId: number | null;
  language: PracticeLanguage;
  scene: string;
  cue: string;
};
export type PracticeAttempt = PracticePrompt & {
  answer: string;
  answeredAt: string;
  feedback: string | null;
  suggestion: string | null;
  selfAssessment: PracticeRating | null;
  disputed: boolean;
};

const path = '/api/sentence-practice';
const body = (method: string, values: object) => ({ method, body: JSON.stringify(values) });

export const practiceApi = {
  issue: (values: { language: PracticeLanguage; generationId?: number; previousId?: string }) =>
    requestJson<{ prompt: PracticePrompt }>(path + '/prompts', body('POST', values)),
  submit: (id: string, answer: string) =>
    requestJson<{ attempt: PracticeAttempt }>(path + '/' + id + '/answer', body('POST', { answer })),
  assess: (id: string, values: { selfAssessment?: PracticeRating; disputed?: boolean }) =>
    requestJson<{ attempt: PracticeAttempt }>(path + '/' + id, body('PATCH', values)),
  history: () => requestJson<{ attempts: PracticeAttempt[] }>(path + '/history'),
};

export function usePracticeAccess() {
  return useQuery({
    queryKey: ['runtime'], queryFn: workspaceRuntimeApi.get, staleTime: 60_000,
    select: data => data.workspace.mode === 'owner',
  });
}
