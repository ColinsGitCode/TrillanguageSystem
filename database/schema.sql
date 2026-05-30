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
  DELETE FROM generations_fts WHERE rowid = old.id;
END;

CREATE TRIGGER IF NOT EXISTS generations_fts_update AFTER UPDATE ON generations BEGIN
  DELETE FROM generations_fts WHERE rowid = old.id;
  INSERT INTO generations_fts(rowid, phrase, en_translation, ja_translation, zh_translation, markdown_content)
  VALUES (new.id, new.phrase, new.en_translation, new.ja_translation, new.zh_translation, new.markdown_content);
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
-- 表 19: knowledge_jobs（知识分析任务）
-- ========================================

CREATE TABLE IF NOT EXISTS knowledge_jobs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  job_type TEXT NOT NULL,                     -- summary/index/synonym_boundary/grammar_link/cluster/issues_audit
  status TEXT NOT NULL DEFAULT 'queued',      -- queued/running/success/partial/failed/cancelled
  scope_json TEXT,                            -- JSON
  batch_size INTEGER DEFAULT 50,
  total_batches INTEGER DEFAULT 0,
  done_batches INTEGER DEFAULT 0,
  error_batches INTEGER DEFAULT 0,
  result_summary_json TEXT,                   -- JSON
  error_message TEXT,
  engine_version TEXT DEFAULT 'local-v1',
  triggered_by TEXT DEFAULT 'owner',
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  started_at DATETIME,
  finished_at DATETIME
);

CREATE INDEX IF NOT EXISTS idx_kj_status_created ON knowledge_jobs(status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_kj_type_created ON knowledge_jobs(job_type, created_at DESC);

-- ========================================
-- 表 20: knowledge_outputs_raw（批次原始输出留痕）
-- ========================================

CREATE TABLE IF NOT EXISTS knowledge_outputs_raw (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  job_id INTEGER NOT NULL,
  batch_no INTEGER NOT NULL DEFAULT 1,
  input_digest TEXT,
  status TEXT NOT NULL DEFAULT 'ok',
  output_json TEXT NOT NULL,                  -- JSON
  error_message TEXT,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,

  FOREIGN KEY (job_id) REFERENCES knowledge_jobs(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_kor_job ON knowledge_outputs_raw(job_id, batch_no);

-- ========================================
-- 表 21: knowledge_terms_index（词条索引）
-- ========================================

CREATE TABLE IF NOT EXISTS knowledge_terms_index (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  generation_id INTEGER NOT NULL UNIQUE,
  phrase TEXT NOT NULL,
  card_type TEXT,
  folder_name TEXT,
  lang_profile TEXT,                          -- zh/en/ja/mixed
  en_headword TEXT,
  ja_headword TEXT,
  zh_headword TEXT,
  aliases_json TEXT,                          -- JSON array
  tags_json TEXT,                             -- JSON array
  score REAL DEFAULT 0,
  last_job_id INTEGER,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,

  FOREIGN KEY (generation_id) REFERENCES generations(id) ON DELETE CASCADE,
  FOREIGN KEY (last_job_id) REFERENCES knowledge_jobs(id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_kti_phrase ON knowledge_terms_index(phrase);
CREATE INDEX IF NOT EXISTS idx_kti_lang_profile ON knowledge_terms_index(lang_profile);
CREATE INDEX IF NOT EXISTS idx_kti_updated ON knowledge_terms_index(updated_at DESC);

-- ========================================
-- 表 22: knowledge_issues（问题审计）
-- ========================================

CREATE TABLE IF NOT EXISTS knowledge_issues (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  issue_type TEXT NOT NULL,                   -- duplicate_phrase/audio_missing/format_anomaly
  severity TEXT NOT NULL DEFAULT 'medium',    -- low/medium/high
  generation_id INTEGER,
  phrase TEXT,
  fingerprint TEXT NOT NULL,
  detail_json TEXT,                           -- JSON
  resolved INTEGER DEFAULT 0,
  last_job_id INTEGER,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,

  UNIQUE(issue_type, fingerprint),
  FOREIGN KEY (generation_id) REFERENCES generations(id) ON DELETE SET NULL,
  FOREIGN KEY (last_job_id) REFERENCES knowledge_jobs(id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_ki_type_resolved ON knowledge_issues(issue_type, resolved, updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_ki_generation ON knowledge_issues(generation_id);

-- ========================================
-- 表 22: knowledge_synonym_groups（语义边界组）
-- ========================================

CREATE TABLE IF NOT EXISTS knowledge_synonym_groups (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  group_key TEXT NOT NULL,
  tone TEXT,
  register_text TEXT,
  collocation_note TEXT,
  misuse_risk TEXT DEFAULT 'medium',
  recommendation TEXT,
  confidence REAL DEFAULT 0,
  coverage_ratio REAL DEFAULT 0,
  version_job_id INTEGER NOT NULL,
  is_active INTEGER DEFAULT 1,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,

  FOREIGN KEY (version_job_id) REFERENCES knowledge_jobs(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_ksg_active_key ON knowledge_synonym_groups(is_active, group_key);
CREATE INDEX IF NOT EXISTS idx_ksg_version ON knowledge_synonym_groups(version_job_id);

CREATE TABLE IF NOT EXISTS knowledge_synonym_members (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  group_id INTEGER NOT NULL,
  generation_id INTEGER,
  term TEXT NOT NULL,
  lang TEXT NOT NULL,                         -- en/ja/zh
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,

  FOREIGN KEY (group_id) REFERENCES knowledge_synonym_groups(id) ON DELETE CASCADE,
  FOREIGN KEY (generation_id) REFERENCES generations(id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_ksm_group ON knowledge_synonym_members(group_id);
CREATE INDEX IF NOT EXISTS idx_ksm_generation ON knowledge_synonym_members(generation_id);

-- ========================================
-- 表 23: knowledge_grammar_patterns（语法模式）
-- ========================================

CREATE TABLE IF NOT EXISTS knowledge_grammar_patterns (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  pattern TEXT NOT NULL,
  explanation_zh TEXT,
  confidence REAL DEFAULT 0,
  version_job_id INTEGER NOT NULL,
  is_active INTEGER DEFAULT 1,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,

  FOREIGN KEY (version_job_id) REFERENCES knowledge_jobs(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_kgp_active_pattern ON knowledge_grammar_patterns(is_active, pattern);
CREATE INDEX IF NOT EXISTS idx_kgp_version ON knowledge_grammar_patterns(version_job_id);

CREATE TABLE IF NOT EXISTS knowledge_grammar_refs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  pattern_id INTEGER NOT NULL,
  generation_id INTEGER NOT NULL,
  sentence_excerpt TEXT,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,

  UNIQUE(pattern_id, generation_id, sentence_excerpt),
  FOREIGN KEY (pattern_id) REFERENCES knowledge_grammar_patterns(id) ON DELETE CASCADE,
  FOREIGN KEY (generation_id) REFERENCES generations(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_kgr_pattern ON knowledge_grammar_refs(pattern_id);
CREATE INDEX IF NOT EXISTS idx_kgr_generation ON knowledge_grammar_refs(generation_id);

-- ========================================
-- 表 24: knowledge_clusters（主题聚类）
-- ========================================

CREATE TABLE IF NOT EXISTS knowledge_clusters (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  cluster_key TEXT NOT NULL,
  label TEXT NOT NULL,
  description TEXT,
  keywords_json TEXT,                         -- JSON array
  taxonomy TEXT,                              -- function (grammar) / topic (vocab)
  confidence REAL DEFAULT 0,
  version_job_id INTEGER NOT NULL,
  is_active INTEGER DEFAULT 1,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,

  FOREIGN KEY (version_job_id) REFERENCES knowledge_jobs(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_kc_active_label ON knowledge_clusters(is_active, label);
CREATE INDEX IF NOT EXISTS idx_kc_version ON knowledge_clusters(version_job_id);

CREATE TABLE IF NOT EXISTS knowledge_cluster_cards (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  cluster_id INTEGER NOT NULL,
  generation_id INTEGER NOT NULL,
  score REAL DEFAULT 0,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,

  UNIQUE(cluster_id, generation_id),
  FOREIGN KEY (cluster_id) REFERENCES knowledge_clusters(id) ON DELETE CASCADE,
  FOREIGN KEY (generation_id) REFERENCES generations(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_kcc_cluster ON knowledge_cluster_cards(cluster_id);
CREATE INDEX IF NOT EXISTS idx_kcc_generation ON knowledge_cluster_cards(generation_id);

-- ========================================
-- 表 26: card_srs / card_reviews（间隔复习）
-- ========================================

CREATE TABLE IF NOT EXISTS card_srs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  generation_id INTEGER NOT NULL UNIQUE,
  ease_factor REAL NOT NULL DEFAULT 2.5,
  interval_days INTEGER NOT NULL DEFAULT 0,
  repetitions INTEGER NOT NULL DEFAULT 0,
  lapses INTEGER NOT NULL DEFAULT 0,
  due_date TEXT,                              -- YYYY-MM-DD (UTC, vs date('now'))
  last_grade TEXT,                            -- again/hard/good/easy
  last_reviewed_at DATETIME,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,

  FOREIGN KEY (generation_id) REFERENCES generations(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_card_srs_due ON card_srs(due_date);

CREATE TABLE IF NOT EXISTS card_reviews (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  generation_id INTEGER NOT NULL,
  grade TEXT NOT NULL,
  interval_before INTEGER DEFAULT 0,
  interval_after INTEGER DEFAULT 0,
  ease_after REAL DEFAULT 0,
  reviewed_at DATETIME DEFAULT CURRENT_TIMESTAMP,

  FOREIGN KEY (generation_id) REFERENCES generations(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_card_reviews_at ON card_reviews(reviewed_at);

-- ========================================
-- 表 25: generation_jobs（服务端共享生成队列）
-- ========================================

CREATE TABLE IF NOT EXISTS generation_jobs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  job_type TEXT NOT NULL DEFAULT 'trilingual',    -- trilingual | grammar_ja
  phrase_raw TEXT,
  phrase_normalized TEXT NOT NULL,
  source_mode TEXT,
  target_folder TEXT,
  llm_provider TEXT NOT NULL DEFAULT 'gemini',
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
-- 表 26: generation_job_events（生成队列审计事件）
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
-- 完成初始化
-- ========================================
