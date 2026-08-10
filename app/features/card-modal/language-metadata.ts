import { requestJson } from '../../lib/api/client';

// JLM-A1 adjudication. There is deliberately no "create candidate" call here:
// candidates come from the shadow extraction stage, the reader only judges them.
export const languageMetadataApi = {
  decide: (proposalId: number, decision: 'accept' | 'reject') =>
    requestJson<{ success: true }>(
      `/api/language-metadata/proposals/${proposalId}/${decision}`,
      { method: 'POST' }
    ),
  correct: (payload: {
    targetKind: 'generation' | 'textbook_expression';
    targetId: number;
    sourceContentHash: string;
    surface: string;
    startCodePoint: number;
    endCodePoint: number;
    originTerm: string;
    originLanguage?: string;
  }) => requestJson<{ success: true }>('/api/language-metadata/corrections', {
    method: 'POST',
    body: JSON.stringify({ originLanguage: 'en', ...payload }),
  }),
};
