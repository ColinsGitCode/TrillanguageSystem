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
-- 表 7: few_shot_runs（Few-shot 运行记录）
-- ========================================

CREATE TABLE IF NOT EXISTS few_shot_runs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  generation_id INTEGER NOT NULL,
  experiment_id TEXT NOT NULL,
  variant TEXT NOT NULL,              -- baseline | fewshot
  fewshot_enabled INTEGER NOT NULL,   -- 0/1
  strategy TEXT,
  example_count INTEGER,
  min_score INTEGER,
  context_window INTEGER,
  token_budget_ratio REAL,
  base_prompt_tokens INTEGER,
  fewshot_prompt_tokens INTEGER,
  total_prompt_tokens_est INTEGER,
  output_tokens INTEGER,
  output_chars INTEGER,
  quality_score REAL,
  quality_dimensions TEXT,            -- JSON
  latency_total_ms INTEGER,
  success INTEGER,                    -- 0/1
  fallback_reason TEXT,
  prompt_hash TEXT,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,

  FOREIGN KEY (generation_id) REFERENCES generations(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_fsr_experiment ON few_shot_runs(experiment_id);
CREATE INDEX IF NOT EXISTS idx_fsr_variant ON few_shot_runs(variant);
CREATE INDEX IF NOT EXISTS idx_fsr_created_at ON few_shot_runs(created_at);

-- ========================================
-- 表 8: few_shot_examples（Few-shot 示例映射）
-- ========================================

CREATE TABLE IF NOT EXISTS few_shot_examples (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  run_id INTEGER NOT NULL,
  example_generation_id INTEGER NOT NULL,
  example_quality_score REAL,
  example_prompt_hash TEXT,
  similarity_score REAL,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,

  FOREIGN KEY (run_id) REFERENCES few_shot_runs(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_fse_run_id ON few_shot_examples(run_id);

-- ========================================
-- 完成初始化
-- ========================================
