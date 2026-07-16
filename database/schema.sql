-- ========================================
-- 三语卡片生成系统 - 数据库Schema
-- ========================================
-- 数据库: SQLite 3
-- 引擎: better-sqlite3
-- 版本: 1.0
-- 创建日期: 2026-02-03
-- ========================================

-- 启用外键约束
PRAGMA foreign_keys = ON;

-- 启用WAL模式（提升并发性能）
PRAGMA journal_mode = WAL;

-- ========================================
-- 表 1: generations（生成记录主表）
-- ========================================

CREATE TABLE IF NOT EXISTS generations (
  -- 主键
  id INTEGER PRIMARY KEY AUTOINCREMENT,

  -- 基本信息
  phrase TEXT NOT NULL,
  phrase_language TEXT,
  card_type TEXT NOT NULL DEFAULT 'trilingual',
  source_mode TEXT,

  -- 提供商信息
  llm_provider TEXT NOT NULL,
  llm_model TEXT,

  -- 文件路径
  folder_name TEXT NOT NULL,
  base_filename TEXT NOT NULL,
  md_file_path TEXT NOT NULL,
  html_file_path TEXT NOT NULL,
  meta_file_path TEXT,

  -- 内容
  markdown_content TEXT NOT NULL,
  content_hash TEXT NOT NULL,

  -- 翻译内容（提取字段）
  en_translation TEXT,
  ja_translation TEXT,
  zh_translation TEXT,

  -- 时间戳
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  generation_date DATE,

  -- 元数据
  request_id TEXT UNIQUE,
  user_agent TEXT,
  ip_address TEXT
);

-- 索引
CREATE INDEX IF NOT EXISTS idx_generations_phrase ON generations(phrase);
CREATE INDEX IF NOT EXISTS idx_generations_date ON generations(generation_date DESC);
CREATE INDEX IF NOT EXISTS idx_generations_provider ON generations(llm_provider);
CREATE INDEX IF NOT EXISTS idx_generations_created_at ON generations(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_generations_request_id ON generations(request_id);
CREATE INDEX IF NOT EXISTS idx_gen_date_provider ON generations(generation_date DESC, llm_provider);

-- 全文搜索虚拟表
CREATE VIRTUAL TABLE IF NOT EXISTS generations_fts USING fts5(
  phrase,
  en_translation,
  ja_translation,
  zh_translation,
  markdown_content,
  content=generations,
  content_rowid=id
);

-- FTS触发器
CREATE TRIGGER IF NOT EXISTS generations_fts_insert AFTER INSERT ON generations
WHEN new.card_type <> 'textbook_track'
BEGIN
  INSERT INTO generations_fts(rowid, phrase, en_translation, ja_translation, zh_translation, markdown_content)
  VALUES (new.id, new.phrase, new.en_translation, new.ja_translation, new.zh_translation, new.markdown_content);
END;

CREATE TRIGGER IF NOT EXISTS generations_fts_delete AFTER DELETE ON generations
WHEN old.card_type <> 'textbook_track'
BEGIN
  INSERT INTO generations_fts(generations_fts, rowid, phrase, en_translation, ja_translation, zh_translation, markdown_content)
  VALUES ('delete', old.id, old.phrase, old.en_translation, old.ja_translation, old.zh_translation, old.markdown_content);
END;

CREATE TRIGGER IF NOT EXISTS generations_fts_update AFTER UPDATE ON generations BEGIN
  INSERT INTO generations_fts(generations_fts, rowid, phrase, en_translation, ja_translation, zh_translation, markdown_content)
  SELECT 'delete', old.id, old.phrase, old.en_translation, old.ja_translation, old.zh_translation, old.markdown_content
  WHERE old.card_type <> 'textbook_track';
  INSERT INTO generations_fts(rowid, phrase, en_translation, ja_translation, zh_translation, markdown_content)
  SELECT new.id, new.phrase, new.en_translation, new.ja_translation, new.zh_translation, new.markdown_content
  WHERE new.card_type <> 'textbook_track';
END;

CREATE TRIGGER IF NOT EXISTS generations_content_hash_required_insert
BEFORE INSERT ON generations
WHEN NEW.content_hash IS NULL OR length(trim(NEW.content_hash)) != 64
BEGIN
  SELECT RAISE(ABORT, 'generations.content_hash must be a SHA-256 hash');
END;

CREATE TRIGGER IF NOT EXISTS generations_content_hash_required_update
BEFORE UPDATE OF content_hash ON generations
WHEN NEW.content_hash IS NULL OR length(trim(NEW.content_hash)) != 64
BEGIN
  SELECT RAISE(ABORT, 'generations.content_hash must be a SHA-256 hash');
END;

-- ========================================
-- 表 2: audio_files（音频文件记录）
-- ========================================

CREATE TABLE IF NOT EXISTS audio_files (
  id INTEGER PRIMARY KEY AUTOINCREMENT,

  generation_id INTEGER NOT NULL,

  -- 音频信息
  language TEXT NOT NULL,
  text TEXT NOT NULL,
  filename_suffix TEXT NOT NULL,
  file_path TEXT NOT NULL,

  -- TTS服务信息
  tts_provider TEXT,
  tts_model TEXT,
  tts_voice TEXT,

  -- 音频元数据
  file_size INTEGER,
  duration REAL,
  sample_rate INTEGER,
  format TEXT,

  -- 生成状态
  status TEXT DEFAULT 'pending',
  error_message TEXT,

  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  generated_at DATETIME,

  FOREIGN KEY (generation_id) REFERENCES generations(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_audio_generation ON audio_files(generation_id);
CREATE INDEX IF NOT EXISTS idx_audio_language ON audio_files(language);
CREATE INDEX IF NOT EXISTS idx_audio_status ON audio_files(status);
CREATE INDEX IF NOT EXISTS idx_audio_generated ON audio_files(generation_id) WHERE status = 'generated';
CREATE UNIQUE INDEX IF NOT EXISTS idx_audio_generation_suffix ON audio_files(generation_id, filename_suffix);

-- ========================================
-- 表 3: observability_metrics（可观测性指标）
-- ========================================

CREATE TABLE IF NOT EXISTS observability_metrics (
  id INTEGER PRIMARY KEY AUTOINCREMENT,

  generation_id INTEGER NOT NULL UNIQUE,

  -- Token统计
  tokens_input INTEGER,
  tokens_output INTEGER,
  tokens_total INTEGER,
  tokens_cached INTEGER DEFAULT 0,

  -- 成本估算
  cost_input REAL,
  cost_output REAL,
  cost_total REAL,
  cost_currency TEXT DEFAULT 'USD',

  -- 配额信息
  quota_used INTEGER,
  quota_limit INTEGER,
  quota_remaining INTEGER,
  quota_reset_at DATETIME,
  quota_percentage REAL,

  -- 性能指标
  performance_total_ms INTEGER,
  performance_phases TEXT, -- JSON

  -- 质量评分
  quality_score INTEGER,
  quality_checks TEXT, -- JSON
  quality_dimensions TEXT, -- JSON
  quality_warnings TEXT, -- JSON

  -- Prompt信息
  prompt_full TEXT,
  prompt_parsed TEXT, -- JSON

  -- LLM输出
  llm_output TEXT,
  llm_finish_reason TEXT,

  -- 元数据
  metadata TEXT, -- JSON

  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,

  FOREIGN KEY (generation_id) REFERENCES generations(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_obs_generation ON observability_metrics(generation_id);
CREATE INDEX IF NOT EXISTS idx_obs_quality ON observability_metrics(quality_score DESC);
CREATE INDEX IF NOT EXISTS idx_obs_tokens ON observability_metrics(tokens_total DESC);
CREATE INDEX IF NOT EXISTS idx_obs_cost ON observability_metrics(cost_total DESC);
CREATE INDEX IF NOT EXISTS idx_obs_quality_date ON observability_metrics(quality_score DESC, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_obs_cost_provider ON observability_metrics(cost_total DESC) WHERE cost_total > 0;

-- ========================================
-- 表 4: generation_errors（生成错误记录）
-- ========================================

CREATE TABLE IF NOT EXISTS generation_errors (
  id INTEGER PRIMARY KEY AUTOINCREMENT,

  -- 请求信息
  phrase TEXT NOT NULL,
  llm_provider TEXT NOT NULL,
  request_id TEXT,

  -- 错误信息
  error_type TEXT,
  error_message TEXT NOT NULL,
  error_stack TEXT,

  -- 上下文信息
  prompt TEXT,
  llm_response TEXT,
  validation_errors TEXT, -- JSON

  -- 重试信息
  retry_count INTEGER DEFAULT 0,
  retry_success BOOLEAN DEFAULT FALSE,

  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  resolved_at DATETIME
);

CREATE INDEX IF NOT EXISTS idx_errors_type ON generation_errors(error_type);
CREATE INDEX IF NOT EXISTS idx_errors_created ON generation_errors(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_errors_unresolved ON generation_errors(created_at DESC) WHERE resolved_at IS NULL;

-- ========================================
-- 表 5: model_statistics（模型统计）
-- ========================================

CREATE TABLE IF NOT EXISTS model_statistics (
  id INTEGER PRIMARY KEY AUTOINCREMENT,

  llm_provider TEXT NOT NULL,
  llm_model TEXT NOT NULL,

  stat_date DATE NOT NULL,
  stat_period TEXT NOT NULL,

  -- 使用统计
  total_requests INTEGER DEFAULT 0,
  successful_requests INTEGER DEFAULT 0,
  failed_requests INTEGER DEFAULT 0,
  success_rate REAL,

  -- Token统计
  avg_tokens_input REAL,
  avg_tokens_output REAL,
  total_tokens INTEGER,

  -- 成本统计
  total_cost REAL,
  avg_cost_per_request REAL,

  -- 性能统计
  avg_response_time_ms REAL,
  p50_response_time_ms INTEGER,
  p95_response_time_ms INTEGER,
  p99_response_time_ms INTEGER,

  -- 质量统计
  avg_quality_score REAL,
  min_quality_score INTEGER,
  max_quality_score INTEGER,

  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,

  UNIQUE(llm_provider, llm_model, stat_date, stat_period)
);

CREATE INDEX IF NOT EXISTS idx_stats_provider ON model_statistics(llm_provider, llm_model);
CREATE INDEX IF NOT EXISTS idx_stats_date ON model_statistics(stat_date DESC);

-- ========================================
-- 表 6: system_health（系统健康历史）
-- ========================================

CREATE TABLE IF NOT EXISTS system_health (
  id INTEGER PRIMARY KEY AUTOINCREMENT,

  services TEXT NOT NULL, -- JSON
  storage_used INTEGER,
  storage_total INTEGER,
  storage_percentage REAL,
  records_count INTEGER,

  system_uptime INTEGER,
  system_version TEXT,

  checked_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_health_checked ON system_health(checked_at DESC);

-- ========================================
-- 表 17: card_highlights（卡片标红持久化）
-- ========================================

CREATE TABLE IF NOT EXISTS card_highlights (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  generation_id INTEGER,
  folder_name TEXT NOT NULL,
  base_filename TEXT NOT NULL,
  source_hash TEXT NOT NULL,
  version INTEGER NOT NULL DEFAULT 1,
  html_content TEXT NOT NULL,
  mark_count INTEGER NOT NULL DEFAULT 0,
  highlighted_chars INTEGER NOT NULL DEFAULT 0,
  updated_by TEXT DEFAULT 'ui',
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,

  UNIQUE(folder_name, base_filename, source_hash),
  FOREIGN KEY (generation_id) REFERENCES generations(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_ch_generation ON card_highlights(generation_id);
CREATE INDEX IF NOT EXISTS idx_ch_file ON card_highlights(folder_name, base_filename);
CREATE INDEX IF NOT EXISTS idx_ch_updated_at ON card_highlights(updated_at DESC);

-- ========================================
-- 表 18: generation_jobs（服务端共享生成队列）
-- ========================================

CREATE TABLE IF NOT EXISTS generation_jobs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  job_type TEXT NOT NULL DEFAULT 'trilingual',    -- trilingual | grammar_ja
  phrase_raw TEXT,
  phrase_normalized TEXT NOT NULL,
  source_mode TEXT,
  target_folder TEXT,
  llm_provider TEXT NOT NULL DEFAULT 'deepseek',
  llm_model TEXT,
  enable_compare INTEGER DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'queued',          -- queued/running/success/failed/cancelled
  attempts INTEGER NOT NULL DEFAULT 0,
  max_retries INTEGER NOT NULL DEFAULT 2,
  error_message TEXT,
  retry_after_ts INTEGER,
  source_context_json TEXT,
  created_by_client TEXT,
  result_generation_id INTEGER,
  result_folder TEXT,
  result_base_filename TEXT,
  request_payload_json TEXT,
  result_summary_json TEXT,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  started_at DATETIME,
  finished_at DATETIME,
  cleared_at DATETIME,

  FOREIGN KEY (result_generation_id) REFERENCES generations(id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_gj_status_created ON generation_jobs(status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_gj_active_queue ON generation_jobs(cleared_at, status, id ASC);
CREATE INDEX IF NOT EXISTS idx_gj_result_generation ON generation_jobs(result_generation_id);

-- ========================================
-- 表 19: generation_job_events（生成队列审计事件）
-- ========================================

CREATE TABLE IF NOT EXISTS generation_job_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  job_id INTEGER NOT NULL,
  event_type TEXT NOT NULL,                      -- created/picked/retry_scheduled/succeeded/failed/cancelled/cleared/recovered
  payload_json TEXT,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,

  FOREIGN KEY (job_id) REFERENCES generation_jobs(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_gje_job_created ON generation_job_events(job_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_gje_type_created ON generation_job_events(event_type, created_at DESC);

-- ========================================
-- 表 20: card_tags（卡片标签）
-- ========================================

CREATE TABLE IF NOT EXISTS card_tags (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  generation_id INTEGER NOT NULL,
  namespace TEXT NOT NULL,
  value TEXT NOT NULL,
  normalized_value TEXT NOT NULL,
  source TEXT NOT NULL DEFAULT 'user',
  status TEXT NOT NULL DEFAULT 'active',
  rule_version TEXT,
  rule_key TEXT,
  evidence_json TEXT,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  CHECK (namespace IN ('topic', 'fn', 'lang', 'src', 'qa', 'tag')),
  CHECK (source IN ('rule', 'user', 'import')),
  CHECK (status IN ('active', 'suppressed')),
  UNIQUE (generation_id, namespace, normalized_value),
  FOREIGN KEY (generation_id) REFERENCES generations(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_card_tags_active_ns_value
  ON card_tags(namespace, normalized_value) WHERE status = 'active';
CREATE INDEX IF NOT EXISTS idx_card_tags_generation ON card_tags(generation_id);

-- ========================================
-- 迁移基础设施: schema_migrations
-- ========================================

CREATE TABLE IF NOT EXISTS schema_migrations (
  version TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  checksum TEXT NOT NULL CHECK (length(checksum) = 64),
  is_baseline INTEGER NOT NULL DEFAULT 0 CHECK (is_baseline IN (0, 1)),
  applied_at_utc TEXT NOT NULL
);

-- ========================================
-- 表 21: learning_profiles（学习域配置）
-- ========================================

CREATE TABLE IF NOT EXISTS learning_profiles (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  time_zone TEXT NOT NULL,
  scheduler_id TEXT NOT NULL,
  scheduler_version TEXT NOT NULL,
  scheduler_adapter TEXT NOT NULL,
  parameters_json TEXT NOT NULL CHECK (json_valid(parameters_json)),
  parameters_hash TEXT NOT NULL CHECK (length(parameters_hash) = 64),
  revision INTEGER NOT NULL DEFAULT 1 CHECK (revision >= 1),
  created_at_utc TEXT NOT NULL,
  updated_at_utc TEXT NOT NULL
);

-- ========================================
-- 表 22: learning_source_admissions（Cards -> Learning 准入投影）
-- ========================================

CREATE TABLE IF NOT EXISTS learning_source_admissions (
  generation_id INTEGER PRIMARY KEY,
  status TEXT NOT NULL CHECK (status IN ('eligible', 'whole-card-only', 'quarantined', 'unresolved')),
  content_hash TEXT NOT NULL CHECK (length(content_hash) = 64),
  reasons_json TEXT NOT NULL CHECK (json_valid(reasons_json) AND json_type(reasons_json) = 'array'),
  decision_version TEXT NOT NULL,
  state_version TEXT NOT NULL,
  dp_state_hash TEXT,
  materialization_disposition TEXT NOT NULL CHECK (materialization_disposition IN ('create-items', 'adopt-existing', 'exclude')),
  identity_anchor_generation_id INTEGER NOT NULL CHECK (identity_anchor_generation_id > 0),
  admission_source TEXT NOT NULL CHECK (admission_source IN ('dp7', 'online', 'manual', 'rule-reassessment')),
  evaluated_at_utc TEXT NOT NULL,
  created_at_utc TEXT NOT NULL,
  updated_at_utc TEXT NOT NULL,
  CHECK (
    (materialization_disposition = 'create-items' AND identity_anchor_generation_id = generation_id)
    OR (materialization_disposition = 'adopt-existing' AND identity_anchor_generation_id <> generation_id)
    OR materialization_disposition = 'exclude'
  ),
  FOREIGN KEY (generation_id) REFERENCES generations(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_lsa_status_disposition
  ON learning_source_admissions(status, materialization_disposition);
CREATE INDEX IF NOT EXISTS idx_lsa_identity_anchor
  ON learning_source_admissions(identity_anchor_generation_id);

-- ========================================
-- 表 23: learning_plans（单计划配置）
-- ========================================

CREATE TABLE IF NOT EXISTS learning_plans (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  status TEXT NOT NULL CHECK (status IN ('active', 'paused')),
  scope_json TEXT NOT NULL CHECK (json_valid(scope_json)),
  daily_action_goal INTEGER NOT NULL DEFAULT 20 CHECK (daily_action_goal BETWEEN 5 AND 100),
  daily_new_limit INTEGER NOT NULL DEFAULT 5 CHECK (daily_new_limit BETWEEN 0 AND 50),
  revision INTEGER NOT NULL DEFAULT 1 CHECK (revision >= 1),
  created_at_utc TEXT NOT NULL,
  updated_at_utc TEXT NOT NULL
);

-- ========================================
-- 表 24: study_items（稳定学习单元）
-- ========================================

CREATE TABLE IF NOT EXISTS study_items (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  generation_id INTEGER,
  source_generation_id INTEGER NOT NULL CHECK (source_generation_id > 0),
  unit_key TEXT NOT NULL,
  unit_kind TEXT NOT NULL CHECK (unit_kind IN ('trilingual_en', 'trilingual_ja', 'grammar_ja', 'scenario_bilingual', 'whole_card', 'textbook_en', 'textbook_ja')),
  unit_locator_json TEXT NOT NULL CHECK (json_valid(unit_locator_json)),
  content_hash TEXT NOT NULL CHECK (length(content_hash) = 64),
  content_revision INTEGER NOT NULL DEFAULT 1 CHECK (content_revision >= 1),
  lifecycle TEXT NOT NULL DEFAULT 'active' CHECK (lifecycle IN ('active', 'suspended', 'archived')),
  lifecycle_reason TEXT,
  created_at_utc TEXT NOT NULL,
  updated_at_utc TEXT NOT NULL,
  UNIQUE (source_generation_id, unit_key),
  FOREIGN KEY (generation_id) REFERENCES generations(id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_study_items_generation ON study_items(generation_id);
CREATE INDEX IF NOT EXISTS idx_study_items_lifecycle ON study_items(lifecycle, unit_kind);

-- ========================================
-- 表 25: learning_daily_queues（每日队列快照）
-- ========================================

CREATE TABLE IF NOT EXISTS learning_daily_queues (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  plan_id INTEGER NOT NULL,
  learning_day TEXT NOT NULL CHECK (length(learning_day) = 10),
  time_zone TEXT NOT NULL,
  plan_revision INTEGER NOT NULL CHECK (plan_revision >= 1),
  profile_revision INTEGER NOT NULL CHECK (profile_revision >= 1),
  status TEXT NOT NULL DEFAULT 'ready' CHECK (status IN ('ready', 'active', 'completed', 'superseded')),
  snapshot_json TEXT NOT NULL CHECK (json_valid(snapshot_json)),
  created_at_utc TEXT NOT NULL,
  updated_at_utc TEXT NOT NULL,
  UNIQUE (plan_id, learning_day, plan_revision, profile_revision),
  FOREIGN KEY (plan_id) REFERENCES learning_plans(id) ON DELETE RESTRICT
);

CREATE INDEX IF NOT EXISTS idx_learning_queues_day_status
  ON learning_daily_queues(learning_day, status);

-- ========================================
-- 表 26: learning_queue_entries（队列工作流）
-- ========================================

CREATE TABLE IF NOT EXISTS learning_queue_entries (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  queue_id INTEGER NOT NULL,
  study_item_id INTEGER NOT NULL,
  reason TEXT NOT NULL,
  bucket INTEGER NOT NULL CHECK (bucket BETWEEN 1 AND 6),
  provider_score REAL,
  explanation_json TEXT NOT NULL DEFAULT '{}' CHECK (json_valid(explanation_json)),
  available_at_utc TEXT,
  due_at_utc TEXT,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'active', 'deferred', 'completed', 'skipped')),
  attempts INTEGER NOT NULL DEFAULT 0 CHECK (attempts >= 0),
  last_event_id INTEGER,
  created_at_utc TEXT NOT NULL,
  updated_at_utc TEXT NOT NULL,
  UNIQUE (queue_id, study_item_id),
  FOREIGN KEY (queue_id) REFERENCES learning_daily_queues(id) ON DELETE CASCADE,
  FOREIGN KEY (study_item_id) REFERENCES study_items(id) ON DELETE RESTRICT
);

CREATE INDEX IF NOT EXISTS idx_learning_entries_queue_status
  ON learning_queue_entries(queue_id, status, bucket, available_at_utc);

-- ========================================
-- 表 27: learning_sessions（会话恢复状态）
-- ========================================

CREATE TABLE IF NOT EXISTS learning_sessions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  queue_id INTEGER NOT NULL,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'completed', 'ended')),
  current_entry_id INTEGER,
  revealed_entry_id INTEGER,
  revealed_at_utc TEXT,
  started_at_utc TEXT NOT NULL,
  last_activity_at_utc TEXT NOT NULL,
  ended_at_utc TEXT,
  FOREIGN KEY (queue_id) REFERENCES learning_daily_queues(id) ON DELETE RESTRICT,
  FOREIGN KEY (current_entry_id) REFERENCES learning_queue_entries(id) ON DELETE SET NULL,
  FOREIGN KEY (revealed_entry_id) REFERENCES learning_queue_entries(id) ON DELETE SET NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_learning_sessions_one_active
  ON learning_sessions((1)) WHERE status = 'active';
CREATE INDEX IF NOT EXISTS idx_learning_sessions_queue ON learning_sessions(queue_id, status);

-- ========================================
-- 表 28: learning_review_events（append-only 评分事实）
-- ========================================

CREATE TABLE IF NOT EXISTS learning_review_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  event_key TEXT NOT NULL UNIQUE,
  request_hash TEXT NOT NULL CHECK (length(request_hash) = 64),
  study_item_id INTEGER NOT NULL,
  session_id INTEGER NOT NULL,
  queue_entry_id INTEGER NOT NULL,
  rating INTEGER NOT NULL CHECK (rating BETWEEN 1 AND 4),
  response_ms INTEGER NOT NULL CHECK (response_ms >= 0),
  occurred_at_utc TEXT NOT NULL,
  learning_day TEXT NOT NULL CHECK (length(learning_day) = 10),
  time_zone TEXT NOT NULL,
  content_hash TEXT NOT NULL CHECK (length(content_hash) = 64),
  before_state_json TEXT NOT NULL CHECK (json_valid(before_state_json)),
  after_state_json TEXT NOT NULL CHECK (json_valid(after_state_json)),
  algorithm_id TEXT NOT NULL,
  algorithm_version TEXT NOT NULL,
  parameters_hash TEXT NOT NULL CHECK (length(parameters_hash) = 64),
  public_explanation_json TEXT NOT NULL CHECK (json_valid(public_explanation_json)),
  created_at_utc TEXT NOT NULL,
  FOREIGN KEY (study_item_id) REFERENCES study_items(id) ON DELETE RESTRICT,
  FOREIGN KEY (session_id) REFERENCES learning_sessions(id) ON DELETE RESTRICT,
  FOREIGN KEY (queue_entry_id) REFERENCES learning_queue_entries(id) ON DELETE RESTRICT
);

CREATE INDEX IF NOT EXISTS idx_learning_events_item_time
  ON learning_review_events(study_item_id, occurred_at_utc DESC);
CREATE INDEX IF NOT EXISTS idx_learning_events_day ON learning_review_events(learning_day);

-- ========================================
-- 表 29: learning_schedule_states（当前 FSRS 投影）
-- ========================================

CREATE TABLE IF NOT EXISTS learning_schedule_states (
  study_item_id INTEGER PRIMARY KEY,
  fsrs_state TEXT NOT NULL CHECK (fsrs_state IN ('new', 'learning', 'review', 'relearning')),
  due_at_utc TEXT NOT NULL,
  last_reviewed_at_utc TEXT,
  stability REAL CHECK (stability IS NULL OR stability >= 0),
  difficulty REAL CHECK (difficulty IS NULL OR difficulty BETWEEN 1 AND 10),
  elapsed_days INTEGER NOT NULL DEFAULT 0 CHECK (elapsed_days >= 0),
  scheduled_days INTEGER NOT NULL DEFAULT 0 CHECK (scheduled_days >= 0),
  reps INTEGER NOT NULL DEFAULT 0 CHECK (reps >= 0),
  lapses INTEGER NOT NULL DEFAULT 0 CHECK (lapses >= 0),
  step INTEGER NOT NULL DEFAULT 0 CHECK (step >= 0),
  version INTEGER NOT NULL DEFAULT 0 CHECK (version >= 0),
  last_event_id INTEGER,
  algorithm_id TEXT NOT NULL,
  algorithm_version TEXT NOT NULL,
  parameters_hash TEXT NOT NULL CHECK (length(parameters_hash) = 64),
  updated_at_utc TEXT NOT NULL,
  FOREIGN KEY (study_item_id) REFERENCES study_items(id) ON DELETE CASCADE,
  FOREIGN KEY (last_event_id) REFERENCES learning_review_events(id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_learning_schedule_due
  ON learning_schedule_states(due_at_utc, fsrs_state);

-- ========================================
-- 表 30: textbook_courses（教材课程）
-- ========================================

CREATE TABLE IF NOT EXISTS textbook_courses (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  course_key TEXT NOT NULL UNIQUE,
  title TEXT NOT NULL,
  source_notice TEXT,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'archived')),
  created_at_utc TEXT NOT NULL,
  updated_at_utc TEXT NOT NULL
);

-- ========================================
-- 表 31: textbook_tracks（教材 Track）
-- ========================================

CREATE TABLE IF NOT EXISTS textbook_tracks (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  course_id INTEGER NOT NULL,
  track_number INTEGER NOT NULL CHECK (track_number > 0),
  display_order INTEGER NOT NULL DEFAULT 0,
  title TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'verified', 'published', 'archived')),
  current_revision_id INTEGER,
  pending_revision_id INTEGER,
  generation_id INTEGER UNIQUE,
  published_at_utc TEXT,
  created_at_utc TEXT NOT NULL,
  updated_at_utc TEXT NOT NULL,
  UNIQUE (course_id, track_number),
  FOREIGN KEY (course_id) REFERENCES textbook_courses(id) ON DELETE RESTRICT,
  FOREIGN KEY (current_revision_id) REFERENCES textbook_track_revisions(id) ON DELETE SET NULL,
  FOREIGN KEY (pending_revision_id) REFERENCES textbook_track_revisions(id) ON DELETE SET NULL,
  FOREIGN KEY (generation_id) REFERENCES generations(id) ON DELETE SET NULL
);

-- ========================================
-- 表 32: textbook_track_revisions（Track 修订事实）
-- ========================================

CREATE TABLE IF NOT EXISTS textbook_track_revisions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  track_id INTEGER NOT NULL,
  revision_number INTEGER NOT NULL CHECK (revision_number > 0),
  parent_revision_id INTEGER,
  status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'verified', 'published', 'superseded', 'rejected')),
  origin TEXT NOT NULL CHECK (origin IN ('import', 'user-edit', 'structure-edit', 'ai-regeneration')),
  manifest_schema_version TEXT,
  manifest_relative_path TEXT,
  manifest_hash TEXT CHECK (manifest_hash IS NULL OR length(manifest_hash) = 64),
  source_fingerprint TEXT CHECK (source_fingerprint IS NULL OR length(source_fingerprint) = 64),
  content_hash TEXT NOT NULL CHECK (length(content_hash) = 64),
  projection_hash TEXT NOT NULL CHECK (length(projection_hash) = 64),
  expression_count INTEGER NOT NULL CHECK (expression_count >= 0),
  skill_name TEXT,
  skill_version TEXT,
  skill_input_summary_json TEXT CHECK (skill_input_summary_json IS NULL OR json_valid(skill_input_summary_json)),
  change_summary_json TEXT NOT NULL DEFAULT '{}' CHECK (json_valid(change_summary_json)),
  created_at_utc TEXT NOT NULL,
  verified_at_utc TEXT,
  UNIQUE (track_id, revision_number),
  CHECK (
    (
      origin = 'import'
      AND parent_revision_id IS NULL
      AND manifest_schema_version IS NOT NULL
      AND manifest_relative_path IS NOT NULL
      AND manifest_hash IS NOT NULL
      AND source_fingerprint IS NOT NULL
      AND skill_name IS NOT NULL
      AND skill_version IS NOT NULL
      AND skill_input_summary_json IS NOT NULL
    )
    OR (
      origin <> 'import'
      AND parent_revision_id IS NOT NULL
      AND manifest_schema_version IS NULL
      AND manifest_relative_path IS NULL
      AND manifest_hash IS NULL
      AND source_fingerprint IS NULL
    )
  ),
  FOREIGN KEY (track_id) REFERENCES textbook_tracks(id) ON DELETE RESTRICT,
  FOREIGN KEY (parent_revision_id) REFERENCES textbook_track_revisions(id) ON DELETE RESTRICT
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_textbook_revision_source_fingerprint
  ON textbook_track_revisions(source_fingerprint)
  WHERE source_fingerprint IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_textbook_revisions_track_status
  ON textbook_track_revisions(track_id, status, revision_number DESC);

-- ========================================
-- 表 33: textbook_track_assets（教材源图与官方音频）
-- ========================================

CREATE TABLE IF NOT EXISTS textbook_track_assets (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  revision_id INTEGER NOT NULL,
  asset_key TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('source_image', 'official_audio')),
  ordinal INTEGER NOT NULL DEFAULT 0 CHECK (ordinal >= 0),
  relative_path TEXT NOT NULL,
  sha256 TEXT NOT NULL CHECK (length(sha256) = 64),
  byte_size INTEGER NOT NULL CHECK (byte_size >= 0),
  mime_type TEXT NOT NULL,
  duration_ms INTEGER CHECK (duration_ms IS NULL OR duration_ms >= 0),
  availability TEXT NOT NULL DEFAULT 'available' CHECK (availability IN ('available', 'missing', 'hash-mismatch')),
  observed_mtime_ms INTEGER CHECK (observed_mtime_ms IS NULL OR observed_mtime_ms >= 0),
  verified_at_utc TEXT,
  UNIQUE (revision_id, asset_key),
  UNIQUE (revision_id, kind, ordinal),
  FOREIGN KEY (revision_id) REFERENCES textbook_track_revisions(id) ON DELETE RESTRICT
);

CREATE INDEX IF NOT EXISTS idx_textbook_assets_revision_kind
  ON textbook_track_assets(revision_id, kind, availability);

-- ========================================
-- 表 34: textbook_expressions（稳定表达身份）
-- ========================================

CREATE TABLE IF NOT EXISTS textbook_expressions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  track_id INTEGER NOT NULL,
  expression_key TEXT NOT NULL,
  lifecycle TEXT NOT NULL DEFAULT 'active' CHECK (lifecycle IN ('active', 'retired')),
  created_revision_id INTEGER NOT NULL,
  retired_revision_id INTEGER,
  created_at_utc TEXT NOT NULL,
  updated_at_utc TEXT NOT NULL,
  UNIQUE (track_id, expression_key),
  FOREIGN KEY (track_id) REFERENCES textbook_tracks(id) ON DELETE RESTRICT,
  FOREIGN KEY (created_revision_id) REFERENCES textbook_track_revisions(id) ON DELETE RESTRICT,
  FOREIGN KEY (retired_revision_id) REFERENCES textbook_track_revisions(id) ON DELETE RESTRICT
);

CREATE INDEX IF NOT EXISTS idx_textbook_expressions_track_lifecycle
  ON textbook_expressions(track_id, lifecycle, expression_key);

-- ========================================
-- 表 35: textbook_expression_revisions（表达修订事实）
-- ========================================

CREATE TABLE IF NOT EXISTS textbook_expression_revisions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  revision_id INTEGER NOT NULL,
  expression_id INTEGER NOT NULL,
  display_ordinal INTEGER NOT NULL CHECK (display_ordinal > 0),
  official_en_text TEXT NOT NULL,
  official_ja_text TEXT NOT NULL,
  zh_cue_text TEXT NOT NULL,
  ja_ruby_html TEXT NOT NULL,
  phrase_analysis_json TEXT NOT NULL DEFAULT '{}' CHECK (json_valid(phrase_analysis_json)),
  grammar_points_json TEXT NOT NULL DEFAULT '[]' CHECK (json_valid(grammar_points_json)),
  confidence_json TEXT NOT NULL DEFAULT '{}' CHECK (json_valid(confidence_json)),
  source_spans_json TEXT NOT NULL DEFAULT '[]' CHECK (json_valid(source_spans_json)),
  provenance_json TEXT NOT NULL CHECK (json_valid(provenance_json)),
  editor_note TEXT,
  en_unit_hash TEXT NOT NULL CHECK (length(en_unit_hash) = 64),
  ja_unit_hash TEXT NOT NULL CHECK (length(ja_unit_hash) = 64),
  created_at_utc TEXT NOT NULL,
  UNIQUE (revision_id, expression_id),
  UNIQUE (revision_id, display_ordinal),
  FOREIGN KEY (revision_id) REFERENCES textbook_track_revisions(id) ON DELETE RESTRICT,
  FOREIGN KEY (expression_id) REFERENCES textbook_expressions(id) ON DELETE RESTRICT
);

CREATE INDEX IF NOT EXISTS idx_textbook_expr_revisions_revision_order
  ON textbook_expression_revisions(revision_id, display_ordinal);
CREATE INDEX IF NOT EXISTS idx_textbook_expr_revisions_expression
  ON textbook_expression_revisions(expression_id, revision_id DESC);

-- ========================================
-- 表 36: textbook_card_derivations（教材派生卡去重）
-- ========================================

CREATE TABLE IF NOT EXISTS textbook_card_derivations (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  expression_id INTEGER NOT NULL,
  source_expression_revision_id INTEGER NOT NULL,
  selection_language TEXT NOT NULL CHECK (selection_language IN ('en', 'ja')),
  selection_text TEXT NOT NULL,
  selection_hash TEXT NOT NULL CHECK (length(selection_hash) = 64),
  target_card_type TEXT NOT NULL CHECK (target_card_type IN ('trilingual', 'grammar_ja')),
  target_generation_id INTEGER,
  target_job_id INTEGER,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'running', 'completed', 'failed', 'superseded')),
  derivation_revision INTEGER NOT NULL DEFAULT 1 CHECK (derivation_revision >= 1),
  request_context_json TEXT NOT NULL DEFAULT '{}' CHECK (json_valid(request_context_json)),
  created_at_utc TEXT NOT NULL,
  updated_at_utc TEXT NOT NULL,
  UNIQUE (expression_id, selection_hash, target_card_type),
  FOREIGN KEY (expression_id) REFERENCES textbook_expressions(id) ON DELETE RESTRICT,
  FOREIGN KEY (source_expression_revision_id) REFERENCES textbook_expression_revisions(id) ON DELETE RESTRICT,
  FOREIGN KEY (target_generation_id) REFERENCES generations(id) ON DELETE SET NULL,
  FOREIGN KEY (target_job_id) REFERENCES generation_jobs(id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_textbook_derivations_expression_status
  ON textbook_card_derivations(expression_id, status);
CREATE INDEX IF NOT EXISTS idx_textbook_derivations_target_generation
  ON textbook_card_derivations(target_generation_id)
  WHERE target_generation_id IS NOT NULL;

CREATE VIRTUAL TABLE IF NOT EXISTS textbook_expressions_fts USING fts5(
  official_en_text,
  official_ja_text,
  zh_cue_text,
  content=textbook_expression_revisions,
  content_rowid=id
);

CREATE TRIGGER IF NOT EXISTS textbook_expr_fts_insert AFTER INSERT ON textbook_expression_revisions BEGIN
  INSERT INTO textbook_expressions_fts(rowid, official_en_text, official_ja_text, zh_cue_text)
  VALUES (new.id, new.official_en_text, new.official_ja_text, new.zh_cue_text);
END;

CREATE TRIGGER IF NOT EXISTS textbook_expr_fts_delete AFTER DELETE ON textbook_expression_revisions BEGIN
  INSERT INTO textbook_expressions_fts(textbook_expressions_fts, rowid, official_en_text, official_ja_text, zh_cue_text)
  VALUES ('delete', old.id, old.official_en_text, old.official_ja_text, old.zh_cue_text);
END;

CREATE TRIGGER IF NOT EXISTS textbook_expr_fts_update AFTER UPDATE ON textbook_expression_revisions BEGIN
  INSERT INTO textbook_expressions_fts(textbook_expressions_fts, rowid, official_en_text, official_ja_text, zh_cue_text)
  VALUES ('delete', old.id, old.official_en_text, old.official_ja_text, old.zh_cue_text);
  INSERT INTO textbook_expressions_fts(rowid, official_en_text, official_ja_text, zh_cue_text)
  VALUES (new.id, new.official_en_text, new.official_ja_text, new.zh_cue_text);
END;

CREATE TRIGGER IF NOT EXISTS textbook_revision_delete_block
BEFORE DELETE ON textbook_track_revisions
BEGIN
  SELECT RAISE(ABORT, 'textbook track revisions are immutable');
END;

CREATE TRIGGER IF NOT EXISTS textbook_expression_revision_delete_block
BEFORE DELETE ON textbook_expression_revisions
BEGIN
  SELECT RAISE(ABORT, 'textbook expression revisions are immutable');
END;

CREATE TRIGGER IF NOT EXISTS textbook_asset_delete_block
BEFORE DELETE ON textbook_track_assets
BEGIN
  SELECT RAISE(ABORT, 'textbook track assets are immutable');
END;

CREATE TRIGGER IF NOT EXISTS textbook_track_course_owner_insert
BEFORE INSERT ON textbook_track_revisions
WHEN (SELECT COUNT(*) FROM textbook_tracks WHERE id = NEW.track_id) = 0
BEGIN
  SELECT RAISE(ABORT, 'textbook revision track does not exist');
END;

CREATE TRIGGER IF NOT EXISTS textbook_asset_revision_owner_insert
BEFORE INSERT ON textbook_track_assets
WHEN (SELECT COUNT(*) FROM textbook_track_revisions WHERE id = NEW.revision_id) = 0
BEGIN
  SELECT RAISE(ABORT, 'textbook asset revision does not exist');
END;

CREATE TRIGGER IF NOT EXISTS textbook_expression_revision_owner_insert
BEFORE INSERT ON textbook_expression_revisions
WHEN (
  SELECT track_id FROM textbook_expressions WHERE id = NEW.expression_id
) <> (
  SELECT track_id FROM textbook_track_revisions WHERE id = NEW.revision_id
)
BEGIN
  SELECT RAISE(ABORT, 'textbook expression revision crosses track boundary');
END;

-- ========================================
-- 表 37: kg_points（知识点稳定身份）
-- ========================================

CREATE TABLE IF NOT EXISTS kg_points (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  point_key TEXT NOT NULL UNIQUE CHECK (length(point_key) = 64),
  kp_kind TEXT NOT NULL CHECK (kp_kind IN ('lexeme', 'phrase', 'grammar_pattern')),
  language TEXT NOT NULL CHECK (language IN ('en', 'ja', 'zh')),
  canonical_form TEXT NOT NULL,
  canonical_reading TEXT,
  sense_discriminator TEXT NOT NULL DEFAULT '',
  identity_version TEXT NOT NULL,
  lifecycle TEXT NOT NULL DEFAULT 'active' CHECK (lifecycle IN ('active', 'retired', 'archived')),
  created_by_event_id INTEGER,
  created_at_utc TEXT NOT NULL,
  updated_at_utc TEXT NOT NULL,
  FOREIGN KEY (created_by_event_id) REFERENCES kg_resolution_events(id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_kg_points_search
  ON kg_points(language, kp_kind, lifecycle, canonical_form);

-- ========================================
-- 表 38: kg_surface_forms（表面词形）
-- ========================================

CREATE TABLE IF NOT EXISTS kg_surface_forms (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  surface_key TEXT NOT NULL UNIQUE CHECK (length(surface_key) = 64),
  language TEXT NOT NULL CHECK (language IN ('en', 'ja', 'zh')),
  surface_text TEXT NOT NULL,
  normalized_surface TEXT NOT NULL,
  normalized_reading TEXT,
  analysis_status TEXT NOT NULL CHECK (analysis_status IN ('analyzed', 'unresolved', 'unsupported')),
  analyzer_id TEXT,
  analyzer_version TEXT,
  analysis_rule_version TEXT,
  token_sequence_json TEXT NOT NULL DEFAULT '[]' CHECK (json_valid(token_sequence_json) AND json_type(token_sequence_json) = 'array'),
  analysis_input_hash TEXT CHECK (analysis_input_hash IS NULL OR length(analysis_input_hash) = 64),
  analysis_output_hash TEXT CHECK (analysis_output_hash IS NULL OR length(analysis_output_hash) = 64),
  created_at_utc TEXT NOT NULL,
  updated_at_utc TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_kg_surface_search
  ON kg_surface_forms(language, normalized_surface, analysis_status);

-- ========================================
-- 表 39: kg_evidence（内容出现证据）
-- ========================================

CREATE TABLE IF NOT EXISTS kg_evidence (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  evidence_key TEXT NOT NULL UNIQUE CHECK (length(evidence_key) = 64),
  source_kind TEXT NOT NULL CHECK (source_kind IN ('generation', 'study_item', 'textbook_expression')),
  source_ref_id INTEGER NOT NULL CHECK (source_ref_id > 0),
  source_revision INTEGER NOT NULL DEFAULT 1 CHECK (source_revision > 0),
  locator_json TEXT NOT NULL DEFAULT '{}' CHECK (json_valid(locator_json)),
  language TEXT NOT NULL CHECK (language IN ('en', 'ja', 'zh')),
  source_text TEXT NOT NULL,
  source_content_hash TEXT NOT NULL CHECK (length(source_content_hash) = 64),
  evidence_role TEXT NOT NULL CHECK (evidence_role IN ('primary', 'context')),
  lifecycle TEXT NOT NULL DEFAULT 'active' CHECK (lifecycle IN ('active', 'superseded', 'orphaned')),
  created_at_utc TEXT NOT NULL,
  updated_at_utc TEXT NOT NULL,
  UNIQUE (source_kind, source_ref_id, source_revision, evidence_key)
);

CREATE INDEX IF NOT EXISTS idx_kg_evidence_source
  ON kg_evidence(source_kind, source_ref_id, lifecycle);

-- ========================================
-- 表 40: kg_resolution_cases（待确认工作流）
-- ========================================

CREATE TABLE IF NOT EXISTS kg_resolution_cases (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  case_key TEXT NOT NULL UNIQUE CHECK (length(case_key) = 64),
  case_kind TEXT NOT NULL CHECK (case_kind IN ('ambiguous-surface', 'identity-split', 'evidence-conflict', 'unsupported-analysis', 'semantic-proposal')),
  language TEXT NOT NULL CHECK (language IN ('en', 'ja', 'zh')),
  kp_kind_hint TEXT CHECK (kp_kind_hint IS NULL OR kp_kind_hint IN ('lexeme', 'phrase', 'grammar_pattern')),
  surface_form_id INTEGER,
  evidence_id INTEGER,
  normalized_input TEXT NOT NULL,
  candidates_json TEXT NOT NULL DEFAULT '[]' CHECK (json_valid(candidates_json) AND json_type(candidates_json) = 'array'),
  status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'resolved', 'dismissed', 'superseded')),
  revision INTEGER NOT NULL DEFAULT 1 CHECK (revision >= 1),
  resolved_point_id INTEGER,
  created_at_utc TEXT NOT NULL,
  updated_at_utc TEXT NOT NULL,
  resolved_at_utc TEXT,
  CHECK ((status = 'resolved' AND resolved_point_id IS NOT NULL) OR status <> 'resolved'),
  FOREIGN KEY (surface_form_id) REFERENCES kg_surface_forms(id) ON DELETE SET NULL,
  FOREIGN KEY (evidence_id) REFERENCES kg_evidence(id) ON DELETE SET NULL,
  FOREIGN KEY (resolved_point_id) REFERENCES kg_points(id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_kg_resolution_cases_status
  ON kg_resolution_cases(status, language, case_kind);

-- ========================================
-- 表 41: kg_resolution_events（append-only 裁决事实）
-- ========================================

CREATE TABLE IF NOT EXISTS kg_resolution_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  event_key TEXT NOT NULL UNIQUE,
  request_hash TEXT NOT NULL CHECK (length(request_hash) = 64),
  case_id INTEGER,
  action TEXT NOT NULL CHECK (action IN ('case-opened', 'candidate-proposed', 'case-resolved', 'case-dismissed', 'case-reopened', 'point-created', 'point-split', 'point-merged', 'surface-attached', 'surface-detached', 'evidence-attached', 'evidence-detached', 'decision-reverted')),
  actor_kind TEXT NOT NULL CHECK (actor_kind IN ('rule', 'user', 'maintenance', 'llm-proposal')),
  provider_id TEXT,
  model_id TEXT,
  analyzer_id TEXT,
  analyzer_version TEXT,
  rule_version TEXT,
  prompt_schema_version TEXT,
  prompt_version TEXT,
  input_hash TEXT CHECK (input_hash IS NULL OR length(input_hash) = 64),
  output_hash TEXT CHECK (output_hash IS NULL OR length(output_hash) = 64),
  payload_json TEXT NOT NULL DEFAULT '{}' CHECK (json_valid(payload_json)),
  public_reason TEXT NOT NULL,
  occurred_at_utc TEXT NOT NULL,
  created_at_utc TEXT NOT NULL,
  FOREIGN KEY (case_id) REFERENCES kg_resolution_cases(id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_kg_resolution_events_case_time
  ON kg_resolution_events(case_id, occurred_at_utc DESC);

-- ========================================
-- 表 42: kg_point_transitions（身份演进事实）
-- ========================================

CREATE TABLE IF NOT EXISTS kg_point_transitions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  predecessor_point_id INTEGER NOT NULL,
  successor_point_id INTEGER NOT NULL,
  transition_kind TEXT NOT NULL CHECK (transition_kind IN ('split-into', 'merge-into', 'replacement')),
  resolution_event_id INTEGER NOT NULL,
  created_at_utc TEXT NOT NULL,
  CHECK (predecessor_point_id <> successor_point_id),
  UNIQUE (resolution_event_id, predecessor_point_id, successor_point_id, transition_kind),
  FOREIGN KEY (predecessor_point_id) REFERENCES kg_points(id) ON DELETE RESTRICT,
  FOREIGN KEY (successor_point_id) REFERENCES kg_points(id) ON DELETE RESTRICT,
  FOREIGN KEY (resolution_event_id) REFERENCES kg_resolution_events(id) ON DELETE RESTRICT
);

CREATE INDEX IF NOT EXISTS idx_kg_transitions_predecessor
  ON kg_point_transitions(predecessor_point_id, created_at_utc DESC);
CREATE INDEX IF NOT EXISTS idx_kg_transitions_successor
  ON kg_point_transitions(successor_point_id, created_at_utc DESC);

-- ========================================
-- 表 43: kg_point_surface_links（词形关系投影）
-- ========================================

CREATE TABLE IF NOT EXISTS kg_point_surface_links (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  point_id INTEGER NOT NULL,
  surface_form_id INTEGER NOT NULL,
  link_kind TEXT NOT NULL CHECK (link_kind IN ('canonical', 'inflection-of', 'polite-of')),
  lifecycle TEXT NOT NULL DEFAULT 'active' CHECK (lifecycle IN ('active', 'superseded')),
  decision_event_id INTEGER NOT NULL,
  source_kind TEXT NOT NULL CHECK (source_kind IN ('deterministic_rule', 'user', 'maintenance')),
  rule_version TEXT,
  confidence REAL NOT NULL DEFAULT 1 CHECK (confidence >= 0 AND confidence <= 1),
  public_reason TEXT NOT NULL,
  created_at_utc TEXT NOT NULL,
  updated_at_utc TEXT NOT NULL,
  FOREIGN KEY (point_id) REFERENCES kg_points(id) ON DELETE RESTRICT,
  FOREIGN KEY (surface_form_id) REFERENCES kg_surface_forms(id) ON DELETE RESTRICT,
  FOREIGN KEY (decision_event_id) REFERENCES kg_resolution_events(id) ON DELETE RESTRICT
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_kg_point_surface_active
  ON kg_point_surface_links(point_id, surface_form_id, link_kind)
  WHERE lifecycle = 'active';
CREATE UNIQUE INDEX IF NOT EXISTS idx_kg_point_canonical_active
  ON kg_point_surface_links(point_id)
  WHERE lifecycle = 'active' AND link_kind = 'canonical';
CREATE INDEX IF NOT EXISTS idx_kg_surface_links_lookup
  ON kg_point_surface_links(surface_form_id, lifecycle, link_kind);

-- ========================================
-- 表 44: kg_point_evidence_links（内容关系投影）
-- ========================================

CREATE TABLE IF NOT EXISTS kg_point_evidence_links (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  point_id INTEGER NOT NULL,
  evidence_id INTEGER NOT NULL,
  attachment_role TEXT NOT NULL CHECK (attachment_role IN ('primary', 'context')),
  strength TEXT NOT NULL CHECK (strength IN ('strong', 'weak')),
  lifecycle TEXT NOT NULL DEFAULT 'active' CHECK (lifecycle IN ('active', 'superseded')),
  decision_event_id INTEGER NOT NULL,
  extractor_version TEXT,
  public_reason TEXT NOT NULL,
  created_at_utc TEXT NOT NULL,
  updated_at_utc TEXT NOT NULL,
  FOREIGN KEY (point_id) REFERENCES kg_points(id) ON DELETE RESTRICT,
  FOREIGN KEY (evidence_id) REFERENCES kg_evidence(id) ON DELETE RESTRICT,
  FOREIGN KEY (decision_event_id) REFERENCES kg_resolution_events(id) ON DELETE RESTRICT
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_kg_point_evidence_active
  ON kg_point_evidence_links(point_id, evidence_id, attachment_role)
  WHERE lifecycle = 'active';
CREATE INDEX IF NOT EXISTS idx_kg_evidence_links_lookup
  ON kg_point_evidence_links(evidence_id, lifecycle, strength);

-- ========================================
-- 表 45: kg_lookup_events（append-only 显式检索事实）
-- ========================================

CREATE TABLE IF NOT EXISTS kg_lookup_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  event_key TEXT NOT NULL UNIQUE,
  request_hash TEXT NOT NULL CHECK (length(request_hash) = 64),
  interaction_kind TEXT NOT NULL CHECK (interaction_kind IN ('explicit_lookup', 'duplicate_generation_attempt')),
  point_id INTEGER,
  resolution_case_id INTEGER,
  surface_form_id INTEGER,
  input_text TEXT NOT NULL,
  normalized_input TEXT NOT NULL,
  language TEXT NOT NULL CHECK (language IN ('en', 'ja', 'zh')),
  kp_kind_hint TEXT CHECK (kp_kind_hint IS NULL OR kp_kind_hint IN ('lexeme', 'phrase', 'grammar_pattern')),
  source_context_json TEXT NOT NULL DEFAULT '{}' CHECK (json_valid(source_context_json)),
  occurred_at_utc TEXT NOT NULL,
  learning_day TEXT NOT NULL CHECK (length(learning_day) = 10),
  time_zone TEXT NOT NULL,
  created_at_utc TEXT NOT NULL,
  CHECK ((point_id IS NOT NULL AND resolution_case_id IS NULL) OR (point_id IS NULL AND resolution_case_id IS NOT NULL)),
  FOREIGN KEY (point_id) REFERENCES kg_points(id) ON DELETE RESTRICT,
  FOREIGN KEY (resolution_case_id) REFERENCES kg_resolution_cases(id) ON DELETE RESTRICT,
  FOREIGN KEY (surface_form_id) REFERENCES kg_surface_forms(id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_kg_lookup_point_time
  ON kg_lookup_events(point_id, occurred_at_utc DESC);
CREATE INDEX IF NOT EXISTS idx_kg_lookup_case_time
  ON kg_lookup_events(resolution_case_id, occurred_at_utc DESC);
CREATE INDEX IF NOT EXISTS idx_kg_lookup_day
  ON kg_lookup_events(learning_day, interaction_kind);

-- ========================================
-- 表 46: kg_point_stats（知识点只读聚合）
-- ========================================

CREATE TABLE IF NOT EXISTS kg_point_stats (
  point_id INTEGER PRIMARY KEY,
  study_item_count INTEGER NOT NULL DEFAULT 0 CHECK (study_item_count >= 0),
  active_study_item_count INTEGER NOT NULL DEFAULT 0 CHECK (active_study_item_count >= 0),
  due_count INTEGER NOT NULL DEFAULT 0 CHECK (due_count >= 0),
  review_event_count INTEGER NOT NULL DEFAULT 0 CHECK (review_event_count >= 0),
  last_reviewed_at_utc TEXT,
  explicit_lookup_count_7d INTEGER NOT NULL DEFAULT 0 CHECK (explicit_lookup_count_7d >= 0),
  explicit_lookup_count_30d INTEGER NOT NULL DEFAULT 0 CHECK (explicit_lookup_count_30d >= 0),
  duplicate_attempt_count_30d INTEGER NOT NULL DEFAULT 0 CHECK (duplicate_attempt_count_30d >= 0),
  last_lookup_at_utc TEXT,
  evidence_count INTEGER NOT NULL DEFAULT 0 CHECK (evidence_count >= 0),
  surface_form_count INTEGER NOT NULL DEFAULT 0 CHECK (surface_form_count >= 0),
  source_breakdown_json TEXT NOT NULL DEFAULT '{}' CHECK (json_valid(source_breakdown_json)),
  projection_version TEXT NOT NULL,
  facts_watermark_json TEXT NOT NULL DEFAULT '{}' CHECK (json_valid(facts_watermark_json)),
  computed_at_utc TEXT NOT NULL,
  FOREIGN KEY (point_id) REFERENCES kg_points(id) ON DELETE CASCADE
);

-- ========================================
-- 表 47: kg_planning_signals（同步 provider 读模型）
-- ========================================

CREATE TABLE IF NOT EXISTS kg_planning_signals (
  study_item_id INTEGER PRIMARY KEY,
  score REAL NOT NULL CHECK (score >= 0 AND score <= 30),
  point_ids_json TEXT NOT NULL DEFAULT '[]' CHECK (json_valid(point_ids_json) AND json_type(point_ids_json) = 'array'),
  groups_json TEXT NOT NULL DEFAULT '[]' CHECK (json_valid(groups_json) AND json_type(groups_json) = 'array'),
  reasons_json TEXT NOT NULL DEFAULT '[]' CHECK (json_valid(reasons_json) AND json_type(reasons_json) = 'array'),
  evidence_json TEXT NOT NULL DEFAULT '[]' CHECK (json_valid(evidence_json) AND json_type(evidence_json) = 'array'),
  signal_version TEXT NOT NULL,
  source_watermark_json TEXT NOT NULL DEFAULT '{}' CHECK (json_valid(source_watermark_json)),
  computed_at_utc TEXT NOT NULL,
  FOREIGN KEY (study_item_id) REFERENCES study_items(id) ON DELETE CASCADE
);

-- ========================================
-- 表 48: learning_manual_queue_intents（显式加入本次学习）
-- ========================================

CREATE TABLE IF NOT EXISTS learning_manual_queue_intents (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  intent_key TEXT NOT NULL UNIQUE,
  request_hash TEXT NOT NULL CHECK (length(request_hash) = 64),
  plan_id INTEGER NOT NULL,
  learning_day TEXT NOT NULL CHECK (length(learning_day) = 10),
  time_zone TEXT NOT NULL,
  queue_id INTEGER NOT NULL,
  queue_entry_id INTEGER NOT NULL,
  study_item_id INTEGER NOT NULL,
  policy_version TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'completed', 'expired', 'cancelled')),
  completion_review_event_id INTEGER,
  created_at_utc TEXT NOT NULL,
  updated_at_utc TEXT NOT NULL,
  completed_at_utc TEXT,
  expired_at_utc TEXT,
  cancelled_at_utc TEXT,
  UNIQUE (plan_id, learning_day, study_item_id),
  CHECK ((status = 'completed' AND completion_review_event_id IS NOT NULL AND completed_at_utc IS NOT NULL)
    OR status <> 'completed'),
  CHECK ((status = 'expired' AND expired_at_utc IS NOT NULL) OR status <> 'expired'),
  CHECK ((status = 'cancelled' AND cancelled_at_utc IS NOT NULL) OR status <> 'cancelled'),
  FOREIGN KEY (plan_id) REFERENCES learning_plans(id) ON DELETE RESTRICT,
  FOREIGN KEY (queue_id) REFERENCES learning_daily_queues(id) ON DELETE RESTRICT,
  FOREIGN KEY (queue_entry_id) REFERENCES learning_queue_entries(id) ON DELETE RESTRICT,
  FOREIGN KEY (study_item_id) REFERENCES study_items(id) ON DELETE RESTRICT,
  FOREIGN KEY (completion_review_event_id) REFERENCES learning_review_events(id) ON DELETE RESTRICT
);

CREATE INDEX IF NOT EXISTS idx_learning_manual_intents_day_status
  ON learning_manual_queue_intents(learning_day, status, created_at_utc);
CREATE INDEX IF NOT EXISTS idx_learning_manual_intents_item_status
  ON learning_manual_queue_intents(study_item_id, status, learning_day);

CREATE TRIGGER IF NOT EXISTS kg_resolution_events_update_block
BEFORE UPDATE ON kg_resolution_events
BEGIN
  SELECT RAISE(ABORT, 'kg resolution events are immutable');
END;

CREATE TRIGGER IF NOT EXISTS kg_resolution_events_delete_block
BEFORE DELETE ON kg_resolution_events
BEGIN
  SELECT RAISE(ABORT, 'kg resolution events are immutable');
END;

CREATE TRIGGER IF NOT EXISTS kg_point_transitions_update_block
BEFORE UPDATE ON kg_point_transitions
BEGIN
  SELECT RAISE(ABORT, 'kg point transitions are immutable');
END;

CREATE TRIGGER IF NOT EXISTS kg_point_transitions_delete_block
BEFORE DELETE ON kg_point_transitions
BEGIN
  SELECT RAISE(ABORT, 'kg point transitions are immutable');
END;

CREATE TRIGGER IF NOT EXISTS kg_lookup_events_update_block
BEFORE UPDATE ON kg_lookup_events
BEGIN
  SELECT RAISE(ABORT, 'kg lookup events are immutable');
END;

CREATE TRIGGER IF NOT EXISTS kg_lookup_events_delete_block
BEFORE DELETE ON kg_lookup_events
BEGIN
  SELECT RAISE(ABORT, 'kg lookup events are immutable');
END;

-- ========================================
-- 完成初始化
-- ========================================
