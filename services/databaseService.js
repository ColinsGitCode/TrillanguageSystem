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
const log = require('../lib/logger').child({ module: 'svc/database' });
const generationJobsDomain = require('./db/generationJobs');
const generationsDomain = require('./db/generations');
const highlightsDomain = require('./db/highlights');
const knowledgeJobsDomain = require('./db/knowledgeJobs');
const knowledgeIssuesDomain = require('./db/knowledgeIssues');
const knowledgeGrammarDomain = require('./db/knowledgeGrammar');
const knowledgeClustersDomain = require('./db/knowledgeClusters');
const knowledgeTermsIndexDomain = require('./db/knowledgeTermsIndex');
const knowledgeSynonymsDomain = require('./db/knowledgeSynonyms');
const knowledgeRelationsDomain = require('./db/knowledgeRelations');
const testResetDomain = require('./db/testReset');

const DEFAULT_DB_PATH = process.env.DB_PATH || './data/trilingual_records.db';

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
      log.warn({ err, table: tableName, column: columnName }, 'column migration skipped');
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

    // Route every SQL through the logger at debug level — silent by default,
    // visible with LOG_LEVEL=debug. Stops schema init from flooding stdout.
    this.db = new Database(dbPath, { verbose: (sql) => log.debug({ sql }, 'sqlite') });

    // 性能优化
    this.db.pragma('journal_mode = WAL');
    this.db.pragma('foreign_keys = ON');

    this.initializeTables();

    log.info({ dbPath }, 'database initialized');
  }

  /**
   * 初始化数据库表
   */
  initializeTables() {
    const schemaPath = path.join(__dirname, '../database/schema.sql');

    if (!fs.existsSync(schemaPath)) {
      log.warn({ schemaPath }, 'schema file not found');
      return;
    }

    const schema = fs.readFileSync(schemaPath, 'utf-8');
    this.db.exec(schema);
    this.dropDeprecatedTables();
    this.ensureSchemaMigrations();

    log.info('database tables initialized');
  }

  // One-shot cleanup of the retired training / few-shot / review subsystem.
  // These tables are no longer created by schema.sql; this drops them from
  // databases provisioned before the removal. Child tables are dropped before
  // their parents; foreign_keys is toggled off for the duration so dangling
  // references can't block the drops.
  dropDeprecatedTables() {
    const deprecated = [
      'few_shot_examples',
      'few_shot_runs',
      'experiment_rounds',
      'teacher_references',
      'experiment_samples',
      'example_unit_sources',
      'example_reviews',
      'review_campaign_items',
      'review_campaigns',
      'example_units',
      'card_training_assets',
    ];
    try {
      this.db.pragma('foreign_keys = OFF');
      const tx = this.db.transaction(() => {
        deprecated.forEach((table) => {
          this.db.exec(`DROP TABLE IF EXISTS ${table};`);
        });
      });
      tx();
    } catch (err) {
      log.warn({ err }, 'dropping deprecated tables failed');
    } finally {
      this.db.pragma('foreign_keys = ON');
    }
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
        log.warn({ err, sql }, 'migration skipped');
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

    this.db.exec(`
      CREATE TABLE IF NOT EXISTS generation_jobs (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        job_type TEXT NOT NULL DEFAULT 'trilingual',
        phrase_raw TEXT,
        phrase_normalized TEXT NOT NULL,
        source_mode TEXT,
        target_folder TEXT,
        llm_provider TEXT NOT NULL DEFAULT 'gemini',
        llm_model TEXT,
        enable_compare INTEGER DEFAULT 0,
        status TEXT NOT NULL DEFAULT 'queued',
        attempts INTEGER NOT NULL DEFAULT 0,
        max_retries INTEGER NOT NULL DEFAULT 2,
        error_message TEXT,
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

      CREATE TABLE IF NOT EXISTS generation_job_events (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        job_id INTEGER NOT NULL,
        event_type TEXT NOT NULL,
        payload_json TEXT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (job_id) REFERENCES generation_jobs(id) ON DELETE CASCADE
      );
      CREATE INDEX IF NOT EXISTS idx_gje_job_created ON generation_job_events(job_id, created_at DESC);
      CREATE INDEX IF NOT EXISTS idx_gje_type_created ON generation_job_events(event_type, created_at DESC);
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

    ensureTableColumns(this.db, 'generation_jobs', [
      "job_type TEXT NOT NULL DEFAULT 'trilingual'",
      'phrase_raw TEXT',
      'source_mode TEXT',
      'target_folder TEXT',
      "llm_provider TEXT NOT NULL DEFAULT 'gemini'",
      'llm_model TEXT',
      'enable_compare INTEGER DEFAULT 0',
      'max_retries INTEGER NOT NULL DEFAULT 2',
      'source_context_json TEXT',
      'retry_after_ts INTEGER',
      'created_by_client TEXT',
      'result_generation_id INTEGER',
      'result_folder TEXT',
      'result_base_filename TEXT',
      'request_payload_json TEXT',
      'result_summary_json TEXT',
      'cleared_at DATETIME'
    ]);

    this.db.exec(`
      CREATE UNIQUE INDEX IF NOT EXISTS idx_ksg_pair_schema_hash ON knowledge_synonym_groups(pair_key, schema_version, evidence_hash);
      CREATE INDEX IF NOT EXISTS idx_ksg_pair_active ON knowledge_synonym_groups(pair_key, is_active, updated_at DESC);
      CREATE INDEX IF NOT EXISTS idx_ksc_job_score ON knowledge_synonym_candidates(job_id, candidate_score DESC);
      CREATE INDEX IF NOT EXISTS idx_ksc_status ON knowledge_synonym_candidates(status, updated_at DESC);
      CREATE INDEX IF NOT EXISTS idx_ksjm_updated ON knowledge_synonym_jobs_meta(updated_at DESC);
      CREATE INDEX IF NOT EXISTS idx_gj_phrase_status ON generation_jobs(phrase_normalized, status);
    `);
  }

  // ========== 写入操作 ==========

  /**
   * 插入生成记录（事务）
   * @param {Object} data - 包含 generation, observability, audioFiles
   * @returns {number} generationId
   */
  insertGeneration(data) {
    return generationsDomain.insertGeneration(this.db, data);
  }

  insertError(errorData) {
    return generationsDomain.insertError(this.db, errorData);
  }

  queryGenerations(filters = {}) {
    return generationsDomain.query(this.db, filters);
  }

  getTotalCount(filters = {}) {
    return generationsDomain.getTotalCount(this.db, filters);
  }

  getGenerationById(id) {
    return generationsDomain.getById(this.db, id);
  }

  getGenerationByFile(folderName, baseFilename) {
    return generationsDomain.getByFile(this.db, folderName, baseFilename);
  }

  getCardHighlightByFile(folderName, baseFilename, sourceHash) {
    return highlightsDomain.getByFile(this.db, folderName, baseFilename, sourceHash);
  }

  upsertCardHighlight(payload = {}) {
    return highlightsDomain.upsert(this.db, payload);
  }

  deleteCardHighlightByFile(folderName, baseFilename, sourceHash = '') {
    return highlightsDomain.deleteByFile(this.db, folderName, baseFilename, sourceHash);
  }

  getHighlightStats(filters = {}) {
    return highlightsDomain.getStats(this.db, filters);
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

  fullTextSearch(query, limit = 20) {
    return generationsDomain.fullTextSearch(this.db, query, limit);
  }

  getRecentGenerations(limit = 10) {
    return generationsDomain.getRecent(this.db, limit);
  }

  deleteGeneration(id) {
    return generationsDomain.remove(this.db, id);
  }

  // ========== Generation jobs ==========
  // Domain extracted to services/db/generationJobs.js; these are thin
  // delegations so external callers (routes, generationJobService, server.js)
  // keep their dbService.METHOD(...) call shape unchanged.

  mapGenerationJobRow(row) {
    return generationJobsDomain.mapRow(row);
  }

  mapGenerationJobEventRow(row) {
    return generationJobsDomain.mapEventRow(row);
  }

  createGenerationJob(payload = {}) {
    return generationJobsDomain.create(this.db, payload);
  }

  appendGenerationJobEvent(jobId, eventType, payload = {}) {
    return generationJobsDomain.appendEvent(this.db, jobId, eventType, payload);
  }

  listGenerationJobEvents(opts = {}) {
    return generationJobsDomain.listEvents(this.db, opts);
  }

  getGenerationJobById(jobId) {
    return generationJobsDomain.getById(this.db, jobId);
  }

  listGenerationJobs(limit = 30) {
    return generationJobsDomain.list(this.db, limit);
  }

  getGenerationJobSummary() {
    return generationJobsDomain.getSummary(this.db);
  }

  hasActiveDuplicateGenerationJob(phraseNormalized, jobType = 'trilingual') {
    return generationJobsDomain.hasActiveDuplicate(this.db, phraseNormalized, jobType);
  }

  updateGenerationJob(jobId, patch = {}) {
    return generationJobsDomain.update(this.db, jobId, patch);
  }

  recoverStaleRunningGenerationJobs() {
    return generationJobsDomain.recoverStaleRunning(this.db);
  }

  takeNextQueuedGenerationJob() {
    return generationJobsDomain.takeNextQueued(this.db);
  }

  retryGenerationJob(jobId) {
    return generationJobsDomain.retry(this.db, jobId);
  }

  clearCompletedGenerationJobs() {
    return generationJobsDomain.clearCompleted(this.db);
  }

  cancelGenerationJob(jobId) {
    return generationJobsDomain.cancel(this.db, jobId);
  }

  getNextQueuedGenerationRetryTs() {
    return generationJobsDomain.getNextQueuedRetryTs(this.db);
  }

  // ========== Knowledge analysis jobs ==========
  // Lifecycle (create/status/list/cancel + synonym meta) extracted to
  // services/db/knowledgeJobs.js. The deeper knowledge_* data tables
  // (terms/synonym groups/grammar patterns/clusters/relations/index) still
  // live below until they have their own unit-test layer.

  createKnowledgeJob(payload = {}) {
    return knowledgeJobsDomain.create(this.db, payload);
  }

  upsertKnowledgeSynonymJobMeta(jobId, meta = {}) {
    return knowledgeJobsDomain.upsertSynonymMeta(this.db, jobId, meta);
  }

  getKnowledgeSynonymJobMeta(jobId) {
    return knowledgeJobsDomain.getSynonymMeta(this.db, jobId);
  }

  updateKnowledgeJobStatus(jobId, patch = {}) {
    return knowledgeJobsDomain.updateStatus(this.db, jobId, patch);
  }

  getKnowledgeJobById(jobId) {
    return knowledgeJobsDomain.getById(this.db, jobId);
  }

  listKnowledgeJobs(limit = 20) {
    return knowledgeJobsDomain.list(this.db, limit);
  }

  cancelKnowledgeJob(jobId) {
    return knowledgeJobsDomain.cancel(this.db, jobId);
  }

  insertKnowledgeRawOutput(jobId, batchNo, outputData = {}) {
    return knowledgeRelationsDomain.insertRawOutput(this.db, jobId, batchNo, outputData);
  }

  getKnowledgeSourceCards(scope = {}) {
    return knowledgeRelationsDomain.getSourceCards(this.db, scope);
  }

  upsertKnowledgeTermsIndex(entries = [], jobId = null) {
    return knowledgeTermsIndexDomain.upsert(this.db, entries, jobId);
  }

  replaceKnowledgeIssues(issues = [], jobId = null) {
    return knowledgeIssuesDomain.replace(this.db, issues, jobId);
  }

  saveKnowledgeSynonymCandidates(jobId, candidates = []) {
    return knowledgeSynonymsDomain.saveCandidates(this.db, jobId, candidates);
  }

  replaceKnowledgeSynonymData(groups = [], jobId, options = {}) {
    return knowledgeSynonymsDomain.replaceData(this.db, groups, jobId, options);
  }

  replaceKnowledgeGrammarData(patterns = [], jobId) {
    return knowledgeGrammarDomain.replaceData(this.db, patterns, jobId);
  }

  replaceKnowledgeClusterData(clusters = [], jobId) {
    return knowledgeClustersDomain.replaceData(this.db, clusters, jobId);
  }

  getKnowledgeOverview(filters = {}) {
    return knowledgeRelationsDomain.getOverview(this.db, filters);
  }

  _aggregateKnowledgeByGenerationIds(generationIds = [], limit = 12) {
    return knowledgeRelationsDomain.aggregateByGenerationIds(this.db, generationIds, limit);
  }

  getKnowledgeCardRelations(generationId, filters = {}) {
    return knowledgeRelationsDomain.getCardRelations(this.db, generationId, filters);
  }

  getKnowledgeTermRelations(term, filters = {}) {
    return knowledgeRelationsDomain.getTermRelations(this.db, term, filters);
  }

  getKnowledgePatternRelations(pattern, filters = {}) {
    return knowledgeRelationsDomain.getPatternRelations(this.db, pattern, filters);
  }

  getKnowledgeClusterRelations(clusterKey, filters = {}) {
    return knowledgeRelationsDomain.getClusterRelations(this.db, clusterKey, filters);
  }

  getKnowledgeIndex(filters = {}) {
    return knowledgeTermsIndexDomain.search(this.db, filters);
  }

  getKnowledgeSynonymsByPhrase(phrase, limit = 20) {
    return knowledgeSynonymsDomain.findByPhrase(this.db, phrase, limit);
  }

  listKnowledgeSynonymBoundaries(filters = {}) {
    return knowledgeSynonymsDomain.listBoundaries(this.db, filters);
  }

  getKnowledgeSynonymBoundaryDetail(filters = {}) {
    return knowledgeSynonymsDomain.getBoundaryDetail(this.db, filters);
  }

  getKnowledgeGrammarPatterns(filters = {}) {
    return knowledgeGrammarDomain.listPatterns(this.db, filters);
  }

  getKnowledgeClusters(limit = 20) {
    return knowledgeClustersDomain.listClusters(this.db, limit);
  }

  getKnowledgeIssues(filters = {}) {
    return knowledgeIssuesDomain.list(this.db, filters);
  }

  getLatestKnowledgeSummary() {
    return knowledgeRelationsDomain.getLatestSummary(this.db);
  }

  // Test-only: wipe every project table. Gated by E2E_TEST_MODE at the
  // route layer; safe to expose here because it's a no-op on the production
  // singleton unless something explicitly calls it.
  truncateAllForTests() {
    return testResetDomain.truncateAll(this.db);
  }

  /**
   * 关闭数据库连接
   */
  close() {
    this.db.close();
    log.info('database connection closed');
  }
}

// 导出单例
module.exports = new DatabaseService();
// Class itself is exposed so unit tests can spin up isolated in-memory
// instances (`new DatabaseService(':memory:')`). Production code should
// keep using the singleton.
module.exports.DatabaseService = DatabaseService;
