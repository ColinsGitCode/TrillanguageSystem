import { requestJson } from '../../lib/api/client';
import type {
  KnowledgeKind,
  KnowledgeLanguage,
  KnowledgePoint,
  KnowledgePointSummary,
  LookupResult,
} from './types';

export const knowledgeApi = {
  search: (query: string, language?: KnowledgeLanguage, kind?: KnowledgeKind) => {
    const params = new URLSearchParams({ q: query, limit: '20' });
    if (language) params.set('language', language);
    if (kind) params.set('kind', kind);
    return requestJson<{ success: true; results: KnowledgePointSummary[] }>(`/api/kg/search?${params.toString()}`);
  },
  lookup: (payload: {
    eventKey: string;
    inputText: string;
    language: KnowledgeLanguage;
    kindHint: KnowledgeKind;
    timeZone: string;
  }) => requestJson<{ success: true; lookup: LookupResult }>('/api/kg/lookups', {
    method: 'POST',
    body: JSON.stringify({ ...payload, interactionKind: 'explicit_lookup', sourceContext: { surface: 'knowledge-page' } }),
  }),
  point: (id: number) => requestJson<{ success: true; point: KnowledgePoint }>(`/api/kg/points/${id}`),
};
