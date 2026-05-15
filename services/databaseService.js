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
const log = require('../lib/logger').child({ module: 'svc/database' });
const { safeJsonParse } = require('./db/helpers');
const generationJobsDomain = require('./db/generationJobs');
const experimentsDomain = require('./db/experiments');
const generationsDomain = require('./db/generations');
const highlightsDomain = require('./db/highlights');
const trainingAssetsDomain = require('./db/trainingAssets');
const knowledgeJobsDomain = require('./db/knowledgeJobs');

const DEFAULT_DB_PATH = process.env.DB_PATH || './data/trilingual_records.db';

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
    this.ensureSchemaMigrations();

    log.info('database tables initialized');
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

  mapTrainingAssetRow(row) {
    return trainingAssetsDomain.mapRow(row);
  }

  getCardTrainingAssetByGenerationId(generationId) {
    return trainingAssetsDomain.getByGenerationId(this.db, generationId);
  }

  getCardTrainingAssetByFile(folderName, baseFilename) {
    return trainingAssetsDomain.getByFile(this.db, folderName, baseFilename);
  }

  getTrainingBackfillSummary(filters = {}) {
    return trainingAssetsDomain.getBackfillSummary(this.db, filters);
  }

  listTrainingBackfillCandidates(filters = {}) {
    return trainingAssetsDomain.listBackfillCandidates(this.db, filters);
  }

  upsertCardTrainingAsset(payload = {}) {
    return trainingAssetsDomain.upsert(this.db, payload);
  }

  deleteCardTrainingAssetByFile(folderName, baseFilename) {
    return trainingAssetsDomain.deleteByFile(this.db, folderName, baseFilename);
  }

  // ========== Experiments + few-shot ==========
  // Domain extracted to services/db/experiments.js. These are thin
  // delegations so external callers (scripts/run_fewshot_rounds.js,
  // experimentTrackingService, etc.) keep the dbService.METHOD(...) shape.

  getFewShotRuns(experimentId) {
    return experimentsDomain.getFewShotRuns(this.db, experimentId);
  }

  getFewShotExamples(runIds = []) {
    return experimentsDomain.getFewShotExamples(this.db, runIds);
  }

  upsertExperimentRound(roundData) {
    return experimentsDomain.upsertRound(this.db, roundData);
  }

  insertExperimentSample(sample) {
    return experimentsDomain.insertSample(this.db, sample);
  }

  upsertTeacherReference(ref) {
    return experimentsDomain.upsertTeacherReference(this.db, ref);
  }

  recomputeExperimentRoundStats(experimentId, roundNumber) {
    return experimentsDomain.recomputeRoundStats(this.db, experimentId, roundNumber);
  }

  getExperimentRoundTrend(experimentId) {
    return experimentsDomain.getRoundTrend(this.db, experimentId);
  }

  getExperimentSamples(experimentId) {
    return experimentsDomain.getSamples(this.db, experimentId);
  }

  getTeacherReferences(experimentId) {
    return experimentsDomain.getTeacherReferences(this.db, experimentId);
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
        insertGroup.run({
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
        const row = selectGroupId.get({ pairKey, schemaVersion, evidenceHash });
        const groupId = row ? Number(row.id) : 0;
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
    log.info('database connection closed');
  }
}

// 导出单例
module.exports = new DatabaseService();
// Class itself is exposed so unit tests can spin up isolated in-memory
// instances (`new DatabaseService(':memory:')`). Production code should
// keep using the singleton.
module.exports.DatabaseService = DatabaseService;
