import { requestJson } from '../../lib/api/client';
import type { CardLookupLanguage } from './selection-actions';

export type LocalGlossaryEntry = {
  id: number;
  language: CardLookupLanguage;
  canonicalForm: string;
  normalizedForm: string;
  senseKey: string;
  zhGloss: string;
  sourceKind: 'manual' | 'llm-confirmed' | 'imported';
  sourceRef: Record<string, unknown>;
  confidence: 'high' | 'medium' | 'low';
  status: 'active' | 'archived';
  version: number;
};

export type LocalGlossaryProposal = {
  id: number;
  language: CardLookupLanguage;
  surface: string;
  normalizedForm: string;
  zhGloss: string;
  explanation: string;
  model: string;
  promptVersion: string;
  status: 'pending' | 'accepted' | 'rejected';
  acceptedEntryId: number | null;
};

export type LocalGlossaryLookup = {
  status: 'exact' | 'candidate' | 'missing';
  query: {
    text: string;
    language: CardLookupLanguage;
    canonicalForm: string;
    normalizedForm: string;
  };
  gloss: null | {
    id: number | null;
    zhGloss: string;
    sourceKind: 'current-card' | 'textbook' | 'manual' | 'llm-confirmed' | 'imported' | 'history-card' | 'dictionary';
    sourceId: number | null;
    confidence: 'high' | 'medium' | 'low';
    version: number | null;
    lemma: string | null;
    reading: string | null;
    partOfSpeech: string | null;
    dictionaryVersion: string | null;
  };
  alternatives: Array<unknown>;
};

export const localGlossaryApi = {
  lookup: (payload: { text: string; language: CardLookupLanguage; generationId?: number | null }) => {
    const params = new URLSearchParams({ text: payload.text, language: payload.language });
    if (payload.generationId) params.set('generationId', String(payload.generationId));
    return requestJson<{ success: true; lookup: LocalGlossaryLookup }>(`/api/local-glossary/lookup?${params}`);
  },
  createEntry: (payload: { language: CardLookupLanguage; canonicalForm: string; zhGloss: string }) =>
    requestJson<{ success: true; entry: LocalGlossaryEntry }>('/api/local-glossary/entries', {
      method: 'POST',
      body: JSON.stringify(payload),
    }),
  updateEntry: (id: number, payload: { expectedVersion: number; canonicalForm: string; zhGloss: string }) =>
    requestJson<{ success: true; entry: LocalGlossaryEntry }>(`/api/local-glossary/entries/${id}`, {
      method: 'PATCH',
      body: JSON.stringify(payload),
    }),
  propose: (payload: {
    requestKey: string;
    text: string;
    language: CardLookupLanguage;
    contextLabel?: string;
  }) => requestJson<{ success: true; proposal: LocalGlossaryProposal; idempotent: boolean }>(
    '/api/local-glossary/proposals', {
      method: 'POST',
      body: JSON.stringify(payload),
    }
  ),
  acceptProposal: (id: number, zhGloss: string) => requestJson<{
    success: true;
    proposal: LocalGlossaryProposal;
    entry: LocalGlossaryEntry;
  }>(`/api/local-glossary/proposals/${id}/accept`, {
    method: 'POST',
    body: JSON.stringify({ zhGloss }),
  }),
  rejectProposal: (id: number) => requestJson<{ success: true; proposal: LocalGlossaryProposal }>(
    `/api/local-glossary/proposals/${id}/reject`, { method: 'POST' }
  ),
};
