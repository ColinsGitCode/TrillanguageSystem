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
