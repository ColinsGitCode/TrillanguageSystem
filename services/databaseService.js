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
