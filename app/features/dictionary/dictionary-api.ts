import { requestJson } from '../../lib/api/client';
import type { DictionaryLanguage, DictionarySourceStat, GlossaryEntry, GlossaryEntryStat } from './types';

export const dictionaryApi = {
  entries: (options: { language?: DictionaryLanguage; query?: string; includeArchived?: boolean } = {}) => {
    const params = new URLSearchParams({ limit: '200' });
    if (options.language) params.set('language', options.language);
    if (options.query) params.set('query', options.query);
    if (options.includeArchived) params.set('includeArchived', '1');
    return requestJson<{ success: true; entries: GlossaryEntry[] }>(`/api/local-glossary/entries?${params}`);
  },
  catalog: () => requestJson<{
    success: true;
    catalog: { manual: GlossaryEntryStat[]; dictionaries: DictionarySourceStat[] };
  }>('/api/local-glossary/catalog'),
  create: (payload: {
    language: DictionaryLanguage;
    canonicalForm: string;
    senseKey: string;
    zhGloss: string;
    confidence: GlossaryEntry['confidence'];
  }) => requestJson<{ success: true; entry: GlossaryEntry }>('/api/local-glossary/entries', {
    method: 'POST', body: JSON.stringify(payload),
  }),
  update: (entry: GlossaryEntry, payload: Partial<Pick<GlossaryEntry, 'canonicalForm' | 'senseKey' | 'zhGloss' | 'confidence'>>) => (
    requestJson<{ success: true; entry: GlossaryEntry }>(`/api/local-glossary/entries/${entry.id}`, {
      method: 'PATCH', body: JSON.stringify({ ...payload, expectedVersion: entry.version }),
    })
  ),
  archive: (entry: GlossaryEntry) => requestJson<{ success: true; entry: GlossaryEntry }>(
    `/api/local-glossary/entries/${entry.id}`,
    { method: 'DELETE', body: JSON.stringify({ expectedVersion: entry.version }) },
  ),
  restore: (entry: GlossaryEntry) => requestJson<{ success: true; entry: GlossaryEntry }>(
    `/api/local-glossary/entries/${entry.id}/restore`,
    { method: 'POST', body: JSON.stringify({ expectedVersion: entry.version }) },
  ),
};
