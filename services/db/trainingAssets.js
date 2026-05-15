'use strict';

// Card-training-assets domain extracted from databaseService.js. Owns the
// card_training_assets table plus the backfill summary / candidate-listing
// joins against generations. Functions take `db` first.

const { safeJsonParse } = require('./helpers');

function mapRow(row) {
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

function getByGenerationId(db, generationId) {
  const id = Number(generationId || 0);
  if (!id) return null;
  const row = db.prepare(`
    SELECT *
    FROM card_training_assets
    WHERE generation_id = ?
    LIMIT 1
  `).get(id);
  return mapRow(row);
}

function getByFile(db, folderName, baseFilename) {
  const folder = String(folderName || '').trim();
  const base = String(baseFilename || '').trim();
  if (!folder || !base) return null;
  const row = db.prepare(`
    SELECT *
    FROM card_training_assets
    WHERE folder_name = ?
      AND base_filename = ?
    ORDER BY updated_at DESC, id DESC
    LIMIT 1
  `).get(folder, base);
  return mapRow(row);
}

function getBackfillSummary(db, filters = {}) {
  const folderName = String(filters.folderName || '').trim();
  const cardType = String(filters.cardType || '').trim();
  const provider = String(filters.provider || '').trim().toLowerCase();

  const where = ['1=1'];
  const params = {};

  if (folderName) { where.push('g.folder_name = @folderName'); params.folderName = folderName; }
  if (cardType)   { where.push('g.card_type = @cardType');     params.cardType = cardType; }
  if (provider)   { where.push('g.llm_provider = @provider');  params.provider = provider; }

  const row = db.prepare(`
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

function listBackfillCandidates(db, filters = {}) {
  const limit = Math.max(1, Math.min(200, Number(filters.limit || 20)));
  const force = Boolean(filters.force);
  const folderName = String(filters.folderName || '').trim();
  const cardType = String(filters.cardType || '').trim();
  const provider = String(filters.provider || '').trim().toLowerCase();

  const where = ['1=1'];
  const params = { limit };

  if (folderName) { where.push('g.folder_name = @folderName'); params.folderName = folderName; }
  if (cardType)   { where.push('g.card_type = @cardType');     params.cardType = cardType; }
  if (provider)   { where.push('g.llm_provider = @provider');  params.provider = provider; }
  if (!force)     { where.push('cta.generation_id IS NULL'); }

  return db.prepare(`
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

function upsert(db, payload = {}) {
  const generationId = Number(payload.generationId || 0);
  if (!generationId) throw new Error('generationId is required');
  const folderName = String(payload.folderName || '').trim();
  const baseFilename = String(payload.baseFilename || '').trim();
  if (!folderName || !baseFilename) {
    throw new Error('folderName/baseFilename are required');
  }

  db.prepare(`
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

  return getByGenerationId(db, generationId);
}

function deleteByFile(db, folderName, baseFilename) {
  const folder = String(folderName || '').trim();
  const base = String(baseFilename || '').trim();
  if (!folder || !base) return 0;
  const result = db.prepare(`
    DELETE FROM card_training_assets
    WHERE folder_name = ?
      AND base_filename = ?
  `).run(folder, base);
  return Number(result.changes || 0);
}

module.exports = {
  mapRow,
  getByGenerationId,
  getByFile,
  getBackfillSummary,
  listBackfillCandidates,
  upsert,
  deleteByFile,
};
