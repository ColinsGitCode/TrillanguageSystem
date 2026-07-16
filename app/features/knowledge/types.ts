export type KnowledgeLanguage = 'en' | 'ja' | 'zh';
export type KnowledgeKind = 'lexeme' | 'phrase' | 'grammar_pattern';

export type KnowledgePointSummary = {
  id: number;
  pointKey: string;
  kind: KnowledgeKind;
  language: KnowledgeLanguage;
  canonicalForm: string;
  canonicalReading: string;
  senseDiscriminator: string;
  identityVersion: string;
  lifecycle: 'active' | 'retired' | 'archived';
  lookupCount7d?: number;
};

export type KnowledgeForm = {
  id: number;
  text: string;
  normalized: string;
  reading: string;
  analysisStatus: string;
  linkKind: 'canonical' | 'inflection-of' | 'polite-of';
  sourceKind: string;
  ruleVersion: string | null;
  confidence: number;
  reason: string;
};

export type KnowledgeEvidence = {
  id: number;
  evidenceKey: string;
  sourceKind: 'generation' | 'study_item' | 'textbook_expression';
  sourceRefId: number;
  sourceRevision: number;
  locator: Record<string, unknown>;
  language: KnowledgeLanguage;
  sourceText: string;
  sourceContentHash: string;
  evidenceRole: 'primary' | 'context';
  attachmentRole: 'primary' | 'context';
  strength: 'strong' | 'weak';
  extractorVersion: string | null;
  reason: string;
};

export type KnowledgePoint = KnowledgePointSummary & {
  stats: null | {
    studyItemCount: number;
    activeStudyItemCount: number;
    dueCount: number;
    reviewEventCount: number;
    explicitLookupCount7d: number;
    explicitLookupCount30d: number;
    evidenceCount: number;
    surfaceFormCount: number;
  };
  forms: KnowledgeForm[];
  evidence: KnowledgeEvidence[];
};

export type ResolutionCase = {
  id: number;
  caseKind: string;
  language: KnowledgeLanguage;
  normalizedInput: string;
  candidates: unknown[];
  status: 'open' | 'resolved' | 'dismissed' | 'superseded';
  revision: number;
};

export type LookupResult = {
  id: number;
  eventKey: string;
  resolution: 'resolved' | 'unresolved';
  point: KnowledgePointSummary | null;
  resolutionCase: ResolutionCase | null;
  reused: boolean;
};
