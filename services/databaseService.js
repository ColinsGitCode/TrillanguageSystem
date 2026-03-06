/**
 * 数据库服务 - 基于SQLite的持久化存储
 *
 * 功能：
 * - 存储所有生成记录和可观测性数据
 * - 提供历史记录查询接口
 * - 支持全文搜索
 * - 生成统计报表
 */

const Database = require('better-sqlite3');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const DEFAULT_DB_PATH = process.env.DB_PATH || './data/trilingual_records.db';

function stripHtmlTags(text) {
  return String(text || '').replace(/<[^>]+>/g, '');
}

function decodeBasicHtmlEntities(text) {
  return String(text || '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'");
}

function computeHighlightMetricsFromHtml(html) {
  const input = String(html || '');
  if (!input.trim()) return { markCount: 0, highlightedChars: 0 };

  const blockMatches = input.match(/<mark\b[^>]*class=(?:"[^"]*\bstudy-highlight-red\b[^"]*"|'[^']*\bstudy-highlight-red\b[^']*')[^>]*>[\s\S]*?<\/mark>/gi) || [];
  let highlightedChars = 0;

  blockMatches.forEach((block) => {
    const inner = block
      .replace(/^<mark\b[^>]*>/i, '')
      .replace(/<\/mark>$/i, '');
    const plain = decodeBasicHtmlEntities(stripHtmlTags(inner)).replace(/\s+/g, ' ').trim();
    highlightedChars += plain.length;
  });

  return { markCount: blockMatches.length, highlightedChars };
}

function safeJsonParse(text, fallback) {
  if (text == null || text === '') return fallback;
  try {
    return JSON.parse(text);
  } catch (err) {
    return fallback;
  }
}

function normalizeSynonymLookupKey(value) {
  return String(value || '').trim().toLowerCase();
}

function sanitizeSynonymDisplayKey(value) {
  const key = String(value || '').trim();
  if (!key) return '';
  const lower = key.toLowerCase();
  if (lower === '...' || lower === 'null' || lower === 'undefined' || lower === 'n/a' || lower === 'na') {
    return '';
  }
  return key;
}

function buildSynonymDetailKey(row = {}) {
  const pairKey = sanitizeSynonymDisplayKey(row.pair_key);
  if (pairKey) return pairKey;
  const groupKey = sanitizeSynonymDisplayKey(row.group_key);
  if (groupKey) return groupKey;
  const rowId = Number(row.id || 0);
  if (rowId > 0) return `id:${rowId}`;
  return '';
}

function readTableColumns(db, tableName) {
  return db.prepare(`PRAGMA table_info(${tableName})`).all();
}

function ensureTableColumns(db, tableName, columnDefs = []) {
  if (!Array.isArray(columnDefs) || columnDefs.length === 0) return;
  const existing = new Set(
    readTableColumns(db, tableName).map((col) => String(col.name || '').toLowerCase())
  );
  columnDefs.forEach((columnDef) => {
    const parts = String(columnDef || '').trim().split(/\s+/);
    const columnName = String(parts[0] || '').trim();
    if (!columnName) return;
    if (existing.has(columnName.toLowerCase())) return;
    try {
      db.exec(`ALTER TABLE ${tableName} ADD COLUMN ${columnDef}`);
      existing.add(columnName.toLowerCase());
    } catch (err) {
      console.warn(`[Database] Column migration skipped: ${tableName}.${columnName} ->`, err.message);
    }
  });
}

class DatabaseService {
  constructor(dbPath = DEFAULT_DB_PATH) {
    // 确保data目录存在
    const dataDir = path.dirname(dbPath);
    if (!fs.existsSync(dataDir)) {
      fs.mkdirSync(dataDir, { recursive: true });
    }

    this.db = new Database(dbPath, { verbose: console.log });

    // 性能优化
    this.db.pragma('journal_mode = WAL');
    this.db.pragma('foreign_keys = ON');

    this.initializeTables();

    console.log('[Database] Initialized:', dbPath);
  }

  /**
   * 初始化数据库表
   */
  initializeTables() {
    const schemaPath = path.join(__dirname, '../database/schema.sql');

    if (!fs.existsSync(schemaPath)) {
      console.warn('[Database] Schema file not found:', schemaPath);
      return;
    }

    const schema = fs.readFileSync(schemaPath, 'utf-8');
    this.db.exec(schema);
    this.ensureSchemaMigrations();

    console.log('[Database] Tables initialized');
  }

  ensureSchemaMigrations() {
    const columns = this.db.prepare(`PRAGMA table_info(generations)`).all();
    const columnSet = new Set(columns.map((col) => String(col.name || '').toLowerCase()));
    const migrations = [];

    if (!columnSet.has('card_type')) {
      migrations.push(`ALTER TABLE generations ADD COLUMN card_type TEXT NOT NULL DEFAULT 'trilingual'`);
    }
    if (!columnSet.has('source_mode')) {
      migrations.push(`ALTER TABLE generations ADD COLUMN source_mode TEXT`);
    }

    migrations.forEach((sql) => {
      try {
        this.db.exec(sql);
      } catch (err) {
        console.warn('[Database] Migration skipped:', sql, err.message);
      }
    });

    // card_highlights: 兼容旧库（schema 17）
    this.db.exec(`
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
    `);

    // card_training_assets: TRAIN 训练包持久化（schema 18）
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS card_training_assets (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        generation_id INTEGER NOT NULL UNIQUE,
        folder_name TEXT NOT NULL,
        base_filename TEXT NOT NULL,
        card_type TEXT NOT NULL DEFAULT 'trilingual',
        status TEXT NOT NULL DEFAULT 'failed',
        source TEXT NOT NULL DEFAULT 'heuristic',
        provider_used TEXT,
        model_used TEXT,
        prompt_version TEXT,
        schema_version TEXT NOT NULL DEFAULT 'training_pack_v1',
        quality_score REAL DEFAULT 0,
        self_confidence REAL DEFAULT 0,
        coverage_score REAL DEFAULT 0,
        validation_errors_json TEXT,
        fallback_reason TEXT,
        tokens_input INTEGER DEFAULT 0,
        tokens_output INTEGER DEFAULT 0,
        tokens_total INTEGER DEFAULT 0,
        cost_total REAL DEFAULT 0,
        latency_ms INTEGER DEFAULT 0,
        payload_json TEXT,
        sidecar_file_path TEXT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (generation_id) REFERENCES generations(id) ON DELETE CASCADE
      );
      CREATE INDEX IF NOT EXISTS idx_cta_file ON card_training_assets(folder_name, base_filename);
      CREATE INDEX IF NOT EXISTS idx_cta_updated ON card_training_assets(updated_at DESC);
      CREATE INDEX IF NOT EXISTS idx_cta_status ON card_training_assets(status, updated_at DESC);
    `);

    // knowledge analysis tables: 兼容旧库（schema 18+）
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS knowledge_jobs (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        job_type TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'queued',
        scope_json TEXT,
        batch_size INTEGER DEFAULT 50,
        total_batches INTEGER DEFAULT 0,
        done_batches INTEGER DEFAULT 0,
        error_batches INTEGER DEFAULT 0,
        result_summary_json TEXT,
        error_message TEXT,
        engine_version TEXT DEFAULT 'local-v1',
        triggered_by TEXT DEFAULT 'owner',
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        started_at DATETIME,
        finished_at DATETIME
      );
      CREATE INDEX IF NOT EXISTS idx_kj_status_created ON knowledge_jobs(status, created_at DESC);
      CREATE INDEX IF NOT EXISTS idx_kj_type_created ON knowledge_jobs(job_type, created_at DESC);

      CREATE TABLE IF NOT EXISTS knowledge_outputs_raw (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        job_id INTEGER NOT NULL,
        batch_no INTEGER NOT NULL DEFAULT 1,
        input_digest TEXT,
        status TEXT NOT NULL DEFAULT 'ok',
        output_json TEXT NOT NULL,
        error_message TEXT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (job_id) REFERENCES knowledge_jobs(id) ON DELETE CASCADE
      );
      CREATE INDEX IF NOT EXISTS idx_kor_job ON knowledge_outputs_raw(job_id, batch_no);

      CREATE TABLE IF NOT EXISTS knowledge_terms_index (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        generation_id INTEGER NOT NULL UNIQUE,
        phrase TEXT NOT NULL,
        card_type TEXT,
        folder_name TEXT,
        lang_profile TEXT,
        en_headword TEXT,
        ja_headword TEXT,
        zh_headword TEXT,
        aliases_json TEXT,
        tags_json TEXT,
        score REAL DEFAULT 0,
        last_job_id INTEGER,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (generation_id) REFERENCES generations(id) ON DELETE CASCADE,
        FOREIGN KEY (last_job_id) REFERENCES knowledge_jobs(id) ON DELETE SET NULL
      );
      CREATE INDEX IF NOT EXISTS idx_kti_phrase ON knowledge_terms_index(phrase);
      CREATE INDEX IF NOT EXISTS idx_kti_lang_profile ON knowledge_terms_index(lang_profile);
      CREATE INDEX IF NOT EXISTS idx_kti_updated ON knowledge_terms_index(updated_at DESC);

      CREATE TABLE IF NOT EXISTS knowledge_issues (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        issue_type TEXT NOT NULL,
        severity TEXT NOT NULL DEFAULT 'medium',
        generation_id INTEGER,
        phrase TEXT,
        fingerprint TEXT NOT NULL,
        detail_json TEXT,
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

      CREATE TABLE IF NOT EXISTS knowledge_synonym_groups (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        group_key TEXT NOT NULL,
        pair_key TEXT,
        term_a TEXT,
        term_b TEXT,
        tone TEXT,
        register_text TEXT,
        collocation_note TEXT,
        misuse_risk TEXT DEFAULT 'medium',
        risk_level TEXT,
        recommendation TEXT,
        actionable_hint TEXT,
        confidence REAL DEFAULT 0,
        coverage_ratio REAL DEFAULT 0,
        model TEXT,
        prompt_version TEXT,
        schema_version TEXT,
        evidence_hash TEXT,
        result_json TEXT,
        context_split_json TEXT,
        misuse_risks_json TEXT,
        jp_nuance_json TEXT,
        boundary_tags_a_json TEXT,
        boundary_tags_b_json TEXT,
        parse_status TEXT DEFAULT 'ok',
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
        lang TEXT NOT NULL,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (group_id) REFERENCES knowledge_synonym_groups(id) ON DELETE CASCADE,
        FOREIGN KEY (generation_id) REFERENCES generations(id) ON DELETE SET NULL
      );
      CREATE INDEX IF NOT EXISTS idx_ksm_group ON knowledge_synonym_members(group_id);
      CREATE INDEX IF NOT EXISTS idx_ksm_generation ON knowledge_synonym_members(generation_id);

      CREATE TABLE IF NOT EXISTS knowledge_synonym_candidates (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        job_id INTEGER NOT NULL,
        pair_key TEXT NOT NULL,
        term_a TEXT NOT NULL,
        term_b TEXT NOT NULL,
        candidate_score REAL DEFAULT 0,
        evidence_hash TEXT,
        evidence_snapshot_json TEXT,
        status TEXT DEFAULT 'queued',
        llm_latency_ms INTEGER DEFAULT 0,
        llm_error TEXT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        UNIQUE(job_id, pair_key),
        FOREIGN KEY (job_id) REFERENCES knowledge_jobs(id) ON DELETE CASCADE
      );
      CREATE INDEX IF NOT EXISTS idx_ksc_job_score ON knowledge_synonym_candidates(job_id, candidate_score DESC);
      CREATE INDEX IF NOT EXISTS idx_ksc_status ON knowledge_synonym_candidates(status, updated_at DESC);

      CREATE TABLE IF NOT EXISTS knowledge_synonym_jobs_meta (
        job_id INTEGER PRIMARY KEY,
        model TEXT,
        prompt_version TEXT,
        schema_version TEXT,
        min_candidate_score REAL DEFAULT 0.62,
        max_pairs INTEGER DEFAULT 120,
        max_llm_pairs INTEGER DEFAULT 24,
        llm_enabled INTEGER DEFAULT 0,
        candidate_count INTEGER DEFAULT 0,
        success_count INTEGER DEFAULT 0,
        failed_count INTEGER DEFAULT 0,
        json_parse_rate REAL DEFAULT 0,
        avg_latency_ms REAL DEFAULT 0,
        p95_latency_ms REAL DEFAULT 0,
        options_json TEXT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (job_id) REFERENCES knowledge_jobs(id) ON DELETE CASCADE
      );
      CREATE INDEX IF NOT EXISTS idx_ksjm_updated ON knowledge_synonym_jobs_meta(updated_at DESC);

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

      CREATE TABLE IF NOT EXISTS knowledge_clusters (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        cluster_key TEXT NOT NULL,
        label TEXT NOT NULL,
        description TEXT,
        keywords_json TEXT,
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
    `);

    ensureTableColumns(this.db, 'knowledge_synonym_groups', [
      'pair_key TEXT',
      'term_a TEXT',
      'term_b TEXT',
      'risk_level TEXT',
      'actionable_hint TEXT',
      'model TEXT',
      'prompt_version TEXT',
      'schema_version TEXT',
      'evidence_hash TEXT',
      'result_json TEXT',
      'context_split_json TEXT',
      'misuse_risks_json TEXT',
      'jp_nuance_json TEXT',
      'boundary_tags_a_json TEXT',
      'boundary_tags_b_json TEXT',
      "parse_status TEXT DEFAULT 'ok'"
    ]);

    ensureTableColumns(this.db, 'knowledge_synonym_candidates', [
      'llm_latency_ms INTEGER DEFAULT 0',
      'llm_error TEXT',
      "status TEXT DEFAULT 'queued'",
      'evidence_hash TEXT',
      'evidence_snapshot_json TEXT',
      'updated_at DATETIME DEFAULT CURRENT_TIMESTAMP'
    ]);

    ensureTableColumns(this.db, 'knowledge_synonym_jobs_meta', [
      'max_llm_pairs INTEGER DEFAULT 24',
      'json_parse_rate REAL DEFAULT 0',
      'avg_latency_ms REAL DEFAULT 0',
      'p95_latency_ms REAL DEFAULT 0',
      'options_json TEXT',
      'updated_at DATETIME DEFAULT CURRENT_TIMESTAMP'
    ]);

    ensureTableColumns(this.db, 'card_training_assets', [
      "card_type TEXT NOT NULL DEFAULT 'trilingual'",
      "status TEXT NOT NULL DEFAULT 'failed'",
      "source TEXT NOT NULL DEFAULT 'heuristic'",
      'provider_used TEXT',
      'model_used TEXT',
      'prompt_version TEXT',
      "schema_version TEXT NOT NULL DEFAULT 'training_pack_v1'",
      'quality_score REAL DEFAULT 0',
      'self_confidence REAL DEFAULT 0',
      'coverage_score REAL DEFAULT 0',
      'validation_errors_json TEXT',
      'fallback_reason TEXT',
      'tokens_input INTEGER DEFAULT 0',
      'tokens_output INTEGER DEFAULT 0',
      'tokens_total INTEGER DEFAULT 0',
      'cost_total REAL DEFAULT 0',
      'latency_ms INTEGER DEFAULT 0',
      'payload_json TEXT',
      'sidecar_file_path TEXT',
      'updated_at DATETIME DEFAULT CURRENT_TIMESTAMP'
    ]);

    this.db.exec(`
      CREATE UNIQUE INDEX IF NOT EXISTS idx_ksg_pair_schema_hash ON knowledge_synonym_groups(pair_key, schema_version, evidence_hash);
      CREATE INDEX IF NOT EXISTS idx_ksg_pair_active ON knowledge_synonym_groups(pair_key, is_active, updated_at DESC);
      CREATE INDEX IF NOT EXISTS idx_ksc_job_score ON knowledge_synonym_candidates(job_id, candidate_score DESC);
      CREATE INDEX IF NOT EXISTS idx_ksc_status ON knowledge_synonym_candidates(status, updated_at DESC);
      CREATE INDEX IF NOT EXISTS idx_ksjm_updated ON knowledge_synonym_jobs_meta(updated_at DESC);
    `);
  }

  // ========== 写入操作 ==========

  /**
   * 插入生成记录（事务）
   * @param {Object} data - 包含 generation, observability, audioFiles
   * @returns {number} generationId
   */
  insertGeneration(data) {
    const transaction = this.db.transaction((genData, obsData, audioData) => {
      try {
        // 1. 插入主记录
        const genInsert = this.db.prepare(`
          INSERT INTO generations (
            phrase, phrase_language, card_type, source_mode, llm_provider, llm_model,
            folder_name, base_filename, md_file_path, html_file_path, meta_file_path,
            markdown_content, en_translation, ja_translation, zh_translation,
            generation_date, request_id
          ) VALUES (
            @phrase, @phraseLanguage, @cardType, @sourceMode, @llmProvider, @llmModel,
            @folderName, @baseFilename, @mdFilePath, @htmlFilePath, @metaFilePath,
            @markdownContent, @enTranslation, @jaTranslation, @zhTranslation,
            @generationDate, @requestId
          )
        `);

        const genResult = genInsert.run(genData);
        const generationId = genResult.lastInsertRowid;

        // 2. 插入可观测性指标
        const obsInsert = this.db.prepare(`
          INSERT INTO observability_metrics (
            generation_id, tokens_input, tokens_output, tokens_total, tokens_cached,
            cost_input, cost_output, cost_total, cost_currency,
            quota_used, quota_limit, quota_remaining, quota_reset_at, quota_percentage,
            performance_total_ms, performance_phases,
            quality_score, quality_checks, quality_dimensions, quality_warnings,
            prompt_full, prompt_parsed, llm_output, llm_finish_reason, metadata
          ) VALUES (
            @generationId, @tokensInput, @tokensOutput, @tokensTotal, @tokensCached,
            @costInput, @costOutput, @costTotal, @costCurrency,
            @quotaUsed, @quotaLimit, @quotaRemaining, @quotaResetAt, @quotaPercentage,
            @performanceTotalMs, @performancePhases,
            @qualityScore, @qualityChecks, @qualityDimensions, @qualityWarnings,
            @promptFull, @promptParsed, @llmOutput, @llmFinishReason, @metadata
          )
        `);

        obsInsert.run({ ...obsData, generationId });

        // 3. 插入音频文件记录
        if (audioData && audioData.length > 0) {
          const audioInsert = this.db.prepare(`
            INSERT INTO audio_files (
              generation_id, language, text, filename_suffix, file_path,
              tts_provider, tts_model, status
            ) VALUES (
              @generationId, @language, @text, @filenameSuffix, @filePath,
              @ttsProvider, @ttsModel, @status
            )
          `);

          for (const audio of audioData) {
            audioInsert.run({ ...audio, generationId });
          }
        }

        return generationId;
      } catch (error) {
        console.error('[Database] Insert error:', error);
        throw error;
      }
    });

    return transaction(data.generation, data.observability, data.audioFiles || []);
  }

  /**
   * 记录错误
   */
  insertError(errorData) {
    const stmt = this.db.prepare(`
      INSERT INTO generation_errors (
        phrase, llm_provider, request_id, error_type, error_message,
        error_stack, prompt, llm_response, validation_errors
      ) VALUES (
        @phrase, @llmProvider, @requestId, @errorType, @errorMessage,
        @errorStack, @prompt, @llmResponse, @validationErrors
      )
    `);

    return stmt.run(errorData);
  }

  // ========== 查询操作 ==========

  /**
   * 分页查询历史记录
   */
  queryGenerations({ page = 1, limit = 20, provider, cardType, dateFrom, dateTo, search }) {
    let sql = `
      SELECT g.*,
        (SELECT COUNT(*) FROM audio_files WHERE generation_id = g.id AND status = 'generated') as audio_count,
        om.quality_score, om.tokens_total, om.cost_total, om.performance_total_ms
      FROM generations g
      LEFT JOIN observability_metrics om ON g.id = om.generation_id
      WHERE 1=1
    `;

    const params = {};

    if (provider) {
      sql += ` AND g.llm_provider = @provider`;
      params.provider = provider;
    }

    if (cardType) {
      sql += ` AND g.card_type = @cardType`;
      params.cardType = cardType;
    }

    if (dateFrom) {
      sql += ` AND g.generation_date >= @dateFrom`;
      params.dateFrom = dateFrom;
    }

    if (dateTo) {
      sql += ` AND g.generation_date <= @dateTo`;
      params.dateTo = dateTo;
    }

    if (search) {
      sql += ` AND g.id IN (
        SELECT rowid FROM generations_fts WHERE generations_fts MATCH @search
      )`;
      params.search = search;
    }

    sql += ` ORDER BY g.created_at DESC LIMIT @limit OFFSET @offset`;
    params.limit = limit;
    params.offset = (page - 1) * limit;

    const stmt = this.db.prepare(sql);
    return stmt.all(params);
  }

  /**
   * 获取总记录数
   */
  getTotalCount({ provider, cardType, dateFrom, dateTo, search }) {
    let sql = `SELECT COUNT(*) as total FROM generations WHERE 1=1`;
    const params = {};

    if (provider) {
      sql += ` AND llm_provider = @provider`;
      params.provider = provider;
    }

    if (cardType) {
      sql += ` AND card_type = @cardType`;
      params.cardType = cardType;
    }

    if (dateFrom) {
      sql += ` AND generation_date >= @dateFrom`;
      params.dateFrom = dateFrom;
    }

    if (dateTo) {
      sql += ` AND generation_date <= @dateTo`;
      params.dateTo = dateTo;
    }

    if (search) {
      sql += ` AND id IN (
        SELECT rowid FROM generations_fts WHERE generations_fts MATCH @search
      )`;
      params.search = search;
    }

    const stmt = this.db.prepare(sql);
    return stmt.get(params).total;
  }

  /**
   * 获取单条记录详情
   */
  getGenerationById(id) {
    const generation = this.db.prepare(`
      SELECT * FROM generations WHERE id = ?
    `).get(id);

    if (!generation) return null;

    const observability = this.db.prepare(`
      SELECT * FROM observability_metrics WHERE generation_id = ?
    `).get(id);

    const audioFiles = this.db.prepare(`
      SELECT * FROM audio_files WHERE generation_id = ? ORDER BY filename_suffix
    `).all(id);

    return {
      ...generation,
      observability: observability ? {
        ...observability,
        performance_phases: JSON.parse(observability.performance_phases || '{}'),
        quality_checks: JSON.parse(observability.quality_checks || '[]'),
        quality_dimensions: JSON.parse(observability.quality_dimensions || '{}'),
        quality_warnings: JSON.parse(observability.quality_warnings || '[]'),
        prompt_parsed: JSON.parse(observability.prompt_parsed || '{}'),
        metadata: JSON.parse(observability.metadata || '{}')
      } : null,
      audioFiles
    };
  }

  /**
   * 根据文件夹与基础文件名获取记录
   */
  getGenerationByFile(folderName, baseFilename) {
    const generation = this.db.prepare(`
      SELECT * FROM generations
      WHERE folder_name = ? AND base_filename = ?
      ORDER BY id DESC
      LIMIT 1
    `).get(folderName, baseFilename);

    return generation || null;
  }

  /**
   * 获取卡片标红（按 folder/base/sourceHash）
   */
  getCardHighlightByFile(folderName, baseFilename, sourceHash) {
    if (!folderName || !baseFilename || !sourceHash) return null;
    return this.db.prepare(`
      SELECT
        id,
        generation_id AS generationId,
        folder_name AS folderName,
        base_filename AS baseFilename,
        source_hash AS sourceHash,
        version,
        html_content AS htmlContent,
        mark_count AS markCount,
        highlighted_chars AS highlightedChars,
        updated_by AS updatedBy,
        created_at AS createdAt,
        updated_at AS updatedAt
      FROM card_highlights
      WHERE folder_name = ?
        AND base_filename = ?
        AND source_hash = ?
      LIMIT 1
    `).get(folderName, baseFilename, sourceHash) || null;
  }

  /**
   * 写入卡片标红（upsert）
   */
  upsertCardHighlight(payload = {}) {
    const folderName = String(payload.folderName || '').trim();
    const baseFilename = String(payload.baseFilename || '').trim();
    const sourceHash = String(payload.sourceHash || '').trim();
    const htmlContent = String(payload.htmlContent || '');
    if (!folderName || !baseFilename || !sourceHash) {
      throw new Error('folderName/baseFilename/sourceHash are required');
    }
    if (!htmlContent.trim()) {
      throw new Error('htmlContent is required');
    }

    const generationId = payload.generationId ? Number(payload.generationId) : null;
    const version = Number(payload.version || 1);
    const updatedBy = String(payload.updatedBy || 'ui').trim() || 'ui';
    const metrics = computeHighlightMetricsFromHtml(htmlContent);

    this.db.prepare(`
      INSERT INTO card_highlights (
        generation_id,
        folder_name,
        base_filename,
        source_hash,
        version,
        html_content,
        mark_count,
        highlighted_chars,
        updated_by,
        created_at,
        updated_at
      ) VALUES (
        @generationId,
        @folderName,
        @baseFilename,
        @sourceHash,
        @version,
        @htmlContent,
        @markCount,
        @highlightedChars,
        @updatedBy,
        CURRENT_TIMESTAMP,
        CURRENT_TIMESTAMP
      )
      ON CONFLICT(folder_name, base_filename, source_hash) DO UPDATE SET
        generation_id = COALESCE(excluded.generation_id, card_highlights.generation_id),
        version = excluded.version,
        html_content = excluded.html_content,
        mark_count = excluded.mark_count,
        highlighted_chars = excluded.highlighted_chars,
        updated_by = excluded.updated_by,
        updated_at = CURRENT_TIMESTAMP
    `).run({
      generationId,
      folderName,
      baseFilename,
      sourceHash,
      version,
      htmlContent,
      markCount: metrics.markCount,
      highlightedChars: metrics.highlightedChars,
      updatedBy
    });

    return this.getCardHighlightByFile(folderName, baseFilename, sourceHash);
  }

  /**
   * 删除卡片标红（支持指定 sourceHash 或删除该卡片全部版本）
   */
  deleteCardHighlightByFile(folderName, baseFilename, sourceHash = '') {
    if (!folderName || !baseFilename) return 0;
    if (sourceHash) {
      const result = this.db.prepare(`
        DELETE FROM card_highlights
        WHERE folder_name = ?
          AND base_filename = ?
          AND source_hash = ?
      `).run(folderName, baseFilename, sourceHash);
      return result.changes || 0;
    }
    const result = this.db.prepare(`
      DELETE FROM card_highlights
      WHERE folder_name = ?
        AND base_filename = ?
    `).run(folderName, baseFilename);
    return result.changes || 0;
  }

  /**
   * 标红统计（Mission Control / 后续分析）
   */
  getHighlightStats({ dateFrom, dateTo, provider, cardType } = {}) {
    const conditions = ['1=1'];
    const params = {};

    if (dateFrom) {
      conditions.push(`COALESCE(g.generation_date, date(ch.updated_at)) >= @dateFrom`);
      params.dateFrom = dateFrom;
    }
    if (dateTo) {
      conditions.push(`COALESCE(g.generation_date, date(ch.updated_at)) <= @dateTo`);
      params.dateTo = dateTo;
    }
    if (provider) {
      conditions.push(`g.llm_provider = @provider`);
      params.provider = provider;
    }
    if (cardType) {
      conditions.push(`g.card_type = @cardType`);
      params.cardType = cardType;
    }

    const whereSql = conditions.join(' AND ');

    const overview = this.db.prepare(`
      SELECT
        COUNT(*) AS highlightedCards,
        SUM(ch.mark_count) AS totalMarks,
        AVG(ch.mark_count) AS avgMarksPerCard,
        SUM(ch.highlighted_chars) AS totalHighlightedChars,
        AVG(ch.highlighted_chars) AS avgHighlightedChars,
        MAX(ch.updated_at) AS lastUpdatedAt
      FROM card_highlights ch
      LEFT JOIN generations g ON g.id = ch.generation_id
      WHERE ${whereSql}
    `).get(params);

    const byCardType = this.db.prepare(`
      SELECT
        COALESCE(g.card_type, 'unknown') AS cardType,
        COUNT(*) AS cards,
        SUM(ch.mark_count) AS marks,
        AVG(ch.mark_count) AS avgMarks
      FROM card_highlights ch
      LEFT JOIN generations g ON g.id = ch.generation_id
      WHERE ${whereSql}
      GROUP BY COALESCE(g.card_type, 'unknown')
      ORDER BY cards DESC
    `).all(params);

    const byProvider = this.db.prepare(`
      SELECT
        COALESCE(g.llm_provider, 'unknown') AS provider,
        COUNT(*) AS cards,
        SUM(ch.mark_count) AS marks
      FROM card_highlights ch
      LEFT JOIN generations g ON g.id = ch.generation_id
      WHERE ${whereSql}
      GROUP BY COALESCE(g.llm_provider, 'unknown')
      ORDER BY cards DESC
    `).all(params);

    const trend = this.db.prepare(`
      SELECT
        date(ch.updated_at) AS day,
        COUNT(*) AS cards,
        SUM(ch.mark_count) AS marks,
        SUM(ch.highlighted_chars) AS highlightedChars
      FROM card_highlights ch
      LEFT JOIN generations g ON g.id = ch.generation_id
      WHERE ${whereSql}
      GROUP BY date(ch.updated_at)
      ORDER BY day DESC
      LIMIT 90
    `).all(params);

    return {
      overview: {
        highlightedCards: Number(overview?.highlightedCards || 0),
        totalMarks: Number(overview?.totalMarks || 0),
        avgMarksPerCard: Number((overview?.avgMarksPerCard || 0).toFixed(2)),
        totalHighlightedChars: Number(overview?.totalHighlightedChars || 0),
        avgHighlightedChars: Number((overview?.avgHighlightedChars || 0).toFixed(2)),
        lastUpdatedAt: overview?.lastUpdatedAt || null
      },
      byCardType,
      byProvider,
      trend
    };
  }

  mapTrainingAssetRow(row) {
    if (!row) return null;
    return {
      id: Number(row.id || 0),
      generationId: Number(row.generation_id || 0),
      folderName: row.folder_name || '',
      baseFilename: row.base_filename || '',
      cardType: row.card_type || 'trilingual',
      status: row.status || 'failed',
      source: row.source || 'heuristic',
      providerUsed: row.provider_used || '',
      modelUsed: row.model_used || '',
      promptVersion: row.prompt_version || '',
      schemaVersion: row.schema_version || 'training_pack_v1',
      qualityScore: Number(row.quality_score || 0),
      selfConfidence: Number(row.self_confidence || 0),
      coverageScore: Number(row.coverage_score || 0),
      validationErrors: safeJsonParse(row.validation_errors_json, []),
      fallbackReason: row.fallback_reason || null,
      tokensInput: Number(row.tokens_input || 0),
      tokensOutput: Number(row.tokens_output || 0),
      tokensTotal: Number(row.tokens_total || 0),
      costTotal: Number(row.cost_total || 0),
      latencyMs: Number(row.latency_ms || 0),
      payload: safeJsonParse(row.payload_json, null),
      sidecarFilePath: row.sidecar_file_path || '',
      createdAt: row.created_at || null,
      updatedAt: row.updated_at || null
    };
  }

  getCardTrainingAssetByGenerationId(generationId) {
    const id = Number(generationId || 0);
    if (!id) return null;
    const row = this.db.prepare(`
      SELECT *
      FROM card_training_assets
      WHERE generation_id = ?
      LIMIT 1
    `).get(id);
    return this.mapTrainingAssetRow(row);
  }

  getCardTrainingAssetByFile(folderName, baseFilename) {
    const folder = String(folderName || '').trim();
    const base = String(baseFilename || '').trim();
    if (!folder || !base) return null;
    const row = this.db.prepare(`
      SELECT *
      FROM card_training_assets
      WHERE folder_name = ?
        AND base_filename = ?
      ORDER BY updated_at DESC, id DESC
      LIMIT 1
    `).get(folder, base);
    return this.mapTrainingAssetRow(row);
  }

  getTrainingBackfillSummary(filters = {}) {
    const folderName = String(filters.folderName || '').trim();
    const cardType = String(filters.cardType || '').trim();
    const provider = String(filters.provider || '').trim().toLowerCase();

    const where = ['1=1'];
    const params = {};

    if (folderName) {
      where.push('g.folder_name = @folderName');
      params.folderName = folderName;
    }

    if (cardType) {
      where.push('g.card_type = @cardType');
      params.cardType = cardType;
    }

    if (provider) {
      where.push('g.llm_provider = @provider');
      params.provider = provider;
    }

    const row = this.db.prepare(`
      SELECT
        COUNT(*) AS total_generations,
        SUM(CASE WHEN cta.generation_id IS NOT NULL THEN 1 ELSE 0 END) AS with_training,
        SUM(CASE WHEN cta.generation_id IS NULL THEN 1 ELSE 0 END) AS missing_training,
        SUM(CASE WHEN cta.status = 'ready' THEN 1 ELSE 0 END) AS ready_count,
        SUM(CASE WHEN cta.status = 'repaired' THEN 1 ELSE 0 END) AS repaired_count,
        SUM(CASE WHEN cta.status = 'fallback' THEN 1 ELSE 0 END) AS fallback_count,
        SUM(CASE WHEN cta.status = 'failed' THEN 1 ELSE 0 END) AS failed_count
      FROM generations g
      LEFT JOIN card_training_assets cta ON cta.generation_id = g.id
      WHERE ${where.join(' AND ')}
    `).get(params) || {};

    return {
      totalGenerations: Number(row.total_generations || 0),
      withTraining: Number(row.with_training || 0),
      missingTraining: Number(row.missing_training || 0),
      readyCount: Number(row.ready_count || 0),
      repairedCount: Number(row.repaired_count || 0),
      fallbackCount: Number(row.fallback_count || 0),
      failedCount: Number(row.failed_count || 0)
    };
  }

  listTrainingBackfillCandidates(filters = {}) {
    const limit = Math.max(1, Math.min(200, Number(filters.limit || 20)));
    const force = Boolean(filters.force);
    const folderName = String(filters.folderName || '').trim();
    const cardType = String(filters.cardType || '').trim();
    const provider = String(filters.provider || '').trim().toLowerCase();

    const where = ['1=1'];
    const params = { limit };

    if (folderName) {
      where.push('g.folder_name = @folderName');
      params.folderName = folderName;
    }

    if (cardType) {
      where.push('g.card_type = @cardType');
      params.cardType = cardType;
    }

    if (provider) {
      where.push('g.llm_provider = @provider');
      params.provider = provider;
    }

    if (!force) {
      where.push('cta.generation_id IS NULL');
    }

    return this.db.prepare(`
      SELECT
        g.id,
        g.phrase,
        g.card_type,
        g.folder_name,
        g.base_filename,
        g.llm_provider,
        g.llm_model,
        g.md_file_path,
        g.created_at,
        cta.status AS training_status
      FROM generations g
      LEFT JOIN card_training_assets cta ON cta.generation_id = g.id
      WHERE ${where.join(' AND ')}
      ORDER BY g.created_at DESC, g.id DESC
      LIMIT @limit
    `).all(params).map((row) => ({
      id: Number(row.id || 0),
      phrase: row.phrase || '',
      cardType: row.card_type || 'trilingual',
      folderName: row.folder_name || '',
      baseFilename: row.base_filename || '',
      provider: row.llm_provider || '',
      model: row.llm_model || '',
      mdFilePath: row.md_file_path || '',
      createdAt: row.created_at || null,
      trainingStatus: row.training_status || null
    }));
  }

  upsertCardTrainingAsset(payload = {}) {
    const generationId = Number(payload.generationId || 0);
    if (!generationId) throw new Error('generationId is required');
    const folderName = String(payload.folderName || '').trim();
    const baseFilename = String(payload.baseFilename || '').trim();
    if (!folderName || !baseFilename) {
      throw new Error('folderName/baseFilename are required');
    }

    this.db.prepare(`
      INSERT INTO card_training_assets (
        generation_id,
        folder_name,
        base_filename,
        card_type,
        status,
        source,
        provider_used,
        model_used,
        prompt_version,
        schema_version,
        quality_score,
        self_confidence,
        coverage_score,
        validation_errors_json,
        fallback_reason,
        tokens_input,
        tokens_output,
        tokens_total,
        cost_total,
        latency_ms,
        payload_json,
        sidecar_file_path,
        created_at,
        updated_at
      ) VALUES (
        @generationId,
        @folderName,
        @baseFilename,
        @cardType,
        @status,
        @source,
        @providerUsed,
        @modelUsed,
        @promptVersion,
        @schemaVersion,
        @qualityScore,
        @selfConfidence,
        @coverageScore,
        @validationErrorsJson,
        @fallbackReason,
        @tokensInput,
        @tokensOutput,
        @tokensTotal,
        @costTotal,
        @latencyMs,
        @payloadJson,
        @sidecarFilePath,
        CURRENT_TIMESTAMP,
        CURRENT_TIMESTAMP
      )
      ON CONFLICT(generation_id) DO UPDATE SET
        folder_name = excluded.folder_name,
        base_filename = excluded.base_filename,
        card_type = excluded.card_type,
        status = excluded.status,
        source = excluded.source,
        provider_used = excluded.provider_used,
        model_used = excluded.model_used,
        prompt_version = excluded.prompt_version,
        schema_version = excluded.schema_version,
        quality_score = excluded.quality_score,
        self_confidence = excluded.self_confidence,
        coverage_score = excluded.coverage_score,
        validation_errors_json = excluded.validation_errors_json,
        fallback_reason = excluded.fallback_reason,
        tokens_input = excluded.tokens_input,
        tokens_output = excluded.tokens_output,
        tokens_total = excluded.tokens_total,
        cost_total = excluded.cost_total,
        latency_ms = excluded.latency_ms,
        payload_json = excluded.payload_json,
        sidecar_file_path = excluded.sidecar_file_path,
        updated_at = CURRENT_TIMESTAMP
    `).run({
      generationId,
      folderName,
      baseFilename,
      cardType: String(payload.cardType || 'trilingual').trim() || 'trilingual',
      status: String(payload.status || 'failed').trim() || 'failed',
      source: String(payload.source || 'heuristic').trim() || 'heuristic',
      providerUsed: String(payload.providerUsed || '').trim(),
      modelUsed: String(payload.modelUsed || '').trim(),
      promptVersion: String(payload.promptVersion || '').trim(),
      schemaVersion: String(payload.schemaVersion || 'training_pack_v1').trim() || 'training_pack_v1',
      qualityScore: Number(payload.qualityScore || 0),
      selfConfidence: Number(payload.selfConfidence || 0),
      coverageScore: Number(payload.coverageScore || 0),
      validationErrorsJson: JSON.stringify(Array.isArray(payload.validationErrors) ? payload.validationErrors : []),
      fallbackReason: payload.fallbackReason ? String(payload.fallbackReason) : null,
      tokensInput: Number(payload.tokensInput || 0),
      tokensOutput: Number(payload.tokensOutput || 0),
      tokensTotal: Number(payload.tokensTotal || 0),
      costTotal: Number(payload.costTotal || 0),
      latencyMs: Number(payload.latencyMs || 0),
      payloadJson: payload.payload ? JSON.stringify(payload.payload) : null,
      sidecarFilePath: String(payload.sidecarFilePath || '').trim()
    });

    return this.getCardTrainingAssetByGenerationId(generationId);
  }

  deleteCardTrainingAssetByFile(folderName, baseFilename) {
    const folder = String(folderName || '').trim();
    const base = String(baseFilename || '').trim();
    if (!folder || !base) return 0;
    const result = this.db.prepare(`
      DELETE FROM card_training_assets
      WHERE folder_name = ?
        AND base_filename = ?
    `).run(folder, base);
    return Number(result.changes || 0);
  }

  /**
   * Few-shot runs by experiment id
   */
  getFewShotRuns(experimentId) {
    if (!experimentId) return [];
    return this.db.prepare(`
      SELECT * FROM few_shot_runs
      WHERE experiment_id = ?
      ORDER BY created_at ASC
    `).all(experimentId);
  }

  /**
   * Few-shot examples by run ids
   */
  getFewShotExamples(runIds = []) {
    if (!runIds.length) return [];
    const placeholders = runIds.map(() => '?').join(', ');
    return this.db.prepare(`
      SELECT * FROM few_shot_examples
      WHERE run_id IN (${placeholders})
      ORDER BY id ASC
    `).all(...runIds);
  }

  /**
   * 写入或更新实验轮次配置
   */
  upsertExperimentRound(roundData) {
    const stmt = this.db.prepare(`
      INSERT INTO experiment_rounds (
        experiment_id, round_number, round_name, variant, llm_model,
        fewshot_enabled, fewshot_strategy, fewshot_count, fewshot_min_score,
        token_budget_ratio, context_window, notes
      ) VALUES (
        @experimentId, @roundNumber, @roundName, @variant, @llmModel,
        @fewshotEnabled, @fewshotStrategy, @fewshotCount, @fewshotMinScore,
        @tokenBudgetRatio, @contextWindow, @notes
      )
      ON CONFLICT(experiment_id, round_number) DO UPDATE SET
        round_name = excluded.round_name,
        variant = excluded.variant,
        llm_model = excluded.llm_model,
        fewshot_enabled = excluded.fewshot_enabled,
        fewshot_strategy = excluded.fewshot_strategy,
        fewshot_count = excluded.fewshot_count,
        fewshot_min_score = excluded.fewshot_min_score,
        token_budget_ratio = excluded.token_budget_ratio,
        context_window = excluded.context_window,
        notes = COALESCE(excluded.notes, experiment_rounds.notes),
        updated_at = CURRENT_TIMESTAMP
    `);

    stmt.run({
      experimentId: roundData.experimentId,
      roundNumber: Number(roundData.roundNumber || 0),
      roundName: roundData.roundName || null,
      variant: roundData.variant || null,
      llmModel: roundData.llmModel || null,
      fewshotEnabled: roundData.fewshotEnabled ? 1 : 0,
      fewshotStrategy: roundData.fewshotStrategy || null,
      fewshotCount: Number(roundData.fewshotCount || 0),
      fewshotMinScore: roundData.fewshotMinScore ?? null,
      tokenBudgetRatio: roundData.tokenBudgetRatio ?? null,
      contextWindow: roundData.contextWindow ?? null,
      notes: roundData.notes || null
    });
  }

  /**
   * 写入实验样本
   */
  insertExperimentSample(sample) {
    const stmt = this.db.prepare(`
      INSERT INTO experiment_samples (
        experiment_id, round_number, generation_id, phrase, provider, variant,
        is_teacher, quality_score, quality_dimensions, tokens_total, latency_ms,
        prompt_hash, fewshot_enabled, success, error_message
      ) VALUES (
        @experimentId, @roundNumber, @generationId, @phrase, @provider, @variant,
        @isTeacher, @qualityScore, @qualityDimensions, @tokensTotal, @latencyMs,
        @promptHash, @fewshotEnabled, @success, @errorMessage
      )
    `);

    const result = stmt.run({
      experimentId: sample.experimentId,
      roundNumber: Number(sample.roundNumber || 0),
      generationId: sample.generationId ?? null,
      phrase: sample.phrase || '',
      provider: sample.provider || 'local',
      variant: sample.variant || null,
      isTeacher: sample.isTeacher ? 1 : 0,
      qualityScore: sample.qualityScore ?? null,
      qualityDimensions: sample.qualityDimensions ? JSON.stringify(sample.qualityDimensions) : null,
      tokensTotal: sample.tokensTotal ?? null,
      latencyMs: sample.latencyMs ?? null,
      promptHash: sample.promptHash || null,
      fewshotEnabled: sample.fewshotEnabled ? 1 : 0,
      success: sample.success === false ? 0 : 1,
      errorMessage: sample.errorMessage || null
    });

    return result.lastInsertRowid;
  }

  /**
   * 写入或更新 Teacher 参考输出
   */
  upsertTeacherReference(ref) {
    const stmt = this.db.prepare(`
      INSERT INTO teacher_references (
        experiment_id, round_number, phrase, provider, generation_id,
        quality_score, output_hash, output_text
      ) VALUES (
        @experimentId, @roundNumber, @phrase, @provider, @generationId,
        @qualityScore, @outputHash, @outputText
      )
      ON CONFLICT(experiment_id, round_number, phrase) DO UPDATE SET
        provider = excluded.provider,
        generation_id = excluded.generation_id,
        quality_score = excluded.quality_score,
        output_hash = excluded.output_hash,
        output_text = excluded.output_text,
        updated_at = CURRENT_TIMESTAMP
    `);

    stmt.run({
      experimentId: ref.experimentId,
      roundNumber: Number(ref.roundNumber || 0),
      phrase: ref.phrase || '',
      provider: ref.provider || 'gemini',
      generationId: ref.generationId ?? null,
      qualityScore: ref.qualityScore ?? null,
      outputHash: ref.outputHash || null,
      outputText: ref.outputText || null
    });
  }

  /**
   * 重算并回写实验轮次聚合指标
   */
  recomputeExperimentRoundStats(experimentId, roundNumber) {
    const localStats = this.db.prepare(`
      SELECT
        COUNT(*) AS sampleCount,
        SUM(CASE WHEN success = 1 THEN 1 ELSE 0 END) AS successCount,
        AVG(quality_score) AS avgQuality,
        AVG(tokens_total) AS avgTokens,
        AVG(latency_ms) AS avgLatency
      FROM experiment_samples
      WHERE experiment_id = ?
        AND round_number = ?
        AND is_teacher = 0
    `).get(experimentId, roundNumber);

    const teacherStats = this.db.prepare(`
      SELECT AVG(quality_score) AS teacherAvg
      FROM teacher_references
      WHERE experiment_id = ?
        AND round_number <= ?
    `).get(experimentId, roundNumber);

    this.db.prepare(`
      UPDATE experiment_rounds
      SET
        sample_count = @sampleCount,
        success_count = @successCount,
        avg_quality_score = @avgQuality,
        avg_tokens_total = @avgTokens,
        avg_latency_ms = @avgLatency,
        teacher_avg_quality = @teacherAvg,
        updated_at = CURRENT_TIMESTAMP
      WHERE experiment_id = @experimentId
        AND round_number = @roundNumber
    `).run({
      experimentId,
      roundNumber,
      sampleCount: localStats?.sampleCount || 0,
      successCount: localStats?.successCount || 0,
      avgQuality: localStats?.avgQuality ?? null,
      avgTokens: localStats?.avgTokens ?? null,
      avgLatency: localStats?.avgLatency ?? null,
      teacherAvg: teacherStats?.teacherAvg ?? null
    });
  }

  /**
   * 获取实验轮次聚合数据（用于趋势图）
   */
  getExperimentRoundTrend(experimentId) {
    if (!experimentId) return [];
    return this.db.prepare(`
      SELECT
        round_number AS roundNumber,
        round_name AS roundName,
        variant,
        llm_model AS llmModel,
        fewshot_enabled AS fewshotEnabled,
        fewshot_strategy AS fewshotStrategy,
        fewshot_count AS fewshotCount,
        fewshot_min_score AS fewshotMinScore,
        token_budget_ratio AS tokenBudgetRatio,
        context_window AS contextWindow,
        sample_count AS sampleCount,
        success_count AS successCount,
        avg_quality_score AS avgQualityScore,
        avg_tokens_total AS avgTokensTotal,
        avg_latency_ms AS avgLatencyMs,
        teacher_avg_quality AS teacherAvgQuality,
        (teacher_avg_quality - avg_quality_score) AS teacherGap,
        created_at AS createdAt,
        updated_at AS updatedAt
      FROM experiment_rounds
      WHERE experiment_id = ?
      ORDER BY round_number ASC
    `).all(experimentId);
  }

  /**
   * 获取实验样本明细
   */
  getExperimentSamples(experimentId) {
    if (!experimentId) return [];
    const rows = this.db.prepare(`
      SELECT
        id,
        experiment_id AS experimentId,
        round_number AS roundNumber,
        generation_id AS generationId,
        phrase,
        provider,
        variant,
        is_teacher AS isTeacher,
        quality_score AS qualityScore,
        quality_dimensions AS qualityDimensions,
        tokens_total AS tokensTotal,
        latency_ms AS latencyMs,
        prompt_hash AS promptHash,
        fewshot_enabled AS fewshotEnabled,
        success,
        error_message AS errorMessage,
        created_at AS createdAt
      FROM experiment_samples
      WHERE experiment_id = ?
      ORDER BY round_number ASC, id ASC
    `).all(experimentId);

    return rows.map((row) => ({
      ...row,
      qualityDimensions: row.qualityDimensions ? JSON.parse(row.qualityDimensions) : null
    }));
  }

  /**
   * 获取 Teacher 参考输出
   */
  getTeacherReferences(experimentId) {
    if (!experimentId) return [];
    return this.db.prepare(`
      SELECT
        id,
        experiment_id AS experimentId,
        round_number AS roundNumber,
        phrase,
        provider,
        generation_id AS generationId,
        quality_score AS qualityScore,
        output_hash AS outputHash,
        output_text AS outputText,
        created_at AS createdAt,
        updated_at AS updatedAt
      FROM teacher_references
      WHERE experiment_id = ?
      ORDER BY round_number ASC, id ASC
    `).all(experimentId);
  }

  /**
   * 统计分析（增强版）
   */
  getStatistics({ provider, dateFrom, dateTo }) {
    // 基础统计
    const basicSql = `
      SELECT
        COUNT(*) as totalCount,
        AVG(om.tokens_total) as avgTokensTotal,
        AVG(om.cost_total) as avgCost,
        AVG(om.quality_score) as avgQualityScore,
        AVG(om.performance_total_ms) as avgLatencyMs,
        SUM(om.cost_total) as totalCost,
        SUM(om.tokens_total) as totalTokens
      FROM generations g
      LEFT JOIN observability_metrics om ON g.id = om.generation_id
      WHERE g.generation_date BETWEEN @dateFrom AND @dateTo
        ${provider ? 'AND g.llm_provider = @provider' : ''}
    `;
    const basicStats = this.db.prepare(basicSql).get({ dateFrom, dateTo, provider });

    // Provider 分布
    const providerSql = `
      SELECT
        g.llm_provider,
        COUNT(*) as count
      FROM generations g
      WHERE g.generation_date BETWEEN @dateFrom AND @dateTo
      GROUP BY g.llm_provider
    `;
    const providerData = this.db.prepare(providerSql).all({ dateFrom, dateTo });
    const providerDistribution = {};
    providerData.forEach(row => {
      providerDistribution[row.llm_provider] = row.count;
    });

    // 质量趋势（按天聚合）
    const qualityTrendSql = `
      SELECT
        g.generation_date as date,
        AVG(om.quality_score) as avgScore,
        COUNT(*) as count
      FROM generations g
      LEFT JOIN observability_metrics om ON g.id = om.generation_id
      WHERE g.generation_date BETWEEN @dateFrom AND @dateTo
        ${provider ? 'AND g.llm_provider = @provider' : ''}
      GROUP BY g.generation_date
      ORDER BY g.generation_date DESC
    `;
    const qualityTrendData = this.db.prepare(qualityTrendSql).all({ dateFrom, dateTo, provider });

    // Token 趋势
    const tokenTrendSql = `
      SELECT
        g.generation_date as date,
        AVG(om.tokens_total) as avgTokens,
        COUNT(*) as count
      FROM generations g
      LEFT JOIN observability_metrics om ON g.id = om.generation_id
      WHERE g.generation_date BETWEEN @dateFrom AND @dateTo
        ${provider ? 'AND g.llm_provider = @provider' : ''}
      GROUP BY g.generation_date
      ORDER BY g.generation_date DESC
    `;
    const tokenTrendData = this.db.prepare(tokenTrendSql).all({ dateFrom, dateTo, provider });

    // Latency 趋势
    const latencyTrendSql = `
      SELECT
        g.generation_date as date,
        AVG(om.performance_total_ms) as avgMs,
        COUNT(*) as count
      FROM generations g
      LEFT JOIN observability_metrics om ON g.id = om.generation_id
      WHERE g.generation_date BETWEEN @dateFrom AND @dateTo
        ${provider ? 'AND g.llm_provider = @provider' : ''}
      GROUP BY g.generation_date
      ORDER BY g.generation_date DESC
    `;
    const latencyTrendData = this.db.prepare(latencyTrendSql).all({ dateFrom, dateTo, provider });

    // 错误统计
    const errorSql = `
      SELECT
        COUNT(*) as total,
        error_type,
        COUNT(*) as count
      FROM generation_errors
      WHERE created_at BETWEEN @dateFrom AND @dateTo
      GROUP BY error_type
    `;
    const errorData = this.db.prepare(errorSql).all({ dateFrom, dateTo });
    const errorTotal = errorData.reduce((sum, row) => sum + row.count, 0);
    const errorsByType = {};
    errorData.forEach(row => {
      errorsByType[row.error_type || 'unknown'] = row.count;
    });

    const totalGenerations = (basicStats.totalCount || 0) + errorTotal;
    const errorRate = totalGenerations > 0 ? errorTotal / totalGenerations : 0;

    // 最近错误
    const recentErrorsSql = `
      SELECT phrase, error_type, error_message, created_at
      FROM generation_errors
      WHERE created_at BETWEEN @dateFrom AND @dateTo
      ORDER BY created_at DESC
      LIMIT 5
    `;
    const recentErrors = this.db.prepare(recentErrorsSql).all({ dateFrom, dateTo });

    // 配额信息（基于当月token使用）
    const now = new Date();
    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1).toISOString().split('T')[0];
    const monthEnd = new Date(now.getFullYear(), now.getMonth() + 1, 0).toISOString().split('T')[0];

    const monthTokensSql = `
      SELECT SUM(om.tokens_total) as used
      FROM generations g
      LEFT JOIN observability_metrics om ON g.id = om.generation_id
      WHERE g.generation_date BETWEEN @monthStart AND @monthEnd
    `;
    const monthTokens = this.db.prepare(monthTokensSql).get({ monthStart, monthEnd });

    const MONTHLY_TOKEN_LIMIT = 1000000; // 1M tokens per month (configurable)
    const tokenUsed = monthTokens.used || 0;
    const quota = {
      used: tokenUsed,
      limit: MONTHLY_TOKEN_LIMIT,
      percentage: (tokenUsed / MONTHLY_TOKEN_LIMIT) * 100,
      resetDate: new Date(now.getFullYear(), now.getMonth() + 1, 1).toISOString().split('T')[0],
      estimatedDaysRemaining: Math.ceil((MONTHLY_TOKEN_LIMIT - tokenUsed) / ((tokenUsed / now.getDate()) || 1))
    };

    // 分段趋势（7D/30D/90D）
    const segmentTrend = (data, days) => {
      const cutoffDate = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString().split('T')[0];
      return data.filter(row => row.date >= cutoffDate);
    };

    const avgCost = basicStats.avgCost || 0;
    const totalCost = basicStats.totalCost || 0;
    const totalTokens = basicStats.totalTokens || 0;

    return {
      totalCount: basicStats.totalCount || 0,
      avgQualityScore: Math.round((basicStats.avgQualityScore || 0) * 10) / 10,
      avgTokensTotal: Math.round(basicStats.avgTokensTotal || 0),
      avgLatencyMs: Math.round(basicStats.avgLatencyMs || 0),
      avgCost: Number(avgCost.toFixed(6)),
      totalCost: Number(totalCost.toFixed(6)),
      totalTokens: Math.round(totalTokens || 0),

      providerDistribution,

      qualityTrend: {
        '7d': segmentTrend(qualityTrendData, 7),
        '30d': segmentTrend(qualityTrendData, 30),
        '90d': segmentTrend(qualityTrendData, 90)
      },

      tokenTrend: {
        '7d': segmentTrend(tokenTrendData, 7),
        '30d': segmentTrend(tokenTrendData, 30),
        '90d': segmentTrend(tokenTrendData, 90)
      },

      latencyTrend: {
        '7d': segmentTrend(latencyTrendData, 7),
        '30d': segmentTrend(latencyTrendData, 30),
        '90d': segmentTrend(latencyTrendData, 90)
      },

      errors: {
        total: errorTotal,
        rate: errorRate,
        byType: errorsByType,
        recent: recentErrors
      },

      quota
    };
  }

  /**
   * 全文搜索
   */
  fullTextSearch(query, limit = 20) {
    const sql = `
      SELECT g.*,
        snippet(generations_fts, 4, '<mark>', '</mark>', '...', 30) as snippet
      FROM generations_fts
      JOIN generations g ON generations_fts.rowid = g.id
      WHERE generations_fts MATCH @query
      ORDER BY rank
      LIMIT @limit
    `;

    return this.db.prepare(sql).all({ query, limit });
  }

  /**
   * 获取最近的记录
   */
  getRecentGenerations(limit = 10) {
    const sql = `
      SELECT g.id, g.phrase, g.llm_provider, g.created_at,
        om.quality_score, om.tokens_total
      FROM generations g
      LEFT JOIN observability_metrics om ON g.id = om.generation_id
      ORDER BY g.created_at DESC
      LIMIT ?
    `;

    return this.db.prepare(sql).all(limit);
  }

  /**
   * 删除生成记录（级联删除关联的音频和observability记录）
   */
  deleteGeneration(id) {
    const sql = 'DELETE FROM generations WHERE id = ?';
    const result = this.db.prepare(sql).run(id);

    if (result.changes === 0) {
      throw new Error(`Generation with id ${id} not found`);
    }

    console.log(`[Database] Deleted generation id=${id} (changes=${result.changes})`);
    return result.changes;
  }

  /**
   * 评审管线统计（Dashboard 用）
   */
  getReviewStats() {
    const eligibility = this.db.prepare(`
      SELECT eligibility, COUNT(*) as count
      FROM example_units
      GROUP BY eligibility
    `).all();

    const byLang = this.db.prepare(`
      SELECT lang, eligibility, COUNT(*) as count
      FROM example_units
      GROUP BY lang, eligibility
    `).all();

    const recentActivity = this.db.prepare(`
      SELECT date(updated_at) as day, COUNT(*) as reviews
      FROM example_reviews
      WHERE updated_at >= date('now', '-30 days')
      GROUP BY day
      ORDER BY day
    `).all();

    const avgScores = this.db.prepare(`
      SELECT
        AVG(score_sentence) as avgSentence,
        AVG(score_translation) as avgTranslation,
        AVG(score_tts) as avgTts,
        COUNT(*) as totalReviews
      FROM example_reviews
    `).get();

    return { eligibility, byLang, recentActivity, avgScores };
  }

  /**
   * Few-shot 效果统计（Dashboard 用）
   */
  getFewShotStats() {
    const byVariant = this.db.prepare(`
      SELECT
        variant,
        COUNT(*) as runs,
        AVG(quality_score) as avgQuality,
        AVG(total_prompt_tokens_est) as avgTokens,
        AVG(latency_total_ms) as avgLatency
      FROM few_shot_runs
      GROUP BY variant
    `).all();

    const fallbackReasons = this.db.prepare(`
      SELECT fallback_reason, COUNT(*) as count
      FROM few_shot_runs
      WHERE fallback_reason IS NOT NULL AND fallback_reason != ''
      GROUP BY fallback_reason
      ORDER BY count DESC
    `).all();

    const injectionRate = this.db.prepare(`
      SELECT
        SUM(fewshot_enabled) as enabled,
        COUNT(*) as total
      FROM few_shot_runs
    `).get();

    const qualityTrend = this.db.prepare(`
      SELECT date(created_at) as day, variant, AVG(quality_score) as avgQuality
      FROM few_shot_runs
      WHERE created_at >= date('now', '-30 days')
      GROUP BY day, variant
      ORDER BY day
    `).all();

    return { byVariant, fallbackReasons, injectionRate, qualityTrend };
  }

  // ========== Knowledge analysis jobs ==========

  createKnowledgeJob(payload = {}) {
    const stmt = this.db.prepare(`
      INSERT INTO knowledge_jobs (
        job_type, status, scope_json, batch_size, total_batches, done_batches,
        error_batches, engine_version, triggered_by
      ) VALUES (
        @jobType, 'queued', @scopeJson, @batchSize, 0, 0, 0, @engineVersion, @triggeredBy
      )
    `);

    const result = stmt.run({
      jobType: String(payload.jobType || '').trim(),
      scopeJson: JSON.stringify(payload.scope || {}),
      batchSize: Math.max(1, Number(payload.batchSize || 50)),
      engineVersion: String(payload.engineVersion || 'local-v1'),
      triggeredBy: String(payload.triggeredBy || 'owner')
    });

    return this.getKnowledgeJobById(result.lastInsertRowid);
  }

  upsertKnowledgeSynonymJobMeta(jobId, meta = {}) {
    const normalizedJobId = Number(jobId);
    if (!normalizedJobId) return null;
    const stmt = this.db.prepare(`
      INSERT INTO knowledge_synonym_jobs_meta (
        job_id, model, prompt_version, schema_version, min_candidate_score,
        max_pairs, max_llm_pairs, llm_enabled, candidate_count, success_count,
        failed_count, json_parse_rate, avg_latency_ms, p95_latency_ms,
        options_json, updated_at
      ) VALUES (
        @jobId, @model, @promptVersion, @schemaVersion, @minCandidateScore,
        @maxPairs, @maxLlmPairs, @llmEnabled, @candidateCount, @successCount,
        @failedCount, @jsonParseRate, @avgLatencyMs, @p95LatencyMs,
        @optionsJson, CURRENT_TIMESTAMP
      )
      ON CONFLICT(job_id) DO UPDATE SET
        model = excluded.model,
        prompt_version = excluded.prompt_version,
        schema_version = excluded.schema_version,
        min_candidate_score = excluded.min_candidate_score,
        max_pairs = excluded.max_pairs,
        max_llm_pairs = excluded.max_llm_pairs,
        llm_enabled = excluded.llm_enabled,
        candidate_count = excluded.candidate_count,
        success_count = excluded.success_count,
        failed_count = excluded.failed_count,
        json_parse_rate = excluded.json_parse_rate,
        avg_latency_ms = excluded.avg_latency_ms,
        p95_latency_ms = excluded.p95_latency_ms,
        options_json = excluded.options_json,
        updated_at = CURRENT_TIMESTAMP
    `);

    stmt.run({
      jobId: normalizedJobId,
      model: meta.model ? String(meta.model) : null,
      promptVersion: meta.promptVersion ? String(meta.promptVersion) : null,
      schemaVersion: meta.schemaVersion ? String(meta.schemaVersion) : null,
      minCandidateScore: Number(meta.minCandidateScore == null ? 0.62 : meta.minCandidateScore),
      maxPairs: Math.max(1, Number(meta.maxPairs == null ? 120 : meta.maxPairs)),
      maxLlmPairs: Math.max(0, Number(meta.maxLlmPairs == null ? 24 : meta.maxLlmPairs)),
      llmEnabled: meta.llmEnabled ? 1 : 0,
      candidateCount: Math.max(0, Number(meta.candidateCount || 0)),
      successCount: Math.max(0, Number(meta.successCount || 0)),
      failedCount: Math.max(0, Number(meta.failedCount || 0)),
      jsonParseRate: Number(meta.jsonParseRate || 0),
      avgLatencyMs: Number(meta.avgLatencyMs || 0),
      p95LatencyMs: Number(meta.p95LatencyMs || 0),
      optionsJson: JSON.stringify(meta.options || {})
    });

    return this.getKnowledgeSynonymJobMeta(normalizedJobId);
  }

  getKnowledgeSynonymJobMeta(jobId) {
    const normalizedJobId = Number(jobId);
    if (!normalizedJobId) return null;
    const row = this.db.prepare(`
      SELECT *
      FROM knowledge_synonym_jobs_meta
      WHERE job_id = ?
      LIMIT 1
    `).get(normalizedJobId);
    if (!row) return null;
    return {
      jobId: row.job_id,
      model: row.model || null,
      promptVersion: row.prompt_version || null,
      schemaVersion: row.schema_version || null,
      minCandidateScore: Number(row.min_candidate_score || 0),
      maxPairs: Number(row.max_pairs || 0),
      maxLlmPairs: Number(row.max_llm_pairs || 0),
      llmEnabled: Number(row.llm_enabled || 0) === 1,
      candidateCount: Number(row.candidate_count || 0),
      successCount: Number(row.success_count || 0),
      failedCount: Number(row.failed_count || 0),
      jsonParseRate: Number(row.json_parse_rate || 0),
      avgLatencyMs: Number(row.avg_latency_ms || 0),
      p95LatencyMs: Number(row.p95_latency_ms || 0),
      options: safeJsonParse(row.options_json, {}),
      createdAt: row.created_at,
      updatedAt: row.updated_at
    };
  }

  updateKnowledgeJobStatus(jobId, patch = {}) {
    const fields = [];
    const params = { jobId };

    if (patch.status !== undefined) {
      fields.push('status = @status');
      params.status = String(patch.status);
    }
    if (patch.totalBatches !== undefined) {
      fields.push('total_batches = @totalBatches');
      params.totalBatches = Number(patch.totalBatches || 0);
    }
    if (patch.doneBatches !== undefined) {
      fields.push('done_batches = @doneBatches');
      params.doneBatches = Number(patch.doneBatches || 0);
    }
    if (patch.errorBatches !== undefined) {
      fields.push('error_batches = @errorBatches');
      params.errorBatches = Number(patch.errorBatches || 0);
    }
    if (patch.resultSummary !== undefined) {
      fields.push('result_summary_json = @resultSummaryJson');
      params.resultSummaryJson = JSON.stringify(patch.resultSummary || {});
    }
    if (patch.errorMessage !== undefined) {
      fields.push('error_message = @errorMessage');
      params.errorMessage = patch.errorMessage ? String(patch.errorMessage) : null;
    }
    if (patch.startedAt !== undefined) {
      fields.push('started_at = @startedAt');
      params.startedAt = patch.startedAt;
    }
    if (patch.finishedAt !== undefined) {
      fields.push('finished_at = @finishedAt');
      params.finishedAt = patch.finishedAt;
    }

    if (!fields.length) return this.getKnowledgeJobById(jobId);

    const sql = `UPDATE knowledge_jobs SET ${fields.join(', ')} WHERE id = @jobId`;
    this.db.prepare(sql).run(params);
    return this.getKnowledgeJobById(jobId);
  }

  getKnowledgeJobById(jobId) {
    const row = this.db.prepare(`
      SELECT *
      FROM knowledge_jobs
      WHERE id = ?
      LIMIT 1
    `).get(jobId);
    if (!row) return null;
    const synonymMeta = row.job_type === 'synonym_boundary'
      ? this.getKnowledgeSynonymJobMeta(row.id)
      : null;
    return {
      id: row.id,
      jobType: row.job_type,
      status: row.status,
      scope: safeJsonParse(row.scope_json, {}),
      batchSize: row.batch_size,
      totalBatches: row.total_batches,
      doneBatches: row.done_batches,
      errorBatches: row.error_batches,
      resultSummary: safeJsonParse(row.result_summary_json, null),
      errorMessage: row.error_message || null,
      engineVersion: row.engine_version,
      triggeredBy: row.triggered_by,
      synonymMeta,
      createdAt: row.created_at,
      startedAt: row.started_at,
      finishedAt: row.finished_at
    };
  }

  listKnowledgeJobs(limit = 20) {
    const rows = this.db.prepare(`
      SELECT *
      FROM knowledge_jobs
      ORDER BY id DESC
      LIMIT ?
    `).all(Math.max(1, Number(limit || 20)));
    return rows.map((row) => {
      const synonymMeta = row.job_type === 'synonym_boundary'
        ? this.getKnowledgeSynonymJobMeta(row.id)
        : null;
      return {
        id: row.id,
        jobType: row.job_type,
        status: row.status,
        scope: safeJsonParse(row.scope_json, {}),
        batchSize: row.batch_size,
        totalBatches: row.total_batches,
        doneBatches: row.done_batches,
        errorBatches: row.error_batches,
        resultSummary: safeJsonParse(row.result_summary_json, null),
        errorMessage: row.error_message || null,
        engineVersion: row.engine_version,
        triggeredBy: row.triggered_by,
        synonymMeta,
        createdAt: row.created_at,
        startedAt: row.started_at,
        finishedAt: row.finished_at
      };
    });
  }

  cancelKnowledgeJob(jobId) {
    const result = this.db.prepare(`
      UPDATE knowledge_jobs
      SET status = 'cancelled', finished_at = CURRENT_TIMESTAMP
      WHERE id = ?
        AND status IN ('queued', 'running')
    `).run(jobId);
    return result.changes > 0;
  }

  insertKnowledgeRawOutput(jobId, batchNo, outputData = {}) {
    const inputDigest = crypto
      .createHash('sha1')
      .update(JSON.stringify(outputData.input || {}))
      .digest('hex');

    this.db.prepare(`
      INSERT INTO knowledge_outputs_raw (
        job_id, batch_no, input_digest, status, output_json, error_message
      ) VALUES (
        @jobId, @batchNo, @inputDigest, @status, @outputJson, @errorMessage
      )
    `).run({
      jobId,
      batchNo: Number(batchNo || 1),
      inputDigest,
      status: String(outputData.status || 'ok'),
      outputJson: JSON.stringify(outputData.output || {}),
      errorMessage: outputData.errorMessage ? String(outputData.errorMessage) : null
    });
  }

  getKnowledgeSourceCards(scope = {}) {
    const conditions = ['1=1'];
    const params = {};

    if (scope.folderFrom) {
      conditions.push('g.folder_name >= @folderFrom');
      params.folderFrom = String(scope.folderFrom);
    }
    if (scope.folderTo) {
      conditions.push('g.folder_name <= @folderTo');
      params.folderTo = String(scope.folderTo);
    }
    if (Array.isArray(scope.cardTypes) && scope.cardTypes.length > 0) {
      const placeholders = scope.cardTypes.map((_, idx) => `@cardType${idx}`);
      scope.cardTypes.forEach((value, idx) => {
        params[`cardType${idx}`] = String(value);
      });
      conditions.push(`g.card_type IN (${placeholders.join(', ')})`);
    }

    const limit = Number(scope.limit || 0);
    const limitSql = Number.isFinite(limit) && limit > 0 ? `LIMIT ${Math.floor(limit)}` : '';

    const sql = `
      SELECT
        g.id, g.phrase, g.card_type, g.source_mode, g.llm_provider, g.llm_model,
        g.folder_name, g.base_filename, g.md_file_path, g.html_file_path,
        g.markdown_content, g.en_translation, g.ja_translation, g.zh_translation,
        g.created_at,
        om.quality_score, om.tokens_total, om.performance_total_ms
      FROM generations g
      LEFT JOIN observability_metrics om ON om.generation_id = g.id
      WHERE ${conditions.join(' AND ')}
      ORDER BY g.created_at DESC
      ${limitSql}
    `;

    return this.db.prepare(sql).all(params);
  }

  upsertKnowledgeTermsIndex(entries = [], jobId = null) {
    if (!Array.isArray(entries) || entries.length === 0) return 0;
    const stmt = this.db.prepare(`
      INSERT INTO knowledge_terms_index (
        generation_id, phrase, card_type, folder_name, lang_profile,
        en_headword, ja_headword, zh_headword, aliases_json, tags_json,
        score, last_job_id, updated_at
      ) VALUES (
        @generationId, @phrase, @cardType, @folderName, @langProfile,
        @enHeadword, @jaHeadword, @zhHeadword, @aliasesJson, @tagsJson,
        @score, @lastJobId, CURRENT_TIMESTAMP
      )
      ON CONFLICT(generation_id) DO UPDATE SET
        phrase = excluded.phrase,
        card_type = excluded.card_type,
        folder_name = excluded.folder_name,
        lang_profile = excluded.lang_profile,
        en_headword = excluded.en_headword,
        ja_headword = excluded.ja_headword,
        zh_headword = excluded.zh_headword,
        aliases_json = excluded.aliases_json,
        tags_json = excluded.tags_json,
        score = excluded.score,
        last_job_id = excluded.last_job_id,
        updated_at = CURRENT_TIMESTAMP
    `);
    const transaction = this.db.transaction((rows) => {
      let count = 0;
      for (const item of rows) {
        stmt.run({
          generationId: Number(item.generationId),
          phrase: String(item.phrase || ''),
          cardType: String(item.cardType || 'trilingual'),
          folderName: String(item.folderName || ''),
          langProfile: String(item.langProfile || 'mixed'),
          enHeadword: item.enHeadword || null,
          jaHeadword: item.jaHeadword || null,
          zhHeadword: item.zhHeadword || null,
          aliasesJson: JSON.stringify(item.aliases || []),
          tagsJson: JSON.stringify(item.tags || []),
          score: Number(item.score || 0),
          lastJobId: jobId ? Number(jobId) : null
        });
        count += 1;
      }
      return count;
    });
    return transaction(entries);
  }

  replaceKnowledgeIssues(issues = [], jobId = null) {
    const clearStmt = this.db.prepare(`
      DELETE FROM knowledge_issues
      WHERE last_job_id = ?
    `);
    const insertStmt = this.db.prepare(`
      INSERT INTO knowledge_issues (
        issue_type, severity, generation_id, phrase, fingerprint,
        detail_json, resolved, last_job_id, created_at, updated_at
      ) VALUES (
        @issueType, @severity, @generationId, @phrase, @fingerprint,
        @detailJson, 0, @lastJobId, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
      )
      ON CONFLICT(issue_type, fingerprint) DO UPDATE SET
        severity = excluded.severity,
        generation_id = excluded.generation_id,
        phrase = excluded.phrase,
        detail_json = excluded.detail_json,
        resolved = 0,
        last_job_id = excluded.last_job_id,
        updated_at = CURRENT_TIMESTAMP
    `);

    const transaction = this.db.transaction((rows) => {
      if (jobId) clearStmt.run(Number(jobId));
      let count = 0;
      for (const item of rows) {
        insertStmt.run({
          issueType: String(item.issueType || 'unknown'),
          severity: String(item.severity || 'medium'),
          generationId: item.generationId ? Number(item.generationId) : null,
          phrase: item.phrase || null,
          fingerprint: String(item.fingerprint || crypto.randomBytes(8).toString('hex')),
          detailJson: JSON.stringify(item.detail || {}),
          lastJobId: jobId ? Number(jobId) : null
        });
        count += 1;
      }
      return count;
    });

    return transaction(Array.isArray(issues) ? issues : []);
  }

  saveKnowledgeSynonymCandidates(jobId, candidates = []) {
    const normalizedJobId = Number(jobId);
    if (!normalizedJobId) return 0;
    const rows = Array.isArray(candidates) ? candidates : [];
    const transaction = this.db.transaction((payload) => {
      this.db.prepare(`DELETE FROM knowledge_synonym_candidates WHERE job_id = ?`).run(normalizedJobId);
      const stmt = this.db.prepare(`
        INSERT INTO knowledge_synonym_candidates (
          job_id, pair_key, term_a, term_b, candidate_score,
          evidence_hash, evidence_snapshot_json, status, llm_latency_ms, llm_error, updated_at
        ) VALUES (
          @jobId, @pairKey, @termA, @termB, @candidateScore,
          @evidenceHash, @evidenceSnapshotJson, @status, @llmLatencyMs, @llmError, CURRENT_TIMESTAMP
        )
        ON CONFLICT(job_id, pair_key) DO UPDATE SET
          term_a = excluded.term_a,
          term_b = excluded.term_b,
          candidate_score = excluded.candidate_score,
          evidence_hash = excluded.evidence_hash,
          evidence_snapshot_json = excluded.evidence_snapshot_json,
          status = excluded.status,
          llm_latency_ms = excluded.llm_latency_ms,
          llm_error = excluded.llm_error,
          updated_at = CURRENT_TIMESTAMP
      `);
      let count = 0;
      payload.forEach((item) => {
        stmt.run({
          jobId: normalizedJobId,
          pairKey: String(item.pairKey || ''),
          termA: String(item.termA || ''),
          termB: String(item.termB || ''),
          candidateScore: Number(item.candidateScore || 0),
          evidenceHash: item.evidenceHash ? String(item.evidenceHash) : null,
          evidenceSnapshotJson: JSON.stringify(item.evidenceSnapshot || {}),
          status: String(item.status || 'queued'),
          llmLatencyMs: Math.max(0, Number(item.llmLatencyMs || 0)),
          llmError: item.llmError ? String(item.llmError) : null
        });
        count += 1;
      });
      return count;
    });
    return transaction(rows);
  }

  replaceKnowledgeSynonymData(groups = [], jobId, options = {}) {
    const transaction = this.db.transaction((payload, versionJobId, extraOptions) => {
      this.db.prepare(`UPDATE knowledge_synonym_groups SET is_active = 0 WHERE is_active = 1`).run();

      const insertGroup = this.db.prepare(`
        INSERT INTO knowledge_synonym_groups (
          group_key, pair_key, term_a, term_b, tone, register_text, collocation_note,
          misuse_risk, risk_level, recommendation, actionable_hint,
          confidence, coverage_ratio, model, prompt_version, schema_version,
          evidence_hash, result_json, context_split_json, misuse_risks_json, jp_nuance_json,
          boundary_tags_a_json, boundary_tags_b_json, parse_status, version_job_id, is_active
        ) VALUES (
          @groupKey, @pairKey, @termA, @termB, @tone, @registerText, @collocationNote,
          @misuseRisk, @riskLevel, @recommendation, @actionableHint,
          @confidence, @coverageRatio, @model, @promptVersion, @schemaVersion,
          @evidenceHash, @resultJson, @contextSplitJson, @misuseRisksJson, @jpNuanceJson,
          @boundaryTagsAJson, @boundaryTagsBJson, @parseStatus, @versionJobId, 1
        )
        ON CONFLICT(pair_key, schema_version, evidence_hash) DO UPDATE SET
          group_key = excluded.group_key,
          term_a = excluded.term_a,
          term_b = excluded.term_b,
          tone = excluded.tone,
          register_text = excluded.register_text,
          collocation_note = excluded.collocation_note,
          misuse_risk = excluded.misuse_risk,
          risk_level = excluded.risk_level,
          recommendation = excluded.recommendation,
          actionable_hint = excluded.actionable_hint,
          confidence = excluded.confidence,
          coverage_ratio = excluded.coverage_ratio,
          model = excluded.model,
          prompt_version = excluded.prompt_version,
          schema_version = excluded.schema_version,
          result_json = excluded.result_json,
          context_split_json = excluded.context_split_json,
          misuse_risks_json = excluded.misuse_risks_json,
          jp_nuance_json = excluded.jp_nuance_json,
          boundary_tags_a_json = excluded.boundary_tags_a_json,
          boundary_tags_b_json = excluded.boundary_tags_b_json,
          parse_status = excluded.parse_status,
          version_job_id = excluded.version_job_id,
          is_active = 1,
          updated_at = CURRENT_TIMESTAMP
      `);
      const selectGroupId = this.db.prepare(`
        SELECT id
        FROM knowledge_synonym_groups
        WHERE pair_key = @pairKey
          AND schema_version = @schemaVersion
          AND evidence_hash = @evidenceHash
        LIMIT 1
      `);
      const insertMember = this.db.prepare(`
        INSERT INTO knowledge_synonym_members (
          group_id, generation_id, term, lang
        ) VALUES (
          @groupId, @generationId, @term, @lang
        )
      `);
      const deleteMembers = this.db.prepare(`DELETE FROM knowledge_synonym_members WHERE group_id = ?`);

      let count = 0;
      for (const group of payload) {
        const pairKey = String(
          group.pairKey
          || group.groupKey
          || `${group.termA || ''}||${group.termB || ''}`
        ).trim().toLowerCase();
        const schemaVersion = String(group.schemaVersion || extraOptions.schemaVersion || '1.0.0');
        const evidenceHash = String(
          group.evidenceHash
          || crypto.createHash('sha1').update(`${pairKey}|${schemaVersion}|${versionJobId}`).digest('hex')
        );
        const result = insertGroup.run({
          groupKey: String(group.groupKey || pairKey),
          pairKey,
          termA: group.termA ? String(group.termA) : null,
          termB: group.termB ? String(group.termB) : null,
          tone: group.boundaryMatrix?.tone || null,
          registerText: group.boundaryMatrix?.register || null,
          collocationNote: group.boundaryMatrix?.collocation || null,
          misuseRisk: group.misuseRisk || 'medium',
          riskLevel: group.riskLevel || group.misuseRisk || 'medium',
          recommendation: group.recommendation || '',
          actionableHint: group.actionableHint || null,
          confidence: Number(group.confidence || 0),
          coverageRatio: Number(group.coverageRatio || 0),
          model: group.model || extraOptions.model || null,
          promptVersion: group.promptVersion || extraOptions.promptVersion || null,
          schemaVersion,
          evidenceHash,
          resultJson: JSON.stringify(group.resultJson || group.result || {}),
          contextSplitJson: JSON.stringify(group.contextSplit || []),
          misuseRisksJson: JSON.stringify(group.misuseRisks || []),
          jpNuanceJson: JSON.stringify(group.jpNuance || {}),
          boundaryTagsAJson: JSON.stringify(group.boundaryTagsA || []),
          boundaryTagsBJson: JSON.stringify(group.boundaryTagsB || []),
          parseStatus: String(group.parseStatus || 'ok'),
          versionJobId: Number(versionJobId)
        });
        let groupId = Number(result.lastInsertRowid || 0);
        if (!groupId) {
          const row = selectGroupId.get({ pairKey, schemaVersion, evidenceHash });
          groupId = row ? Number(row.id) : 0;
        }
        if (!groupId) continue;
        deleteMembers.run(groupId);
        const members = Array.isArray(group.members) ? group.members : [];
        for (const member of members) {
          insertMember.run({
            groupId,
            generationId: member.generationId ? Number(member.generationId) : null,
            term: String(member.term || ''),
            lang: String(member.lang || 'zh')
          });
        }
        count += 1;
      }
      return count;
    });

    return transaction(Array.isArray(groups) ? groups : [], Number(jobId), options || {});
  }

  replaceKnowledgeGrammarData(patterns = [], jobId) {
    const transaction = this.db.transaction((payload, versionJobId) => {
      this.db.prepare(`UPDATE knowledge_grammar_patterns SET is_active = 0 WHERE is_active = 1`).run();
      this.db.prepare(`DELETE FROM knowledge_grammar_refs WHERE pattern_id IN (SELECT id FROM knowledge_grammar_patterns WHERE version_job_id = ?)`).run(versionJobId);
      this.db.prepare(`DELETE FROM knowledge_grammar_patterns WHERE version_job_id = ?`).run(versionJobId);

      const insertPattern = this.db.prepare(`
        INSERT INTO knowledge_grammar_patterns (
          pattern, explanation_zh, confidence, version_job_id, is_active
        ) VALUES (
          @pattern, @explanationZh, @confidence, @versionJobId, 1
        )
      `);
      const insertRef = this.db.prepare(`
        INSERT OR IGNORE INTO knowledge_grammar_refs (
          pattern_id, generation_id, sentence_excerpt
        ) VALUES (
          @patternId, @generationId, @sentenceExcerpt
        )
      `);

      let count = 0;
      for (const pattern of payload) {
        const result = insertPattern.run({
          pattern: String(pattern.pattern || ''),
          explanationZh: String(pattern.explanationZh || ''),
          confidence: Number(pattern.confidence || 0),
          versionJobId: Number(versionJobId)
        });
        const patternId = Number(result.lastInsertRowid);
        const refs = Array.isArray(pattern.exampleRefs) ? pattern.exampleRefs : [];
        refs.forEach((ref) => {
          if (!ref.generationId) return;
          insertRef.run({
            patternId,
            generationId: Number(ref.generationId),
            sentenceExcerpt: String(ref.sentence || '')
          });
        });
        count += 1;
      }
      return count;
    });

    return transaction(Array.isArray(patterns) ? patterns : [], Number(jobId));
  }

  replaceKnowledgeClusterData(clusters = [], jobId) {
    const transaction = this.db.transaction((payload, versionJobId) => {
      this.db.prepare(`UPDATE knowledge_clusters SET is_active = 0 WHERE is_active = 1`).run();
      this.db.prepare(`DELETE FROM knowledge_cluster_cards WHERE cluster_id IN (SELECT id FROM knowledge_clusters WHERE version_job_id = ?)`).run(versionJobId);
      this.db.prepare(`DELETE FROM knowledge_clusters WHERE version_job_id = ?`).run(versionJobId);

      const insertCluster = this.db.prepare(`
        INSERT INTO knowledge_clusters (
          cluster_key, label, description, keywords_json, confidence, version_job_id, is_active
        ) VALUES (
          @clusterKey, @label, @description, @keywordsJson, @confidence, @versionJobId, 1
        )
      `);
      const insertCard = this.db.prepare(`
        INSERT OR IGNORE INTO knowledge_cluster_cards (
          cluster_id, generation_id, score
        ) VALUES (
          @clusterId, @generationId, @score
        )
      `);

      let count = 0;
      for (const cluster of payload) {
        const result = insertCluster.run({
          clusterKey: String(cluster.clusterKey || ''),
          label: String(cluster.label || 'Unknown'),
          description: String(cluster.description || ''),
          keywordsJson: JSON.stringify(cluster.keywords || []),
          confidence: Number(cluster.confidence || 0),
          versionJobId: Number(versionJobId)
        });
        const clusterId = Number(result.lastInsertRowid);
        const cards = Array.isArray(cluster.cards) ? cluster.cards : [];
        cards.forEach((card) => {
          if (!card.generationId) return;
          insertCard.run({
            clusterId,
            generationId: Number(card.generationId),
            score: Number(card.score || 0)
          });
        });
        count += 1;
      }
      return count;
    });

    return transaction(Array.isArray(clusters) ? clusters : [], Number(jobId));
  }

  getKnowledgeOverview({ limit = 8 } = {}) {
    const normalizedLimit = Math.max(1, Number(limit || 8));
    const counts = this.db.prepare(`
      SELECT
        (SELECT COUNT(*) FROM knowledge_terms_index) AS term_count,
        (SELECT COUNT(*) FROM knowledge_grammar_patterns WHERE is_active = 1) AS grammar_pattern_count,
        (SELECT COUNT(*) FROM knowledge_clusters WHERE is_active = 1) AS cluster_count,
        (SELECT COUNT(*) FROM knowledge_issues WHERE resolved = 0) AS open_issue_count,
        (SELECT COUNT(*) FROM knowledge_jobs WHERE status = 'running') AS running_jobs,
        (SELECT COUNT(*) FROM knowledge_jobs WHERE status = 'queued') AS queued_jobs
    `).get() || {};

    const topTerms = this.db.prepare(`
      SELECT generation_id, phrase, card_type, score, folder_name
      FROM knowledge_terms_index
      ORDER BY score DESC, updated_at DESC
      LIMIT ?
    `).all(normalizedLimit).map((row) => ({
      generationId: row.generation_id,
      phrase: row.phrase || '',
      cardType: row.card_type || 'trilingual',
      score: Number(row.score || 0),
      folderName: row.folder_name || ''
    }));

    const topPatterns = this.db.prepare(`
      SELECT pattern, confidence
      FROM knowledge_grammar_patterns
      WHERE is_active = 1
      ORDER BY confidence DESC, updated_at DESC
      LIMIT ?
    `).all(normalizedLimit).map((row) => ({
      pattern: row.pattern || '',
      confidence: Number(row.confidence || 0)
    }));

    const topClusters = this.db.prepare(`
      SELECT c.cluster_key, c.label, c.confidence, COUNT(cc.generation_id) AS card_count
      FROM knowledge_clusters c
      LEFT JOIN knowledge_cluster_cards cc ON cc.cluster_id = c.id
      WHERE c.is_active = 1
      GROUP BY c.id
      ORDER BY c.confidence DESC, card_count DESC
      LIMIT ?
    `).all(normalizedLimit).map((row) => ({
      clusterKey: row.cluster_key || '',
      label: row.label || '',
      confidence: Number(row.confidence || 0),
      cardCount: Number(row.card_count || 0)
    }));

    const topIssues = this.db.prepare(`
      SELECT issue_type, severity, COUNT(*) AS issue_count
      FROM knowledge_issues
      WHERE resolved = 0
      GROUP BY issue_type, severity
      ORDER BY issue_count DESC, severity DESC
      LIMIT ?
    `).all(normalizedLimit).map((row) => ({
      issueType: row.issue_type || '',
      severity: row.severity || 'medium',
      count: Number(row.issue_count || 0)
    }));

    return {
      counts: {
        termCount: Number(counts.term_count || 0),
        grammarPatternCount: Number(counts.grammar_pattern_count || 0),
        clusterCount: Number(counts.cluster_count || 0),
        openIssueCount: Number(counts.open_issue_count || 0),
        runningJobs: Number(counts.running_jobs || 0),
        queuedJobs: Number(counts.queued_jobs || 0)
      },
      topTerms,
      topPatterns,
      topClusters,
      topIssues
    };
  }

  _aggregateKnowledgeByGenerationIds(generationIds = [], limit = 12) {
    const ids = Array.from(new Set((Array.isArray(generationIds) ? generationIds : [])
      .map((id) => Number(id))
      .filter((id) => Number.isFinite(id) && id > 0)));
    if (!ids.length) {
      return { patterns: [], clusters: [], issues: [] };
    }

    const placeholders = ids.map(() => '?').join(',');
    const normalizedLimit = Math.max(1, Number(limit || 12));

    const patterns = this.db.prepare(`
      SELECT p.pattern, MAX(p.confidence) AS confidence, COUNT(DISTINCT r.generation_id) AS card_count
      FROM knowledge_grammar_refs r
      JOIN knowledge_grammar_patterns p ON p.id = r.pattern_id
      WHERE p.is_active = 1
        AND r.generation_id IN (${placeholders})
      GROUP BY p.pattern
      ORDER BY card_count DESC, confidence DESC
      LIMIT ?
    `).all(...ids, normalizedLimit).map((row) => ({
      pattern: row.pattern || '',
      confidence: Number(row.confidence || 0),
      cardCount: Number(row.card_count || 0)
    }));

    const clusters = this.db.prepare(`
      SELECT c.cluster_key, c.label, MAX(c.confidence) AS confidence, COUNT(DISTINCT cc.generation_id) AS card_count
      FROM knowledge_cluster_cards cc
      JOIN knowledge_clusters c ON c.id = cc.cluster_id
      WHERE c.is_active = 1
        AND cc.generation_id IN (${placeholders})
      GROUP BY c.cluster_key, c.label
      ORDER BY card_count DESC, confidence DESC
      LIMIT ?
    `).all(...ids, normalizedLimit).map((row) => ({
      clusterKey: row.cluster_key || '',
      label: row.label || '',
      confidence: Number(row.confidence || 0),
      cardCount: Number(row.card_count || 0)
    }));

    const issues = this.db.prepare(`
      SELECT issue_type, severity, COUNT(*) AS issue_count
      FROM knowledge_issues
      WHERE generation_id IN (${placeholders})
      GROUP BY issue_type, severity
      ORDER BY issue_count DESC, severity DESC
      LIMIT ?
    `).all(...ids, normalizedLimit).map((row) => ({
      issueType: row.issue_type || '',
      severity: row.severity || 'medium',
      count: Number(row.issue_count || 0)
    }));

    return { patterns, clusters, issues };
  }

  getKnowledgeCardRelations(generationId, { limit = 12 } = {}) {
    const id = Number(generationId);
    if (!id) return null;
    const normalizedLimit = Math.max(1, Number(limit || 12));

    const card = this.db.prepare(`
      SELECT id, phrase, card_type, folder_name, base_filename, llm_provider, llm_model, created_at
      FROM generations
      WHERE id = ?
      LIMIT 1
    `).get(id);
    if (!card) return null;

    const termRow = this.db.prepare(`
      SELECT *
      FROM knowledge_terms_index
      WHERE generation_id = ?
      LIMIT 1
    `).get(id);

    const grammarHits = this.db.prepare(`
      SELECT p.pattern, p.explanation_zh, p.confidence, r.sentence_excerpt
      FROM knowledge_grammar_refs r
      JOIN knowledge_grammar_patterns p ON p.id = r.pattern_id
      WHERE r.generation_id = ?
        AND p.is_active = 1
      ORDER BY p.confidence DESC, r.id ASC
      LIMIT ?
    `).all(id, normalizedLimit).map((row) => ({
      pattern: row.pattern || '',
      explanationZh: row.explanation_zh || '',
      confidence: Number(row.confidence || 0),
      sentence: row.sentence_excerpt || ''
    }));

    const clusters = this.db.prepare(`
      SELECT c.cluster_key, c.label, c.description, c.confidence, cc.score
      FROM knowledge_cluster_cards cc
      JOIN knowledge_clusters c ON c.id = cc.cluster_id
      WHERE cc.generation_id = ?
        AND c.is_active = 1
      ORDER BY cc.score DESC, c.confidence DESC
      LIMIT ?
    `).all(id, normalizedLimit).map((row) => ({
      clusterKey: row.cluster_key || '',
      label: row.label || '',
      description: row.description || '',
      confidence: Number(row.confidence || 0),
      score: Number(row.score || 0)
    }));

    const issues = this.db.prepare(`
      SELECT issue_type, severity, detail_json, resolved, updated_at
      FROM knowledge_issues
      WHERE generation_id = ?
      ORDER BY
        CASE severity WHEN 'high' THEN 0 WHEN 'medium' THEN 1 ELSE 2 END,
        updated_at DESC
      LIMIT ?
    `).all(id, normalizedLimit).map((row) => ({
      issueType: row.issue_type || '',
      severity: row.severity || 'medium',
      detail: safeJsonParse(row.detail_json, {}),
      resolved: Boolean(row.resolved),
      updatedAt: row.updated_at
    }));

    const examples = this.db.prepare(`
      SELECT
        eu.id AS example_id,
        eu.lang,
        eu.sentence_text,
        eu.translation_text,
        eu.eligibility,
        eu.review_score_overall,
        eu.review_votes,
        eus.source_slot
      FROM example_unit_sources eus
      JOIN example_units eu ON eu.id = eus.example_id
      WHERE eus.generation_id = ?
      ORDER BY eus.source_slot ASC
      LIMIT ?
    `).all(id, normalizedLimit).map((row) => ({
      exampleId: Number(row.example_id || 0),
      lang: row.lang || '',
      sourceSlot: row.source_slot || '',
      sentence: row.sentence_text || '',
      translation: row.translation_text || '',
      eligibility: row.eligibility || 'pending',
      reviewScoreOverall: row.review_score_overall == null ? null : Number(row.review_score_overall),
      reviewVotes: Number(row.review_votes || 0)
    }));

    const synonymRows = this.db.prepare(`
      SELECT
        g.id AS group_id,
        g.group_key,
        g.misuse_risk,
        g.recommendation,
        g.confidence,
        g.coverage_ratio,
        m.term,
        m.lang
      FROM knowledge_synonym_members m
      JOIN knowledge_synonym_groups g ON g.id = m.group_id
      WHERE m.generation_id = ?
        AND g.is_active = 1
      ORDER BY g.confidence DESC, m.id ASC
    `).all(id);
    const synonymMap = new Map();
    synonymRows.forEach((row) => {
      const key = Number(row.group_id);
      if (!synonymMap.has(key)) {
        synonymMap.set(key, {
          id: key,
          groupKey: row.group_key || '',
          misuseRisk: row.misuse_risk || 'medium',
          recommendation: row.recommendation || '',
          confidence: Number(row.confidence || 0),
          coverageRatio: Number(row.coverage_ratio || 0),
          members: []
        });
      }
      synonymMap.get(key).members.push({
        term: row.term || '',
        lang: row.lang || ''
      });
    });

    const relatedMap = new Map();
    const clusterRelated = this.db.prepare(`
      SELECT DISTINCT g.id AS generation_id, g.phrase, g.folder_name, g.base_filename, g.card_type, cc2.score
      FROM knowledge_cluster_cards cc1
      JOIN knowledge_cluster_cards cc2
        ON cc1.cluster_id = cc2.cluster_id
       AND cc2.generation_id != cc1.generation_id
      LEFT JOIN generations g ON g.id = cc2.generation_id
      WHERE cc1.generation_id = ?
      ORDER BY cc2.score DESC, cc2.id ASC
      LIMIT ?
    `).all(id, normalizedLimit);
    clusterRelated.forEach((row) => {
      if (!row.generation_id) return;
      const key = Number(row.generation_id);
      if (!relatedMap.has(key)) {
        relatedMap.set(key, {
          generationId: key,
          phrase: row.phrase || '',
          folderName: row.folder_name || '',
          baseName: row.base_filename || '',
          cardType: row.card_type || 'trilingual',
          reasons: [],
          relevance: 0
        });
      }
      const item = relatedMap.get(key);
      item.reasons.push('cluster');
      item.relevance = Math.max(item.relevance, Number(row.score || 0));
    });
    const grammarRelated = this.db.prepare(`
      SELECT DISTINCT g.id AS generation_id, g.phrase, g.folder_name, g.base_filename, g.card_type
      FROM knowledge_grammar_refs r1
      JOIN knowledge_grammar_refs r2
        ON r1.pattern_id = r2.pattern_id
       AND r2.generation_id != r1.generation_id
      LEFT JOIN generations g ON g.id = r2.generation_id
      WHERE r1.generation_id = ?
      ORDER BY r2.id ASC
      LIMIT ?
    `).all(id, normalizedLimit);
    grammarRelated.forEach((row) => {
      if (!row.generation_id) return;
      const key = Number(row.generation_id);
      if (!relatedMap.has(key)) {
        relatedMap.set(key, {
          generationId: key,
          phrase: row.phrase || '',
          folderName: row.folder_name || '',
          baseName: row.base_filename || '',
          cardType: row.card_type || 'trilingual',
          reasons: [],
          relevance: 0
        });
      }
      const item = relatedMap.get(key);
      item.reasons.push('pattern');
      item.relevance = Math.max(item.relevance, 1);
    });

    const relatedCards = Array.from(relatedMap.values())
      .map((item) => ({
        ...item,
        reasons: Array.from(new Set(item.reasons))
      }))
      .sort((a, b) => b.relevance - a.relevance)
      .slice(0, normalizedLimit);

    return {
      card: {
        generationId: Number(card.id),
        phrase: card.phrase || '',
        cardType: card.card_type || 'trilingual',
        folderName: card.folder_name || '',
        baseName: card.base_filename || '',
        provider: card.llm_provider || '',
        model: card.llm_model || '',
        createdAt: card.created_at
      },
      term: termRow ? {
        generationId: Number(termRow.generation_id),
        phrase: termRow.phrase || '',
        cardType: termRow.card_type || 'trilingual',
        langProfile: termRow.lang_profile || '',
        enHeadword: termRow.en_headword || null,
        jaHeadword: termRow.ja_headword || null,
        zhHeadword: termRow.zh_headword || null,
        aliases: safeJsonParse(termRow.aliases_json, []),
        tags: safeJsonParse(termRow.tags_json, []),
        score: Number(termRow.score || 0)
      } : null,
      examples,
      grammarHits,
      clusters,
      issues,
      synonymGroups: Array.from(synonymMap.values()),
      relatedCards
    };
  }

  getKnowledgeTermRelations(term, { limit = 20 } = {}) {
    const keyword = String(term || '').trim();
    if (!keyword) {
      return { term: '', matchedEntries: [], patterns: [], clusters: [], issues: [], relatedCards: [] };
    }
    const normalizedLimit = Math.max(1, Number(limit || 20));
    const rows = this.db.prepare(`
      SELECT
        t.generation_id, t.phrase, t.card_type, t.folder_name, t.lang_profile,
        t.en_headword, t.ja_headword, t.zh_headword, t.aliases_json, t.tags_json, t.score,
        g.base_filename
      FROM knowledge_terms_index t
      LEFT JOIN generations g ON g.id = t.generation_id
      WHERE t.phrase LIKE @q
         OR t.en_headword LIKE @q
         OR t.ja_headword LIKE @q
         OR t.zh_headword LIKE @q
      ORDER BY t.score DESC, t.updated_at DESC
      LIMIT @limit
    `).all({ q: `%${keyword}%`, limit: normalizedLimit });

    const matchedEntries = rows.map((row) => ({
      generationId: Number(row.generation_id),
      phrase: row.phrase || '',
      cardType: row.card_type || 'trilingual',
      folderName: row.folder_name || '',
      langProfile: row.lang_profile || '',
      enHeadword: row.en_headword || null,
      jaHeadword: row.ja_headword || null,
      zhHeadword: row.zh_headword || null,
      aliases: safeJsonParse(row.aliases_json, []),
      tags: safeJsonParse(row.tags_json, []),
      score: Number(row.score || 0),
      baseName: row.base_filename || ''
    }));

    const generationIds = matchedEntries.map((item) => item.generationId);
    const relatedCards = matchedEntries.slice(0, normalizedLimit).map((item) => ({
      generationId: item.generationId,
      phrase: item.phrase,
      folderName: item.folderName,
      baseName: item.baseName || '',
      cardType: item.cardType,
      reasons: ['term'],
      relevance: item.score
    }));

    const grouped = this._aggregateKnowledgeByGenerationIds(generationIds, normalizedLimit);
    return {
      term: keyword,
      matchedEntries,
      patterns: grouped.patterns,
      clusters: grouped.clusters,
      issues: grouped.issues,
      relatedCards
    };
  }

  getKnowledgePatternRelations(pattern, { limit = 20 } = {}) {
    const keyword = String(pattern || '').trim();
    if (!keyword) {
      return { pattern: null, refs: [], terms: [], clusters: [], issues: [], relatedCards: [] };
    }
    const normalizedLimit = Math.max(1, Number(limit || 20));
    const patternRow = this.db.prepare(`
      SELECT id, pattern, explanation_zh, confidence
      FROM knowledge_grammar_patterns
      WHERE is_active = 1
        AND pattern LIKE @pattern
      ORDER BY confidence DESC, updated_at DESC
      LIMIT 1
    `).get({ pattern: `%${keyword}%` });
    if (!patternRow) {
      return { pattern: null, refs: [], terms: [], clusters: [], issues: [], relatedCards: [] };
    }

    const refs = this.db.prepare(`
      SELECT r.generation_id, r.sentence_excerpt, g.phrase, g.folder_name, g.base_filename, g.card_type
      FROM knowledge_grammar_refs r
      LEFT JOIN generations g ON g.id = r.generation_id
      WHERE r.pattern_id = ?
      ORDER BY r.id ASC
      LIMIT ?
    `).all(patternRow.id, normalizedLimit).map((row) => ({
      generationId: Number(row.generation_id || 0),
      sentence: row.sentence_excerpt || '',
      phrase: row.phrase || '',
      folderName: row.folder_name || '',
      baseName: row.base_filename || '',
      cardType: row.card_type || 'trilingual'
    }));

    const generationIds = refs.map((row) => row.generationId).filter((id) => id > 0);
    const grouped = this._aggregateKnowledgeByGenerationIds(generationIds, normalizedLimit);
    const terms = this.db.prepare(`
      SELECT generation_id, phrase, card_type, folder_name, score
      FROM knowledge_terms_index
      WHERE generation_id IN (${generationIds.length ? generationIds.map(() => '?').join(',') : '0'})
      ORDER BY score DESC, updated_at DESC
      LIMIT ?
    `).all(...generationIds, normalizedLimit).map((row) => ({
      generationId: Number(row.generation_id),
      phrase: row.phrase || '',
      cardType: row.card_type || 'trilingual',
      folderName: row.folder_name || '',
      score: Number(row.score || 0)
    }));

    const relatedCards = refs.map((row) => ({
      generationId: row.generationId,
      phrase: row.phrase,
      folderName: row.folderName,
      baseName: row.baseName,
      cardType: row.cardType,
      reasons: ['pattern'],
      relevance: 1
    }));

    return {
      pattern: {
        id: Number(patternRow.id),
        pattern: patternRow.pattern || '',
        explanationZh: patternRow.explanation_zh || '',
        confidence: Number(patternRow.confidence || 0)
      },
      refs,
      terms,
      clusters: grouped.clusters,
      issues: grouped.issues,
      relatedCards
    };
  }

  getKnowledgeClusterRelations(clusterKey, { limit = 20 } = {}) {
    const keyword = String(clusterKey || '').trim();
    if (!keyword) {
      return { cluster: null, cards: [], terms: [], patterns: [], issues: [] };
    }
    const normalizedLimit = Math.max(1, Number(limit || 20));
    const cluster = this.db.prepare(`
      SELECT id, cluster_key, label, description, confidence, keywords_json
      FROM knowledge_clusters
      WHERE is_active = 1
        AND cluster_key = @key
      LIMIT 1
    `).get({ key: keyword });
    if (!cluster) {
      return { cluster: null, cards: [], terms: [], patterns: [], issues: [] };
    }

    const cards = this.db.prepare(`
      SELECT cc.generation_id, cc.score, g.phrase, g.folder_name, g.base_filename, g.card_type
      FROM knowledge_cluster_cards cc
      LEFT JOIN generations g ON g.id = cc.generation_id
      WHERE cc.cluster_id = ?
      ORDER BY cc.score DESC, cc.id ASC
      LIMIT ?
    `).all(cluster.id, normalizedLimit).map((row) => ({
      generationId: Number(row.generation_id || 0),
      phrase: row.phrase || '',
      folderName: row.folder_name || '',
      baseName: row.base_filename || '',
      cardType: row.card_type || 'trilingual',
      score: Number(row.score || 0)
    }));

    const generationIds = cards.map((item) => item.generationId).filter((id) => id > 0);
    const grouped = this._aggregateKnowledgeByGenerationIds(generationIds, normalizedLimit);
    const terms = this.db.prepare(`
      SELECT generation_id, phrase, card_type, folder_name, score
      FROM knowledge_terms_index
      WHERE generation_id IN (${generationIds.length ? generationIds.map(() => '?').join(',') : '0'})
      ORDER BY score DESC, updated_at DESC
      LIMIT ?
    `).all(...generationIds, normalizedLimit).map((row) => ({
      generationId: Number(row.generation_id),
      phrase: row.phrase || '',
      cardType: row.card_type || 'trilingual',
      folderName: row.folder_name || '',
      score: Number(row.score || 0)
    }));

    return {
      cluster: {
        id: Number(cluster.id),
        clusterKey: cluster.cluster_key || '',
        label: cluster.label || '',
        description: cluster.description || '',
        confidence: Number(cluster.confidence || 0),
        keywords: safeJsonParse(cluster.keywords_json, [])
      },
      cards,
      terms,
      patterns: grouped.patterns,
      issues: grouped.issues
    };
  }

  getKnowledgeIndex({ query = '', limit = 50 } = {}) {
    const hasQuery = String(query || '').trim().length > 0;
    const sql = hasQuery
      ? `
        SELECT *
        FROM knowledge_terms_index
        WHERE phrase LIKE @q OR en_headword LIKE @q OR ja_headword LIKE @q OR zh_headword LIKE @q
        ORDER BY updated_at DESC
        LIMIT @limit
      `
      : `
        SELECT *
        FROM knowledge_terms_index
        ORDER BY updated_at DESC
        LIMIT @limit
      `;
    const rows = this.db.prepare(sql).all({
      q: `%${String(query || '').trim()}%`,
      limit: Math.max(1, Number(limit || 50))
    });
    return rows.map((row) => ({
      generationId: row.generation_id,
      phrase: row.phrase,
      cardType: row.card_type,
      folderName: row.folder_name,
      langProfile: row.lang_profile,
      enHeadword: row.en_headword,
      jaHeadword: row.ja_headword,
      zhHeadword: row.zh_headword,
      aliases: safeJsonParse(row.aliases_json, []),
      tags: safeJsonParse(row.tags_json, []),
      score: row.score,
      updatedAt: row.updated_at
    }));
  }

  getKnowledgeSynonymsByPhrase(phrase, limit = 20) {
    const keyword = `%${String(phrase || '').trim()}%`;
    const groups = this.db.prepare(`
      SELECT DISTINCT g.*
      FROM knowledge_synonym_groups g
      LEFT JOIN knowledge_synonym_members m ON m.group_id = g.id
      WHERE g.is_active = 1
        AND (
          g.group_key LIKE @keyword
          OR g.pair_key LIKE @keyword
          OR g.term_a LIKE @keyword
          OR g.term_b LIKE @keyword
          OR m.term LIKE @keyword
        )
      ORDER BY g.updated_at DESC
      LIMIT @limit
    `).all({ keyword, limit: Math.max(1, Number(limit || 20)) });

    const membersByGroup = this.db.prepare(`
      SELECT group_id, generation_id, term, lang
      FROM knowledge_synonym_members
      WHERE group_id IN (
        SELECT id FROM knowledge_synonym_groups WHERE is_active = 1
      )
      ORDER BY id ASC
    `).all();

    const groupedMembers = new Map();
    membersByGroup.forEach((row) => {
      if (!groupedMembers.has(row.group_id)) groupedMembers.set(row.group_id, []);
      groupedMembers.get(row.group_id).push({
        generationId: row.generation_id,
        term: row.term,
        lang: row.lang
      });
    });

    return groups.map((group) => ({
      id: group.id,
      groupKey: group.group_key,
      pairKey: buildSynonymDetailKey(group),
      termA: group.term_a || null,
      termB: group.term_b || null,
      boundaryMatrix: {
        tone: group.tone,
        register: group.register_text,
        collocation: group.collocation_note
      },
      misuseRisk: group.misuse_risk,
      riskLevel: group.risk_level || group.misuse_risk || 'medium',
      recommendation: group.recommendation,
      actionableHint: group.actionable_hint || null,
      confidence: group.confidence,
      coverageRatio: group.coverage_ratio,
      model: group.model || null,
      promptVersion: group.prompt_version || null,
      schemaVersion: group.schema_version || null,
      parseStatus: group.parse_status || 'ok',
      contextSplit: safeJsonParse(group.context_split_json, []),
      misuseRisks: safeJsonParse(group.misuse_risks_json, []),
      jpNuance: safeJsonParse(group.jp_nuance_json, {}),
      boundaryTagsA: safeJsonParse(group.boundary_tags_a_json, []),
      boundaryTagsB: safeJsonParse(group.boundary_tags_b_json, []),
      members: groupedMembers.get(group.id) || [],
      updatedAt: group.updated_at
    }));
  }

  listKnowledgeSynonymBoundaries({ jobId, riskLevel, query = '', page = 1, pageSize = 20 } = {}) {
    const normalizedPage = Math.max(1, Number(page || 1));
    const normalizedPageSize = Math.max(1, Math.min(200, Number(pageSize || 20)));
    const conditions = ['1=1'];
    const params = {
      limit: normalizedPageSize,
      offset: (normalizedPage - 1) * normalizedPageSize
    };

    if (jobId) {
      conditions.push('g.version_job_id = @jobId');
      params.jobId = Number(jobId);
    } else {
      conditions.push('g.is_active = 1');
    }
    if (riskLevel) {
      conditions.push('COALESCE(g.risk_level, g.misuse_risk, \'medium\') = @riskLevel');
      params.riskLevel = String(riskLevel);
    }
    if (String(query || '').trim()) {
      conditions.push('(g.pair_key LIKE @q OR g.term_a LIKE @q OR g.term_b LIKE @q OR g.group_key LIKE @q)');
      params.q = `%${String(query).trim()}%`;
    }

    const totalRow = this.db.prepare(`
      SELECT COUNT(*) AS total
      FROM knowledge_synonym_groups g
      WHERE ${conditions.join(' AND ')}
    `).get(params);

    const rows = this.db.prepare(`
      SELECT g.*
      FROM knowledge_synonym_groups g
      WHERE ${conditions.join(' AND ')}
      ORDER BY
        CASE COALESCE(g.risk_level, g.misuse_risk, 'low')
          WHEN 'high' THEN 3
          WHEN 'medium' THEN 2
          ELSE 1
        END DESC,
        g.confidence DESC,
        g.updated_at DESC
      LIMIT @limit OFFSET @offset
    `).all(params);

    return {
      total: Number(totalRow?.total || 0),
      page: normalizedPage,
      pageSize: normalizedPageSize,
      items: rows.map((row) => ({
        pairKey: buildSynonymDetailKey(row),
        groupKey: row.group_key,
        termA: row.term_a || null,
        termB: row.term_b || null,
        riskLevel: row.risk_level || row.misuse_risk || 'medium',
        confidence: Number(row.confidence || 0),
        recommendation: row.recommendation || '',
        actionableHint: row.actionable_hint || '',
        model: row.model || null,
        promptVersion: row.prompt_version || null,
        schemaVersion: row.schema_version || null,
        parseStatus: row.parse_status || 'ok',
        updatedAt: row.updated_at,
        versionJobId: Number(row.version_job_id || 0)
      }))
    };
  }

  getKnowledgeSynonymBoundaryDetail({ pairKey, jobId } = {}) {
    const rawKey = String(pairKey || '').trim();
    if (!rawKey) return null;

    const idMatch = rawKey.match(/^id:(\d+)$/i);
    const normalizedKey = normalizeSynonymLookupKey(rawKey);
    const baseParams = { pairKey: normalizedKey };
    let row = null;

    if (idMatch) {
      const id = Number(idMatch[1]);
      row = this.db.prepare(jobId
        ? `
          SELECT *
          FROM knowledge_synonym_groups
          WHERE id = @id
            AND version_job_id = @jobId
          LIMIT 1
        `
        : `
          SELECT *
          FROM knowledge_synonym_groups
          WHERE id = @id
            AND is_active = 1
          LIMIT 1
        `).get(jobId ? { id, jobId: Number(jobId) } : { id });
    } else {
      row = this.db.prepare(jobId
        ? `
          SELECT *
          FROM knowledge_synonym_groups
          WHERE (
            LOWER(TRIM(COALESCE(pair_key, ''))) = @pairKey
            OR LOWER(TRIM(COALESCE(group_key, ''))) = @pairKey
          )
            AND version_job_id = @jobId
          ORDER BY updated_at DESC
          LIMIT 1
        `
        : `
          SELECT *
          FROM knowledge_synonym_groups
          WHERE (
            LOWER(TRIM(COALESCE(pair_key, ''))) = @pairKey
            OR LOWER(TRIM(COALESCE(group_key, ''))) = @pairKey
          )
            AND is_active = 1
          ORDER BY updated_at DESC
          LIMIT 1
        `).get(jobId ? { ...baseParams, jobId: Number(jobId) } : baseParams);
    }

    if (!row) return null;
    const members = this.db.prepare(`
      SELECT generation_id, term, lang
      FROM knowledge_synonym_members
      WHERE group_id = ?
      ORDER BY id ASC
    `).all(row.id).map((item) => ({
      generationId: item.generation_id ? Number(item.generation_id) : null,
      term: item.term || '',
      lang: item.lang || ''
    }));

    const candidateKey = normalizeSynonymLookupKey(
      sanitizeSynonymDisplayKey(row.pair_key)
      || sanitizeSynonymDisplayKey(row.group_key)
      || rawKey
    );
    const candidates = this.db.prepare(`
      SELECT candidate_score, evidence_hash, evidence_snapshot_json, status, llm_latency_ms, llm_error, updated_at
      FROM knowledge_synonym_candidates
      WHERE LOWER(TRIM(COALESCE(pair_key, ''))) = @pairKey
      ORDER BY updated_at DESC
      LIMIT 1
    `).get({ pairKey: candidateKey });

    return {
      id: Number(row.id),
      pairKey: buildSynonymDetailKey(row),
      groupKey: row.group_key || '',
      termA: row.term_a || null,
      termB: row.term_b || null,
      boundaryMatrix: {
        tone: row.tone || '',
        register: row.register_text || '',
        collocation: row.collocation_note || ''
      },
      misuseRisk: row.misuse_risk || 'medium',
      riskLevel: row.risk_level || row.misuse_risk || 'medium',
      recommendation: row.recommendation || '',
      actionableHint: row.actionable_hint || '',
      confidence: Number(row.confidence || 0),
      coverageRatio: Number(row.coverage_ratio || 0),
      model: row.model || null,
      promptVersion: row.prompt_version || null,
      schemaVersion: row.schema_version || null,
      parseStatus: row.parse_status || 'ok',
      result: safeJsonParse(row.result_json, {}),
      contextSplit: safeJsonParse(row.context_split_json, []),
      misuseRisks: safeJsonParse(row.misuse_risks_json, []),
      jpNuance: safeJsonParse(row.jp_nuance_json, {}),
      boundaryTagsA: safeJsonParse(row.boundary_tags_a_json, []),
      boundaryTagsB: safeJsonParse(row.boundary_tags_b_json, []),
      members,
      candidate: candidates ? {
        candidateScore: Number(candidates.candidate_score || 0),
        evidenceHash: candidates.evidence_hash || null,
        evidenceSnapshot: safeJsonParse(candidates.evidence_snapshot_json, {}),
        status: candidates.status || 'queued',
        llmLatencyMs: Number(candidates.llm_latency_ms || 0),
        llmError: candidates.llm_error || null,
        updatedAt: candidates.updated_at || null
      } : null,
      updatedAt: row.updated_at
    };
  }

  getKnowledgeGrammarPatterns({ pattern = '', limit = 30 } = {}) {
    const hasPattern = String(pattern || '').trim().length > 0;
    const rows = this.db.prepare(hasPattern
      ? `
        SELECT *
        FROM knowledge_grammar_patterns
        WHERE is_active = 1
          AND pattern LIKE @pattern
        ORDER BY updated_at DESC
        LIMIT @limit
      `
      : `
        SELECT *
        FROM knowledge_grammar_patterns
        WHERE is_active = 1
        ORDER BY updated_at DESC
        LIMIT @limit
      `
    ).all({
      pattern: `%${String(pattern || '').trim()}%`,
      limit: Math.max(1, Number(limit || 30))
    });

    const refs = this.db.prepare(`
      SELECT r.pattern_id, r.generation_id, r.sentence_excerpt, g.phrase
      FROM knowledge_grammar_refs r
      LEFT JOIN generations g ON g.id = r.generation_id
      WHERE r.pattern_id IN (
        SELECT id FROM knowledge_grammar_patterns WHERE is_active = 1
      )
      ORDER BY r.id ASC
    `).all();

    const refsMap = new Map();
    refs.forEach((row) => {
      if (!refsMap.has(row.pattern_id)) refsMap.set(row.pattern_id, []);
      refsMap.get(row.pattern_id).push({
        generationId: row.generation_id,
        phrase: row.phrase || '',
        sentence: row.sentence_excerpt || ''
      });
    });

    return rows.map((row) => ({
      id: row.id,
      pattern: row.pattern,
      explanationZh: row.explanation_zh,
      confidence: row.confidence,
      refs: refsMap.get(row.id) || [],
      updatedAt: row.updated_at
    }));
  }

  getKnowledgeClusters(limit = 20) {
    const clusters = this.db.prepare(`
      SELECT *
      FROM knowledge_clusters
      WHERE is_active = 1
      ORDER BY confidence DESC, updated_at DESC
      LIMIT ?
    `).all(Math.max(1, Number(limit || 20)));

    const cards = this.db.prepare(`
      SELECT cc.cluster_id, cc.generation_id, cc.score, g.phrase, g.folder_name
      FROM knowledge_cluster_cards cc
      LEFT JOIN generations g ON g.id = cc.generation_id
      WHERE cc.cluster_id IN (
        SELECT id FROM knowledge_clusters WHERE is_active = 1
      )
      ORDER BY cc.score DESC, cc.id ASC
    `).all();

    const cardMap = new Map();
    cards.forEach((row) => {
      if (!cardMap.has(row.cluster_id)) cardMap.set(row.cluster_id, []);
      cardMap.get(row.cluster_id).push({
        generationId: row.generation_id,
        phrase: row.phrase || '',
        folderName: row.folder_name || '',
        score: row.score || 0
      });
    });

    return clusters.map((row) => ({
      id: row.id,
      clusterKey: row.cluster_key,
      label: row.label,
      description: row.description,
      keywords: safeJsonParse(row.keywords_json, []),
      confidence: row.confidence,
      cards: cardMap.get(row.id) || [],
      updatedAt: row.updated_at
    }));
  }

  getKnowledgeIssues({ issueType, severity, resolved, limit = 100 } = {}) {
    const conditions = ['1=1'];
    const params = { limit: Math.max(1, Number(limit || 100)) };
    if (issueType) {
      conditions.push('issue_type = @issueType');
      params.issueType = String(issueType);
    }
    if (severity) {
      conditions.push('severity = @severity');
      params.severity = String(severity);
    }
    if (resolved !== undefined) {
      conditions.push('resolved = @resolved');
      params.resolved = resolved ? 1 : 0;
    }

    const sql = `
      SELECT *
      FROM knowledge_issues
      WHERE ${conditions.join(' AND ')}
      ORDER BY updated_at DESC
      LIMIT @limit
    `;
    const rows = this.db.prepare(sql).all(params);
    return rows.map((row) => ({
      id: row.id,
      issueType: row.issue_type,
      severity: row.severity,
      generationId: row.generation_id,
      phrase: row.phrase,
      fingerprint: row.fingerprint,
      detail: safeJsonParse(row.detail_json, {}),
      resolved: Boolean(row.resolved),
      lastJobId: row.last_job_id,
      createdAt: row.created_at,
      updatedAt: row.updated_at
    }));
  }

  getLatestKnowledgeSummary() {
    const row = this.db.prepare(`
      SELECT r.output_json
      FROM knowledge_outputs_raw r
      INNER JOIN knowledge_jobs j ON j.id = r.job_id
      WHERE j.job_type = 'summary'
        AND j.status IN ('success', 'partial')
      ORDER BY j.finished_at DESC, j.id DESC, r.batch_no ASC
      LIMIT 1
    `).get();
    if (!row) return null;
    const parsed = safeJsonParse(row.output_json, null);
    return parsed && parsed.result ? parsed.result : parsed;
  }

  /**
   * 关闭数据库连接
   */
  close() {
    this.db.close();
    console.log('[Database] Connection closed');
  }
}

// 导出单例
module.exports = new DatabaseService();
