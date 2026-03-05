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
        lang TEXT NOT NULL,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (group_id) REFERENCES knowledge_synonym_groups(id) ON DELETE CASCADE,
        FOREIGN KEY (generation_id) REFERENCES generations(id) ON DELETE SET NULL
      );
      CREATE INDEX IF NOT EXISTS idx_ksm_group ON knowledge_synonym_members(group_id);
      CREATE INDEX IF NOT EXISTS idx_ksm_generation ON knowledge_synonym_members(generation_id);

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
    return rows.map((row) => ({
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
      createdAt: row.created_at,
      startedAt: row.started_at,
      finishedAt: row.finished_at
    }));
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

  replaceKnowledgeSynonymData(groups = [], jobId) {
    const transaction = this.db.transaction((payload, versionJobId) => {
      this.db.prepare(`UPDATE knowledge_synonym_groups SET is_active = 0 WHERE is_active = 1`).run();
      this.db.prepare(`DELETE FROM knowledge_synonym_members WHERE group_id IN (SELECT id FROM knowledge_synonym_groups WHERE version_job_id = ?)`).run(versionJobId);
      this.db.prepare(`DELETE FROM knowledge_synonym_groups WHERE version_job_id = ?`).run(versionJobId);

      const insertGroup = this.db.prepare(`
        INSERT INTO knowledge_synonym_groups (
          group_key, tone, register_text, collocation_note, misuse_risk,
          recommendation, confidence, coverage_ratio, version_job_id, is_active
        ) VALUES (
          @groupKey, @tone, @registerText, @collocationNote, @misuseRisk,
          @recommendation, @confidence, @coverageRatio, @versionJobId, 1
        )
      `);
      const insertMember = this.db.prepare(`
        INSERT INTO knowledge_synonym_members (
          group_id, generation_id, term, lang
        ) VALUES (
          @groupId, @generationId, @term, @lang
        )
      `);

      let count = 0;
      for (const group of payload) {
        const result = insertGroup.run({
          groupKey: String(group.groupKey || ''),
          tone: group.boundaryMatrix?.tone || null,
          registerText: group.boundaryMatrix?.register || null,
          collocationNote: group.boundaryMatrix?.collocation || null,
          misuseRisk: group.misuseRisk || 'medium',
          recommendation: group.recommendation || '',
          confidence: Number(group.confidence || 0),
          coverageRatio: Number(group.coverageRatio || 0),
          versionJobId: Number(versionJobId)
        });
        const groupId = Number(result.lastInsertRowid);
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

    return transaction(Array.isArray(groups) ? groups : [], Number(jobId));
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
      boundaryMatrix: {
        tone: group.tone,
        register: group.register_text,
        collocation: group.collocation_note
      },
      misuseRisk: group.misuse_risk,
      recommendation: group.recommendation,
      confidence: group.confidence,
      coverageRatio: group.coverage_ratio,
      members: groupedMembers.get(group.id) || [],
      updatedAt: group.updated_at
    }));
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
