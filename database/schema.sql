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
-- 表 9: experiment_rounds（实验轮次配置与聚合）
-- ========================================

CREATE TABLE IF NOT EXISTS experiment_rounds (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  experiment_id TEXT NOT NULL,
  round_number INTEGER NOT NULL,
  round_name TEXT,
  variant TEXT,
  llm_model TEXT,
  fewshot_enabled INTEGER DEFAULT 0,
  fewshot_strategy TEXT,
  fewshot_count INTEGER DEFAULT 0,
  fewshot_min_score INTEGER,
  token_budget_ratio REAL,
  context_window INTEGER,
  sample_count INTEGER DEFAULT 0,
  success_count INTEGER DEFAULT 0,
  avg_quality_score REAL,
  avg_tokens_total REAL,
  avg_latency_ms REAL,
  teacher_avg_quality REAL,
  notes TEXT,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,

  UNIQUE(experiment_id, round_number)
);

CREATE INDEX IF NOT EXISTS idx_er_experiment ON experiment_rounds(experiment_id);
CREATE INDEX IF NOT EXISTS idx_er_created_at ON experiment_rounds(created_at);

-- ========================================
-- 表 10: teacher_references（Teacher 标准答案快照）
-- ========================================

CREATE TABLE IF NOT EXISTS teacher_references (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  experiment_id TEXT NOT NULL,
  round_number INTEGER NOT NULL,
  phrase TEXT NOT NULL,
  provider TEXT NOT NULL,
  generation_id INTEGER,
  quality_score REAL,
  output_hash TEXT,
  output_text TEXT,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,

  UNIQUE(experiment_id, round_number, phrase),
  FOREIGN KEY (generation_id) REFERENCES generations(id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_tr_experiment_round ON teacher_references(experiment_id, round_number);
CREATE INDEX IF NOT EXISTS idx_tr_phrase ON teacher_references(phrase);

-- ========================================
-- 表 11: experiment_samples（实验样本明细）
-- ========================================

CREATE TABLE IF NOT EXISTS experiment_samples (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  experiment_id TEXT NOT NULL,
  round_number INTEGER NOT NULL,
  generation_id INTEGER,
  phrase TEXT NOT NULL,
  provider TEXT NOT NULL,
  variant TEXT,
  is_teacher INTEGER DEFAULT 0,
  quality_score REAL,
  quality_dimensions TEXT,
  tokens_total INTEGER,
  latency_ms INTEGER,
  prompt_hash TEXT,
  fewshot_enabled INTEGER DEFAULT 0,
  success INTEGER DEFAULT 1,
  error_message TEXT,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,

  FOREIGN KEY (generation_id) REFERENCES generations(id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_es_experiment_round ON experiment_samples(experiment_id, round_number);
CREATE INDEX IF NOT EXISTS idx_es_phrase ON experiment_samples(phrase);
CREATE INDEX IF NOT EXISTS idx_es_provider ON experiment_samples(provider);
CREATE INDEX IF NOT EXISTS idx_es_created_at ON experiment_samples(created_at);

-- ========================================
-- 表 12: example_units（例句级审核样本池）
-- ========================================

CREATE TABLE IF NOT EXISTS example_units (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  dedupe_hash TEXT NOT NULL UNIQUE,
  lang TEXT NOT NULL,                          -- en | ja
  sentence_text TEXT NOT NULL,
  translation_text TEXT NOT NULL,
  source_phrase TEXT,
  first_generation_id INTEGER,
  last_generation_id INTEGER,
  source_count INTEGER DEFAULT 0,
  review_score_sentence REAL,
  review_score_translation REAL,
  review_score_tts REAL,
  review_score_overall REAL,
  review_votes INTEGER DEFAULT 0,
  review_comment_latest TEXT,
  eligibility TEXT DEFAULT 'pending',          -- pending | approved | rejected
  last_reviewed_at DATETIME,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,

  FOREIGN KEY (first_generation_id) REFERENCES generations(id) ON DELETE SET NULL,
  FOREIGN KEY (last_generation_id) REFERENCES generations(id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_eu_lang ON example_units(lang);
CREATE INDEX IF NOT EXISTS idx_eu_eligibility ON example_units(eligibility);
CREATE INDEX IF NOT EXISTS idx_eu_score ON example_units(review_score_overall DESC);
CREATE INDEX IF NOT EXISTS idx_eu_updated ON example_units(updated_at DESC);

-- ========================================
-- 表 13: example_unit_sources（例句来源映射）
-- ========================================

CREATE TABLE IF NOT EXISTS example_unit_sources (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  example_id INTEGER NOT NULL,
  generation_id INTEGER NOT NULL,
  phrase TEXT,
  folder_name TEXT,
  base_filename TEXT,
  source_slot TEXT,                            -- en_1 / en_2 / ja_1 / ja_2 ...
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,

  UNIQUE(example_id, generation_id, source_slot),
  FOREIGN KEY (example_id) REFERENCES example_units(id) ON DELETE CASCADE,
  FOREIGN KEY (generation_id) REFERENCES generations(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_eus_generation ON example_unit_sources(generation_id);
CREATE INDEX IF NOT EXISTS idx_eus_example ON example_unit_sources(example_id);

CREATE TRIGGER IF NOT EXISTS trg_eus_after_insert
AFTER INSERT ON example_unit_sources
BEGIN
  UPDATE example_units
  SET
    source_count = (
      SELECT COUNT(*) FROM example_unit_sources eus WHERE eus.example_id = NEW.example_id
    ),
    updated_at = CURRENT_TIMESTAMP
  WHERE id = NEW.example_id;
END;

CREATE TRIGGER IF NOT EXISTS trg_eus_after_delete
AFTER DELETE ON example_unit_sources
BEGIN
  UPDATE example_units
  SET
    source_count = (
      SELECT COUNT(*) FROM example_unit_sources eus WHERE eus.example_id = OLD.example_id
    ),
    updated_at = CURRENT_TIMESTAMP
  WHERE id = OLD.example_id;
END;

-- ========================================
-- 表 14: review_campaigns（人工评审批次）
-- ========================================

CREATE TABLE IF NOT EXISTS review_campaigns (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  status TEXT DEFAULT 'active',                -- active | finalized | canceled
  scope TEXT DEFAULT 'existing_snapshot',
  snapshot_at DATETIME,
  created_by TEXT DEFAULT 'owner',
  notes TEXT,
  total_examples INTEGER DEFAULT 0,
  reviewed_examples INTEGER DEFAULT 0,
  approved_examples INTEGER DEFAULT 0,
  rejected_examples INTEGER DEFAULT 0,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  finalized_at DATETIME
);

CREATE INDEX IF NOT EXISTS idx_rc_status ON review_campaigns(status, created_at DESC);

-- ========================================
-- 表 15: review_campaign_items（批次样本映射）
-- ========================================

CREATE TABLE IF NOT EXISTS review_campaign_items (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  campaign_id INTEGER NOT NULL,
  example_id INTEGER NOT NULL,
  status TEXT DEFAULT 'pending',               -- pending | reviewed
  reviewed_at DATETIME,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,

  UNIQUE(campaign_id, example_id),
  FOREIGN KEY (campaign_id) REFERENCES review_campaigns(id) ON DELETE CASCADE,
  FOREIGN KEY (example_id) REFERENCES example_units(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_rci_campaign ON review_campaign_items(campaign_id, status);

-- ========================================
-- 表 16: example_reviews（例句评分/评论）
-- ========================================

CREATE TABLE IF NOT EXISTS example_reviews (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  example_id INTEGER NOT NULL,
  campaign_id INTEGER,
  reviewer TEXT DEFAULT 'owner',
  score_sentence INTEGER CHECK(score_sentence BETWEEN 1 AND 5),
  score_translation INTEGER CHECK(score_translation BETWEEN 1 AND 5),
  score_tts INTEGER CHECK(score_tts BETWEEN 1 AND 5),
  decision TEXT DEFAULT 'neutral',             -- approve | reject | neutral
  comment TEXT,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,

  UNIQUE(example_id, campaign_id, reviewer),
  FOREIGN KEY (example_id) REFERENCES example_units(id) ON DELETE CASCADE,
  FOREIGN KEY (campaign_id) REFERENCES review_campaigns(id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_er_example ON example_reviews(example_id, campaign_id);
CREATE INDEX IF NOT EXISTS idx_er_campaign ON example_reviews(campaign_id, updated_at DESC);

-- ========================================
-- 完成初始化
-- ========================================
