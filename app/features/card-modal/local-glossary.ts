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

export type LocalGlossaryGloss = {
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
  senseKey: string | null;
  sourceDetail: string | null;
  matchReason: 'reading' | 'context' | 'exact-form' | 'normalized-form' | null;
};

export type LocalGlossaryLookup = {
  status: 'exact' | 'candidate' | 'missing';
  query: {
    text: string;
    language: CardLookupLanguage;
    canonicalForm: string;
    normalizedForm: string;
  };
  gloss: LocalGlossaryGloss | null;
  alternatives: LocalGlossaryGloss[];
};

export type LocalGlossaryFeedbackOutcome = 'shown' | 'rejected' | 'switched' | 'corrected';

// DIC-R2 usage fact. The selected short term is recorded for the problem-term
// list; there is deliberately no field for its surrounding sentence/context.
export type LocalGlossaryFeedback = {
  text: string;
  language: CardLookupLanguage;
  outcome: LocalGlossaryFeedbackOutcome;
  sourceKind: string;
  sourceDetail?: string | null;
  confidence: 'high' | 'medium' | 'low';
  matchReason?: string | null;
  senseKey?: string | null;
  candidateCount?: number;
  chosenRank?: number;
};

export const localGlossaryApi = {
  lookup: (payload: {
    text: string;
    language: CardLookupLanguage;
    generationId?: number | null;
    reading?: string | null;
    context?: string;
  }) => {
    const params = new URLSearchParams({ text: payload.text, language: payload.language });
    if (payload.generationId) params.set('generationId', String(payload.generationId));
    if (payload.reading) params.set('reading', payload.reading);
    if (payload.context) params.set('context', payload.context);
    return requestJson<{ success: true; lookup: LocalGlossaryLookup }>(`/api/local-glossary/lookup?${params}`);
  },
  recordFeedback: (payload: LocalGlossaryFeedback) =>
    requestJson<{ success: true }>('/api/local-glossary/feedback', {
      method: 'POST',
      body: JSON.stringify(payload),
    }),
  createEntry: (payload: {
    language: CardLookupLanguage;
    canonicalForm: string;
    zhGloss: string;
    senseKey?: string;
  }) =>
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
