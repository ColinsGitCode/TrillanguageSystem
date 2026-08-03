export type TextbookCourse = {
  id: number;
  course_key: string;
  title: string;
  source_notice: string | null;
  status: 'active' | 'archived';
  track_count?: number;
  published_track_count?: number;
  tracks?: TextbookTrackSummary[];
};

export type TextbookTrackSummary = {
  id: number;
  course_id: number;
  track_number: number;
  display_order: number;
  title: string;
  status: 'draft' | 'verified' | 'published' | 'archived';
  revision_id?: number | null;
  expression_count?: number | null;
  manifest_hash?: string | null;
};

export type TextbookAsset = {
  id: number;
  revision_id: number;
  asset_key: string;
  kind: 'source_image' | 'official_audio';
  ordinal: number;
  relative_path: string;
  sha256: string;
  byte_size: number;
  mime_type: string;
  duration_ms: number | null;
  availability: 'available' | 'missing' | 'hash-mismatch';
};

export type TextbookExpression = {
  id: number;
  revision_id: number;
  expression_id: number;
  expression_key: string;
  display_ordinal: number;
  official_en_text: string;
  official_ja_text: string;
  zh_cue_text: string;
  ja_ruby_html: string;
  phrase_analysis_json: string;
  grammar_points_json: string;
  confidence_json: string;
  source_spans_json: string;
  provenance_json: string;
  editor_note: string | null;
  en_unit_hash: string;
  ja_unit_hash: string;
  lifecycle: 'active' | 'retired';
};

export type TextbookAudio = {
  id: number;
  generation_id: number;
  language: 'en' | 'ja';
  text: string;
  filename_suffix: string;
  tts_provider: string | null;
  tts_model: string | null;
  tts_voice: string | null;
  file_size?: number | null;
  format?: string | null;
  status: string;
  error_message: string | null;
  playback_url: string;
};

export type TextbookTrack = TextbookTrackSummary & {
  course_key: string;
  course_title: string;
  revision_number: number | null;
  revision_status: 'draft' | 'verified' | 'published' | 'superseded' | 'rejected' | null;
  source_fingerprint: string | null;
  content_hash: string | null;
  generation_id: number | null;
  expressions: TextbookExpression[];
  assets: TextbookAsset[];
  tts_audio: TextbookAudio[];
};

export type TextbookPublishPreview = {
  trackId: number;
  status: string;
  revision: number | null;
  expressionCount: number;
  unitCount: number;
  planRevision: number;
  dailyNewLimit: number | null;
  shortestIntroductionDays: number | null;
};

export type TextbookPublishResult = {
  success: true;
  track: TextbookTrack;
  generationId: number;
  unitCount: number;
  itemActions: { inserted: number; updated: number; unchanged: number; archived: number };
  planRevision: number;
  shortestIntroductionDays: number | null;
};

export type TextbookDerivationPreview = {
  derivation: Record<string, unknown> | null;
  request: {
    expressionId: number;
    sourceExpressionRevisionId: number;
    selectionLanguage: 'en' | 'ja';
    selectionText: string;
    selectionHash: string;
    targetCardType: 'trilingual' | 'grammar_ja';
    targetPhrase: string;
  };
  expression: {
    id: number;
    revisionId: number;
    expressionKey: string;
    trackId: number;
    trackTitle: string;
    officialEnText: string;
    officialJaText: string;
    zhCueText: string;
  };
};

export type TextbookImportSummary = {
  status: string;
  courseKey: string;
  trackNumber: number;
  expressionCount: number;
  phraseCount: number;
  grammarNoteCount: number;
  annotatedRubySegments: number;
  unitCounts: { textbookEn: number; textbookJa: number; total: number };
  hashes: { manifestFileHash: string; sourceFingerprint: string; contentHash: string };
};

export type TextbookReviewState = 'pending' | 'needs_attention' | 'confirmed';

export type TextbookReviewTask = {
  id: string;
  expressionId: number;
  expressionRevisionId: number;
  ordinal: number;
  title: string;
  summary: string;
  state: TextbookReviewState;
  reasons: string[];
  confidence: Record<string, number>;
  source: {
    spans: Array<Record<string, unknown>>;
    provenance: Record<string, unknown>;
    enUnitHash: string;
    jaUnitHash: string;
  };
  content: {
    officialEnText: string;
    officialJaText: string;
    zhCueText: string;
    jaRubyHtml: string;
    phraseAnalysisJson: string;
    grammarPointsJson: string;
    editorNote: string | null;
  };
};

export type TextbookOperationStatus = 'queued' | 'running' | 'succeeded' | 'partially_failed' | 'failed' | 'cancelled';

export type TextbookOperationStepResult = {
  status: TextbookOperationStatus;
  errorCode?: string | null;
  retryable?: boolean;
  summary?: string | null;
  result?: unknown;
};

export type TextbookOperation = {
  id: number;
  track_id: number;
  track_revision_id: number;
  kind: 'release' | 'tts' | 'sync';
  status: TextbookOperationStatus;
  idempotency_key: string;
  preview_revision: string | null;
  current_step: string | null;
  attempts: number;
  public_summary: string | null;
  error_code: string | null;
  created_at_utc: string;
  updated_at_utc: string;
  finished_at_utc: string | null;
  result: {
    command?: Record<string, unknown>;
    steps?: Record<string, TextbookOperationStepResult>;
    published?: boolean;
    cancelRequested?: boolean;
    cancelRequestedAtUtc?: string;
  };
};

export type TextbookOperationEvent = {
  id: number;
  operation_id: number;
  sequence: number;
  event_type: string;
  step: string | null;
  status: TextbookOperationStatus;
  public_summary: string | null;
  error_code: string | null;
  retryable: 0 | 1;
  occurred_at_utc: string;
};

export type TextbookWorkflow = {
  track: {
    id: number;
    title: string;
    status: TextbookTrackSummary['status'];
    revisionId: number;
    revisionNumber: number;
    courseKey: string;
    trackNumber: number;
  };
  stage: 'intake' | 'review' | 'release' | 'processing' | 'complete';
  review: {
    total: number;
    confirmed: number;
    needsAttention: number;
    pending: number;
    tasks: TextbookReviewTask[];
  };
  release: {
    available: boolean;
    previewRevision: string;
    expressionCount: number;
    unitCount: number;
    planRevision: number;
    dailyNewLimit: number | null;
    shortestIntroductionDays: number | null;
    warnings: string[];
  };
  operation: TextbookOperation | null;
  commands: {
    saveDraft: boolean;
    updateReview: boolean;
    verify: boolean;
    release: boolean;
    retry: boolean;
    cancel: boolean;
  };
};
