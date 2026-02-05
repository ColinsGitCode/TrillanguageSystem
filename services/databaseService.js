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

    console.log('[Database] Tables initialized');
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
            phrase, phrase_language, llm_provider, llm_model,
            folder_name, base_filename, md_file_path, html_file_path, meta_file_path,
            markdown_content, en_translation, ja_translation, zh_translation,
            generation_date, request_id
          ) VALUES (
            @phrase, @phraseLanguage, @llmProvider, @llmModel,
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
  queryGenerations({ page = 1, limit = 20, provider, dateFrom, dateTo, search }) {
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
  getTotalCount({ provider, dateFrom, dateTo, search }) {
    let sql = `SELECT COUNT(*) as total FROM generations WHERE 1=1`;
    const params = {};

    if (provider) {
      sql += ` AND llm_provider = @provider`;
      params.provider = provider;
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
   * 关闭数据库连接
   */
  close() {
    this.db.close();
    console.log('[Database] Connection closed');
  }
}

// 导出单例
module.exports = new DatabaseService();
