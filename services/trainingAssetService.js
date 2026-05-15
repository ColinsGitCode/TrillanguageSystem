'use strict';

// Training-pack pipeline extracted from server.js.
//
// Owns the per-generation training-pack export: invoke trainingPackService,
// persist a JSON sidecar next to the card, upsert the DB row, and the bulk
// backfill that loops over candidates and produces the per-card summary
// returned by /api/training/backfill. Pure-ish helpers (fallback result
// builder, sidecar payload shape, asset summary) live alongside the async
// orchestrators so the whole training domain is one cohesive module.

const fs = require('fs');
const path = require('path');

const trainingPackService = require('./trainingPackService');
const dbService = require('./databaseService');
const {
  RECORDS_PATH,
  TRAINING_TEACHER_MODEL,
  normalizeCardType,
} = require('../lib/serverConfig');
const { buildTrainingSidecarPath } = require('../lib/trainingSidecar');
const log = require('../lib/logger').child({ module: 'svc/training-asset' });

// Read the card markdown either from the DB row (inline) or from the saved
// .md file. Returns '' on any miss so backfill can record a skip reason.
function resolveRecordMarkdownContent(record) {
  const inlineMarkdown = String(record?.markdown_content || '').trim();
  if (inlineMarkdown) return inlineMarkdown;
  const mdPath = String(record?.md_file_path || '').trim();
  if (!mdPath) return '';
  try {
    if (fs.existsSync(mdPath)) {
      return fs.readFileSync(mdPath, 'utf-8');
    }
  } catch (err) {
    log.warn({ err, mdPath }, 'failed to read markdown file for backfill');
  }
  return '';
}

// Wrap trainingPackService.fallbackHeuristicPack in a fully-populated
// training-asset record shape so the caller can persist it unchanged.
function buildTrainingFallbackResult({ phrase, cardType, markdown, reason, latencyMs = 0, validationErrors = [] }) {
  const fallback = trainingPackService.fallbackHeuristicPack({ phrase, cardType, markdown });
  return {
    status: fallback.ok ? 'fallback' : 'failed',
    source: 'heuristic',
    payload: fallback.ok ? fallback.payload : null,
    qualityScore: fallback.ok ? fallback.qualityScore : 0,
    coverageScore: fallback.ok ? fallback.coverageScore : 0,
    selfConfidence: fallback.ok ? fallback.selfConfidence : 0,
    validationErrors,
    fallbackReason: reason || 'heuristic_fallback',
    providerUsed: 'gemini',
    modelUsed: TRAINING_TEACHER_MODEL,
    promptVersion: trainingPackService.TRAINING_PROMPT_VERSION,
    schemaVersion: trainingPackService.TRAINING_SCHEMA_VERSION,
    tokensInput: 0,
    tokensOutput: 0,
    tokensTotal: 0,
    costTotal: 0,
    latencyMs,
    rawOutput: ''
  };
}

function buildTrainingSidecarPayload(trainingAsset, context = {}) {
  return {
    schemaVersion: trainingAsset?.schemaVersion || 'training_pack_v1',
    generatedAt: new Date().toISOString(),
    generationId: Number(context.generationId || trainingAsset?.generationId || 0) || null,
    phrase: String(context.phrase || ''),
    folderName: String(context.folderName || ''),
    baseName: String(context.baseName || ''),
    cardType: String(context.cardType || 'trilingual'),
    status: trainingAsset?.status || 'failed',
    source: trainingAsset?.source || 'heuristic',
    providerUsed: trainingAsset?.providerUsed || 'gemini',
    modelUsed: trainingAsset?.modelUsed || '',
    promptVersion: trainingAsset?.promptVersion || '',
    qualityScore: Number(trainingAsset?.qualityScore || 0),
    coverageScore: Number(trainingAsset?.coverageScore || 0),
    selfConfidence: Number(trainingAsset?.selfConfidence || 0),
    validationErrors: Array.isArray(trainingAsset?.validationErrors) ? trainingAsset.validationErrors : [],
    fallbackReason: trainingAsset?.fallbackReason || null,
    payload: trainingAsset?.payload || null
  };
}

function persistTrainingSidecar(sidecarPath, payload) {
  if (!sidecarPath) return false;
  try {
    fs.writeFileSync(sidecarPath, JSON.stringify(payload, null, 2), 'utf-8');
    return true;
  } catch (err) {
    log.warn({ err, sidecarPath }, 'failed to write sidecar');
    return false;
  }
}

// Compact view used in API responses ({status, source, qualityScore, assetId}).
function summarizeTrainingAsset(trainingAsset) {
  if (!trainingAsset) {
    return {
      status: 'failed',
      source: 'heuristic',
      qualityScore: 0,
      assetId: null
    };
  }
  return {
    status: trainingAsset.status || 'failed',
    source: trainingAsset.source || 'heuristic',
    qualityScore: Number(trainingAsset.qualityScore || 0),
    assetId: Number(trainingAsset.id || 0) || null
  };
}

// Write the sidecar JSON and upsert the card_training_assets row. Returns
// the DB row (with .id) on success.
function persistTrainingAssetRecord(context = {}, trainingResult) {
  const generationId = Number(context.generationId || 0);
  const phrase = String(context.phrase || '').trim();
  const folderName = String(context.folderName || '').trim();
  const baseName = String(context.baseName || '').trim();
  const cardType = normalizeCardType(context.cardType);
  const targetDir = String(context.targetDir || '').trim();
  const sidecarPath = buildTrainingSidecarPath(targetDir, baseName);
  const sidecarPayload = buildTrainingSidecarPayload(trainingResult, {
    generationId,
    phrase,
    folderName,
    baseName,
    cardType
  });
  persistTrainingSidecar(sidecarPath, sidecarPayload);

  return dbService.upsertCardTrainingAsset({
    generationId,
    folderName,
    baseFilename: baseName,
    cardType,
    status: trainingResult.status,
    source: trainingResult.source,
    providerUsed: trainingResult.providerUsed,
    modelUsed: trainingResult.modelUsed,
    promptVersion: trainingResult.promptVersion,
    schemaVersion: trainingResult.schemaVersion,
    qualityScore: trainingResult.qualityScore,
    selfConfidence: trainingResult.selfConfidence,
    coverageScore: trainingResult.coverageScore,
    validationErrors: trainingResult.validationErrors || [],
    fallbackReason: trainingResult.fallbackReason || null,
    tokensInput: trainingResult.tokensInput || 0,
    tokensOutput: trainingResult.tokensOutput || 0,
    tokensTotal: trainingResult.tokensTotal || 0,
    costTotal: trainingResult.costTotal || 0,
    latencyMs: trainingResult.latencyMs || 0,
    payload: trainingResult.payload || null,
    sidecarFilePath: sidecarPath
  });
}

// Generate (or heuristic-fallback) the training pack for one card and
// persist it. The returned object is the persisted DB row, or a fallback
// summary if persistence couldn't proceed (missing context).
async function generateAndPersistTrainingAsset(context = {}) {
  const generationId = Number(context.generationId || 0);
  if (!generationId) {
    return {
      status: 'failed',
      source: 'heuristic',
      qualityScore: 0,
      assetId: null,
      reason: 'missing_generation_id'
    };
  }

  const phrase = String(context.phrase || '').trim();
  const cardType = normalizeCardType(context.cardType);
  const markdown = String(context.markdown || '').trim();
  const folderName = String(context.folderName || '').trim();
  const baseName = String(context.baseName || '').trim();
  if (!phrase || !markdown || !folderName || !baseName) {
    return {
      status: 'failed',
      source: 'heuristic',
      qualityScore: 0,
      assetId: null,
      reason: 'missing_context'
    };
  }

  let trainingResult;
  try {
    trainingResult = await trainingPackService.generateTrainingPack({
      phrase,
      cardType,
      markdown,
      providerHint: 'gemini',
      model: TRAINING_TEACHER_MODEL,
      baseName: `${baseName}_train`,
      runtimeMode: context.runtimeMode || 'default'
    });
  } catch (err) {
    trainingResult = buildTrainingFallbackResult({
      phrase,
      cardType,
      markdown,
      reason: 'generate_training_asset_failed',
      validationErrors: [`generate_training_asset_failed: ${err.message}`],
      latencyMs: 0
    });
    log.warn({ err }, 'generateAndPersistTrainingAsset fallback');
  }

  const saved = persistTrainingAssetRecord(context, trainingResult);

  return saved || {
    ...summarizeTrainingAsset(trainingResult),
    generationId
  };
}

// Iterate over candidates returned by listTrainingBackfillCandidates, run
// generateAndPersistTrainingAsset on each, and roll up a summary used by
// /api/training/backfill.
async function backfillTrainingAssets(options = {}) {
  const limit = Math.max(1, Math.min(200, Number(options.limit || 20)));
  const force = Boolean(options.force);
  const rawCardType = String(options.cardType || '').trim();
  const filters = {
    limit,
    force,
    folderName: String(options.folderName || '').trim(),
    cardType: rawCardType ? normalizeCardType(rawCardType) : '',
    provider: String(options.provider || '').trim().toLowerCase()
  };

  const candidates = dbService.listTrainingBackfillCandidates(filters);
  const results = [];
  let readyCount = 0;
  let repairedCount = 0;
  let fallbackCount = 0;
  let failedCount = 0;

  for (const candidate of candidates) {
    try {
      const record = dbService.getGenerationById(candidate.id);
      if (!record) {
        results.push({
          generationId: candidate.id,
          phrase: candidate.phrase,
          folderName: candidate.folderName,
          baseName: candidate.baseFilename,
          status: 'skipped',
          reason: 'generation_not_found'
        });
        continue;
      }

      const markdown = resolveRecordMarkdownContent(record);
      if (!markdown) {
        results.push({
          generationId: record.id,
          phrase: record.phrase,
          folderName: record.folder_name,
          baseName: record.base_filename,
          status: 'skipped',
          reason: 'markdown_not_found'
        });
        continue;
      }

      const targetDir = record.md_file_path ? path.dirname(record.md_file_path) : path.join(RECORDS_PATH, record.folder_name);
      const training = await generateAndPersistTrainingAsset({
        generationId: record.id,
        phrase: record.phrase,
        cardType: record.card_type,
        markdown,
        folderName: record.folder_name,
        baseName: record.base_filename,
        targetDir,
        runtimeMode: 'backfill'
      });

      if (training.status === 'ready') readyCount += 1;
      else if (training.status === 'repaired') repairedCount += 1;
      else if (training.status === 'fallback') fallbackCount += 1;
      else failedCount += 1;

      results.push({
        generationId: record.id,
        phrase: record.phrase,
        folderName: record.folder_name,
        baseName: record.base_filename,
        status: training.status || 'failed',
        source: training.source || 'heuristic',
        qualityScore: Number(training.qualityScore || 0),
        assetId: Number(training.id || training.assetId || 0) || null
      });
    } catch (err) {
      failedCount += 1;
      results.push({
        generationId: candidate.id,
        phrase: candidate.phrase,
        folderName: candidate.folderName,
        baseName: candidate.baseFilename,
        status: 'failed',
        source: 'heuristic',
        qualityScore: 0,
        assetId: null,
        reason: err.message
      });
      log.warn({ err, candidateId: candidate.id }, 'backfill candidate failed');
    }
  }

  const summary = dbService.getTrainingBackfillSummary({
    folderName: filters.folderName,
    cardType: filters.cardType,
    provider: filters.provider
  });

  return {
    limit,
    force,
    requestedFilters: {
      folderName: filters.folderName || null,
      cardType: filters.cardType || null,
      provider: filters.provider || null
    },
    processed: results.length,
    readyCount,
    repairedCount,
    fallbackCount,
    failedCount,
    results,
    summary
  };
}

module.exports = {
  resolveRecordMarkdownContent,
  buildTrainingFallbackResult,
  buildTrainingSidecarPayload,
  persistTrainingSidecar,
  summarizeTrainingAsset,
  persistTrainingAssetRecord,
  generateAndPersistTrainingAsset,
  backfillTrainingAssets,
};
