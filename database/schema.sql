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
CREATE TRIGGER IF NOT EXISTS generations_fts_insert AFTER INSERT ON generations BEGIN
  INSERT INTO generations_fts(rowid, phrase, en_translation, ja_translation, zh_translation, markdown_content)
  VALUES (new.id, new.phrase, new.en_translation, new.ja_translation, new.zh_translation, new.markdown_content);
END;

CREATE TRIGGER IF NOT EXISTS generations_fts_delete AFTER DELETE ON generations BEGIN
  INSERT INTO generations_fts(generations_fts, rowid, phrase, en_translation, ja_translation, zh_translation, markdown_content)
  VALUES ('delete', old.id, old.phrase, old.en_translation, old.ja_translation, old.zh_translation, old.markdown_content);
END;

CREATE TRIGGER IF NOT EXISTS generations_fts_update AFTER UPDATE ON generations BEGIN
  INSERT INTO generations_fts(generations_fts, rowid, phrase, en_translation, ja_translation, zh_translation, markdown_content)
  VALUES ('delete', old.id, old.phrase, old.en_translation, old.ja_translation, old.zh_translation, old.markdown_content);
  INSERT INTO generations_fts(rowid, phrase, en_translation, ja_translation, zh_translation, markdown_content)
  VALUES (new.id, new.phrase, new.en_translation, new.ja_translation, new.zh_translation, new.markdown_content);
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
  unit_kind TEXT NOT NULL CHECK (unit_kind IN ('trilingual_en', 'trilingual_ja', 'grammar_ja', 'scenario_bilingual', 'whole_card')),
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
-- 完成初始化
-- ========================================
