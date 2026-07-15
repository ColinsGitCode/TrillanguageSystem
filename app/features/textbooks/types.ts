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

export type TextbookHighlight = {
  id: number;
  generationId: number;
  folderName: string;
  baseFilename: string;
  sourceHash: string;
  version: number;
  htmlContent: string;
  markCount: number;
  highlightedChars: number;
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
