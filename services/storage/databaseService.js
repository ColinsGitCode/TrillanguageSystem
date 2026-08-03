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
const log = require('../../lib/logger').child({ module: 'svc/database' });
const generationJobsDomain = require('./db/generationJobs');
const generationsDomain = require('./db/generations');
const testResetDomain = require('./db/testReset');
const cardTagsDomain = require('./db/cardTags');
const textbooksDomain = require('./db/textbooks');
const textbookWorkflowDomain = require('./db/textbookWorkflow');
const textbookOperationsDomain = require('./db/textbookOperations');
const annotationsDomain = require('./db/annotations');
const manualTagsDomain = require('./db/manualTags');
const migrationRunner = require('./db/migrationRunner');
const kgSourceSyncJobsDomain = require('./db/kgSourceSyncJobs');
const { ensureGenerationsFtsInfrastructure } = require('./db/ftsInfrastructure');
const { runWithSqliteBusyRetry } = require('./sqliteBusyRetry');
const { normalizeTagValue } = require('../dataPreparation/rules');
const {
  SQLITE_BUSY_TIMEOUT_MS,
  SQLITE_BUSY_RETRY_MAX,
  SQLITE_BUSY_RETRY_BASE_MS,
} = require('../../lib/serverConfig');

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
    this.db = new Database(dbPath, {
      timeout: SQLITE_BUSY_TIMEOUT_MS,
      verbose: (sql) => log.debug({ sql }, 'sqlite'),
    });

    // 性能优化
    this.db.pragma('journal_mode = WAL');
    this.db.pragma('foreign_keys = ON');
    this.db.pragma(`busy_timeout = ${SQLITE_BUSY_TIMEOUT_MS}`);

    this.initializeTables();

    log.info({ dbPath }, 'database initialized');
  }

  /**
   * 初始化数据库表
   */
  initializeTables() {
    const schemaPath = path.join(__dirname, '../../database/schema.sql');

    if (!fs.existsSync(schemaPath)) {
      log.warn({ schemaPath }, 'schema file not found');
      return;
    }

    const preexistingTables = this.db.prepare(
      "SELECT name FROM sqlite_master WHERE type = 'table'"
    ).all().map((row) => row.name);
    const schema = fs.readFileSync(schemaPath, 'utf-8');
    this.db.exec(schema);
    this.dropDeprecatedTables();
    this.ensureSchemaMigrations();
    this.migrationResult = migrationRunner.runMigrations(this.db, { preexistingTables });

    log.info('database tables initialized');
  }

  // One-shot cleanup of retired product domains. These tables are no longer
  // created by schema.sql. Child tables are listed before parents and foreign
  // keys are disabled for the transaction so legacy databases can converge to
  // the current Cards Factory schema on startup.
  dropDeprecatedTables() {
    const deprecated = [
      'knowledge_grammar_refs',
      'knowledge_cluster_cards',
      'knowledge_synonym_members',
      'knowledge_synonym_candidates',
      'knowledge_synonym_jobs_meta',
      'knowledge_outputs_raw',
      'knowledge_terms_index',
      'knowledge_issues',
      'knowledge_grammar_patterns',
      'knowledge_clusters',
      'knowledge_synonym_groups',
      'knowledge_jobs',
      'card_reviews',
      'card_srs',
      'user_preferences',
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
    if (!columnSet.has('content_hash')) {
      migrations.push(`ALTER TABLE generations ADD COLUMN content_hash TEXT`);
    }

    migrations.forEach((sql) => {
      try {
        this.db.exec(sql);
      } catch (err) {
        log.warn({ err, sql }, 'migration skipped');
      }
    });

    ensureGenerationsFtsInfrastructure(this.db);
    cardTagsDomain.ensureSchema(this.db);
    this.db.exec(`
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
      CREATE UNIQUE INDEX IF NOT EXISTS idx_audio_generation_suffix
        ON audio_files(generation_id, filename_suffix);
    `);

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
        llm_provider TEXT NOT NULL DEFAULT 'deepseek',
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

    ensureTableColumns(this.db, 'generation_jobs', [
      "job_type TEXT NOT NULL DEFAULT 'trilingual'",
      'phrase_raw TEXT',
      'source_mode TEXT',
      'target_folder TEXT',
      "llm_provider TEXT NOT NULL DEFAULT 'deepseek'",
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
    return this.withBusyRetry(() => generationsDomain.insertGeneration(this.db, data));
  }

  insertError(errorData) {
    return this.withBusyRetry(() => generationsDomain.insertError(this.db, errorData));
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

  findDuplicateGenerations(phrase, cardType = 'trilingual') {
    const normalizedPhrase = normalizeTagValue(phrase);
    return generationsDomain.listDuplicateCandidates(this.db, cardType).filter(
      (row) => normalizeTagValue(row.phrase) === normalizedPhrase
    );
  }

  importTextbookDraft(payload) {
    return textbooksDomain.importDraft(this.db, payload);
  }

  listTextbookCourses() {
    return textbooksDomain.listCourses(this.db);
  }

  getTextbookCourse(id) {
    return textbooksDomain.getCourse(this.db, id);
  }

  getTextbookTrack(id) {
    return textbooksDomain.getTrack(this.db, id);
  }

  verifyTextbookRevision(id, payload = {}) {
    return textbooksDomain.verifyRevision(this.db, id, payload);
  }

  getTextbookReviewSummary(revisionId) {
    return textbookWorkflowDomain.reviewSummary(this.db, revisionId);
  }

  listPendingTextbookReviews(limit = 10) {
    return textbookWorkflowDomain.listPendingTrackReviews(this.db, limit);
  }

  getTextbookRevision(revisionId) {
    return textbookWorkflowDomain.getRevision(this.db, revisionId);
  }

  updateTextbookReviewState(revisionId, expressionId, payload = {}) {
    return this.withBusyRetry(() => textbookWorkflowDomain.updateReviewState(
      this.db,
      revisionId,
      expressionId,
      payload
    ));
  }

  updateTextbookReviewStates(revisionId, payload = {}) {
    return this.withBusyRetry(() => textbookWorkflowDomain.updateReviewStates(
      this.db,
      revisionId,
      payload
    ));
  }

  copyTextbookRevision(revisionId, payload = {}) {
    return this.withBusyRetry(() => textbookWorkflowDomain.copyOnWriteRevision(
      this.db,
      revisionId,
      payload
    ));
  }

  createTextbookOperation(trackId, payload = {}) {
    return this.withBusyRetry(() => textbookOperationsDomain.createOperation(this.db, trackId, payload));
  }

  getTextbookOperation(operationId) {
    return textbookOperationsDomain.getOperation(this.db, operationId);
  }

  getTextbookOperationByIdempotencyKey(idempotencyKey) {
    return textbookOperationsDomain.getOperationByIdempotencyKey(this.db, idempotencyKey);
  }

  listTextbookOperationEvents(operationId) {
    return textbookOperationsDomain.listEvents(this.db, operationId);
  }

  claimTextbookOperation(operationId) {
    return this.withBusyRetry(() => textbookOperationsDomain.claimOperation(this.db, operationId));
  }

  updateTextbookOperationStep(operationId, step, status, options = {}) {
    return this.withBusyRetry(() => textbookOperationsDomain.updateStep(
      this.db,
      operationId,
      step,
      status,
      options
    ));
  }

  finishTextbookOperation(operationId, status, options = {}) {
    return this.withBusyRetry(() => textbookOperationsDomain.finishOperation(
      this.db,
      operationId,
      status,
      options
    ));
  }

  retryTextbookOperation(operationId) {
    return this.withBusyRetry(() => textbookOperationsDomain.retryOperation(this.db, operationId));
  }

  requestTextbookOperationCancellation(operationId) {
    return this.withBusyRetry(() => textbookOperationsDomain.requestCancellation(this.db, operationId));
  }

  isTextbookOperationCancellationRequested(operationId) {
    return textbookOperationsDomain.isCancellationRequested(this.db, operationId);
  }

  recoverTextbookOperations() {
    return this.withBusyRetry(() => textbookOperationsDomain.recoverStale(this.db));
  }

  listQueuedTextbookOperationIds() {
    return textbookOperationsDomain.listQueued(this.db);
  }

  listRecentTextbookOperations(limit = 30) {
    return textbookOperationsDomain.listRecent(this.db, limit);
  }

  previewTextbookPublish(id) {
    return textbooksDomain.previewPublish(this.db, id);
  }

  publishTextbookTrack(id, payload = {}) {
    return this.withBusyRetry(() => textbooksDomain.publishTrack(this.db, id, payload));
  }

  enqueueKgSourceSyncJob(descriptor, options = {}) {
    return this.withBusyRetry(() => kgSourceSyncJobsDomain.enqueueJob(this.db, descriptor, options));
  }

  enqueueKgSourceSyncJobs(descriptors, options = {}) {
    return this.withBusyRetry(() => kgSourceSyncJobsDomain.enqueueJobs(this.db, descriptors, options));
  }

  claimNextKgSourceSyncJob(options = {}) {
    return this.withBusyRetry(() => kgSourceSyncJobsDomain.claimNextJob(this.db, options));
  }

  finishKgSourceSyncJob(id, status, result = {}, options = {}) {
    return this.withBusyRetry(() => kgSourceSyncJobsDomain.finishJob(this.db, id, status, result, options));
  }

  failKgSourceSyncJob(id, error, options = {}) {
    return this.withBusyRetry(() => kgSourceSyncJobsDomain.failJob(this.db, id, error, options));
  }

  recoverStaleKgSourceSyncJobs(options = {}) {
    return this.withBusyRetry(() => kgSourceSyncJobsDomain.recoverStaleRunningJobs(this.db, options));
  }

  getNextKgSourceSyncRetryTs() {
    return kgSourceSyncJobsDomain.nextRetryTs(this.db);
  }

  getKgSourceSyncSummary() {
    return kgSourceSyncJobsDomain.summary(this.db);
  }

  listKgSourceSyncJobs(options = {}) {
    return kgSourceSyncJobsDomain.listJobs(this.db, options);
  }

  previewTextbookDerivation(expressionId, payload = {}) {
    return textbooksDomain.previewDerivation(this.db, expressionId, payload);
  }

  createTextbookDerivation(expressionId, payload = {}) {
    return this.withBusyRetry(() => textbooksDomain.createDerivation(this.db, expressionId, payload));
  }

  attachTextbookDerivationJob(derivationId, jobId) {
    return this.withBusyRetry(() => textbooksDomain.attachDerivationJob(this.db, derivationId, jobId));
  }

  syncTextbookDerivationJobStatus(jobId) {
    return this.withBusyRetry(() => textbooksDomain.syncDerivationJobStatus(this.db, jobId));
  }

  upsertTextbookAudioFiles(generationId, rows = []) {
    return this.withBusyRetry(() => textbooksDomain.upsertTextbookAudioFiles(this.db, generationId, rows));
  }

  listTextbookAudioFiles(generationId) {
    return textbooksDomain.listTextbookAudio(this.db, generationId);
  }

  getTextbookAudioFile(audioFileId) {
    return textbooksDomain.getTextbookAudioFile(this.db, audioFileId);
  }

  searchTextbookExpressions(query, limit) {
    return textbooksDomain.searchExpressions(this.db, query, limit);
  }

  getTextbookAsset(id) {
    return textbooksDomain.getAsset(this.db, id);
  }

  markTextbookAssetAvailability(id, availability) {
    return textbooksDomain.markAssetAvailability(this.db, id, availability);
  }

  // ========== Card annotations ==========

  resolveCardAnnotationTarget(targetKind, targetId) {
    return annotationsDomain.resolveTarget(this.db, targetKind, targetId);
  }

  getCardAnnotation(id) {
    return annotationsDomain.getById(this.db, id);
  }

  listCardAnnotations(targetKind, targetId, options = {}) {
    return annotationsDomain.listByTarget(this.db, targetKind, targetId, options);
  }

  listCardAnnotationsByLegacyHighlightId(legacyHighlightId) {
    return annotationsDomain.listByLegacyHighlightId(this.db, legacyHighlightId);
  }

  createCardAnnotation(annotation) {
    return this.withBusyRetry(() => annotationsDomain.insert(this.db, annotation));
  }

  updateCardAnnotation(id, expectedVersion, patch, updatedAtUtc) {
    return this.withBusyRetry(() => annotationsDomain.update(
      this.db,
      id,
      expectedVersion,
      patch,
      updatedAtUtc
    ));
  }

  deleteCardAnnotation(id, expectedVersion, updatedAtUtc) {
    return this.withBusyRetry(() => annotationsDomain.softDelete(
      this.db,
      id,
      expectedVersion,
      updatedAtUtc
    ));
  }

  appendCardAnnotationMigrationEvent(event) {
    return this.withBusyRetry(() => annotationsDomain.appendMigrationEvent(this.db, event));
  }

  listCardAnnotationMigrationEvents(migrationPlanHash) {
    return annotationsDomain.listMigrationEvents(this.db, migrationPlanHash);
  }

  getAnnotationStats(filters = {}) {
    return annotationsDomain.getStats(this.db, filters);
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
        AND g.card_type <> 'textbook_track'
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
        AND g.card_type <> 'textbook_track'
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
        AND g.card_type <> 'textbook_track'
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
        AND g.card_type <> 'textbook_track'
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
        AND g.card_type <> 'textbook_track'
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
        AND g.card_type <> 'textbook_track'
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

  deleteGenerationWithLearningState(id) {
    return generationsDomain.removeWithLearningState(this.db, id);
  }

  listCardTags(generationId, options = {}) {
    return cardTagsDomain.listByGeneration(this.db, generationId, options);
  }

  listActiveCardTagsForGenerations(generationIds = []) {
    return cardTagsDomain.listActiveForGenerations(this.db, generationIds);
  }

  setCardTag(tag) {
    return this.withBusyRetry(() => cardTagsDomain.setTag(this.db, tag));
  }

  getCardTagCounts() {
    return cardTagsDomain.counts(this.db);
  }

  listManualTagDefinitions(options = {}) {
    return manualTagsDomain.listDefinitions(this.db, options);
  }

  getManualTagDefinition(id) {
    return manualTagsDomain.getDefinition(this.db, id);
  }

  createManualTagDefinition(tag) {
    return this.withBusyRetry(() => manualTagsDomain.createDefinition(this.db, tag));
  }

  updateManualTagDefinition(id, expectedVersion, tag) {
    return this.withBusyRetry(() => manualTagsDomain.updateDefinition(
      this.db, id, expectedVersion, tag
    ));
  }

  archiveManualTagDefinition(id, expectedVersion) {
    return this.withBusyRetry(() => manualTagsDomain.archiveDefinition(
      this.db, id, expectedVersion
    ));
  }

  listManualTagsForTarget(targetKind, targetId) {
    return manualTagsDomain.listAssigned(this.db, targetKind, targetId);
  }

  replaceManualTagsForTarget(targetKind, targetId, tagIds) {
    return this.withBusyRetry(() => manualTagsDomain.replaceAssignments(
      this.db, targetKind, targetId, tagIds
    ));
  }

  listManualTagTargets(tagId, options = {}) {
    return manualTagsDomain.listTargets(this.db, tagId, options);
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
    return this.withBusyRetry(() => generationJobsDomain.create(this.db, payload));
  }

  appendGenerationJobEvent(jobId, eventType, payload = {}) {
    return this.withBusyRetry(() => generationJobsDomain.appendEvent(this.db, jobId, eventType, payload));
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
    return this.withBusyRetry(() => generationJobsDomain.update(this.db, jobId, patch));
  }

  recoverStaleRunningGenerationJobs() {
    return this.withBusyRetry(() => generationJobsDomain.recoverStaleRunning(this.db));
  }

  takeNextQueuedGenerationJob() {
    return this.withBusyRetry(() => generationJobsDomain.takeNextQueued(this.db));
  }

  retryGenerationJob(jobId) {
    return this.withBusyRetry(() => generationJobsDomain.retry(this.db, jobId));
  }

  clearCompletedGenerationJobs() {
    return this.withBusyRetry(() => generationJobsDomain.clearCompleted(this.db));
  }

  cancelGenerationJob(jobId) {
    return this.withBusyRetry(() => generationJobsDomain.cancel(this.db, jobId));
  }

  getNextQueuedGenerationRetryTs() {
    return generationJobsDomain.getNextQueuedRetryTs(this.db);
  }

  withBusyRetry(operation) {
    return runWithSqliteBusyRetry(operation, {
      maxRetries: SQLITE_BUSY_RETRY_MAX,
      baseDelayMs: SQLITE_BUSY_RETRY_BASE_MS,
      onRetry: ({ attempt, delayMs, error }) => {
        log.warn({ err: error, attempt, delayMs }, 'retrying SQLite busy operation');
      },
    });
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
