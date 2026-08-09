export type DictionaryLanguage = 'en' | 'ja';
export type GlossaryStatus = 'active' | 'archived';

export type GlossaryEntry = {
  id: number;
  language: DictionaryLanguage;
  canonicalForm: string;
  normalizedForm: string;
  senseKey: string;
  zhGloss: string;
  sourceKind: 'manual' | 'llm-confirmed' | 'imported';
  sourceRef: Record<string, unknown>;
  confidence: 'high' | 'medium' | 'low';
  status: GlossaryStatus;
  version: number;
  createdAtUtc: string;
  updatedAtUtc: string;
};

export type DictionarySourceStat = {
  sourceId: string;
  dictionaryVersion: string;
  language: DictionaryLanguage;
  status: 'active' | 'retired';
  entryCount: number;
  updatedAtUtc: string;
};

export type GlossaryEntryStat = {
  language: DictionaryLanguage;
  status: GlossaryStatus;
  entryCount: number;
};
