import { requestJson } from '../../lib/api/client';
import type {
  KnowledgeKind,
  KnowledgeLanguage,
  KnowledgePoint,
  KnowledgePointSummary,
  LookupResult,
  ResolutionCase,
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
  resolutionCases: (status: ResolutionCase['status'] = 'open') => requestJson<{
    success: true;
    resolutionCases: ResolutionCase[];
  }>(`/api/kg/resolution-cases?status=${encodeURIComponent(status)}&limit=50`),
  resolutionCase: (id: number) => requestJson<{
    success: true;
    resolutionCase: ResolutionCase;
  }>(`/api/kg/resolution-cases/${id}`),
  decideResolutionCase: (id: number, payload: {
    eventKey: string;
    action: 'resolve' | 'dismiss' | 'reopen';
    revision: number;
    pointId?: number;
    point?: {
      kind: KnowledgeKind;
      language: KnowledgeLanguage;
      canonicalForm: string;
      canonicalReading?: string;
      senseDiscriminator?: string;
    };
    publicReason: string;
  }) => requestJson<{
    success: true;
    resolutionCase: ResolutionCase;
    point: KnowledgePointSummary | null;
    reused: boolean;
  }>(`/api/kg/resolution-cases/${id}/decisions`, {
    method: 'POST',
    body: JSON.stringify(payload),
  }),
};
