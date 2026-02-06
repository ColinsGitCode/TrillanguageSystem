const crypto = require('crypto');
const dbService = require('./databaseService');

function toRoundNumber(value) {
  const num = Number(value);
  return Number.isFinite(num) ? Math.max(0, Math.floor(num)) : 0;
}

function hashText(text) {
  const raw = String(text || '');
  if (!raw) return null;
  return crypto.createHash('sha256').update(raw).digest('hex');
}

function getOutputText(content, fallbackRaw) {
  if (typeof fallbackRaw === 'string' && fallbackRaw.trim()) return fallbackRaw;
  if (!content) return '';
  if (typeof content === 'string') return content;
  if (typeof content.markdown_content === 'string') return content.markdown_content;
  try {
    return JSON.stringify(content);
  } catch (err) {
    return '';
  }
}

function recordExperimentSample(payload) {
  const experimentId = String(payload.experimentId || '').trim();
  if (!experimentId) return null;

  const roundNumber = toRoundNumber(payload.roundNumber);
  const fewShot = payload.fewShot || {};
  const metadata = payload.observability?.metadata || {};
  const quality = payload.observability?.quality || {};
  const tokens = payload.observability?.tokens || {};
  const perf = payload.observability?.performance || {};

  dbService.upsertExperimentRound({
    experimentId,
    roundNumber,
    roundName: payload.roundName || `round_${roundNumber}`,
    variant: payload.variant || null,
    llmModel: metadata.model || null,
    fewshotEnabled: !!fewShot.enabled,
    fewshotStrategy: fewShot.strategy || null,
    fewshotCount: fewShot.countUsed || 0,
    fewshotMinScore: fewShot.minScore ?? null,
    tokenBudgetRatio: fewShot.tokenBudgetRatio ?? null,
    contextWindow: fewShot.contextWindow ?? null,
    notes: payload.notes || null
  });

  const promptHash = hashText(payload.promptText || metadata.promptText || '');
  const llmOutputText = getOutputText(payload.content, payload.rawOutputText);

  const sampleId = dbService.insertExperimentSample({
    experimentId,
    roundNumber,
    generationId: payload.generationId ?? null,
    phrase: payload.phrase || '',
    provider: payload.provider || 'local',
    variant: payload.variant || null,
    isTeacher: !!payload.isTeacherReference,
    qualityScore: quality.score ?? null,
    qualityDimensions: quality.dimensions || {},
    tokensTotal: tokens.total ?? null,
    latencyMs: perf.totalTime ?? null,
    promptHash,
    fewshotEnabled: !!fewShot.enabled,
    success: payload.success !== false,
    errorMessage: payload.errorMessage || null
  });

  if (payload.isTeacherReference) {
    dbService.upsertTeacherReference({
      experimentId,
      roundNumber,
      phrase: payload.phrase || '',
      provider: payload.provider || 'gemini',
      generationId: payload.generationId ?? null,
      qualityScore: quality.score ?? null,
      outputHash: hashText(llmOutputText),
      outputText: llmOutputText
    });
  }

  dbService.recomputeExperimentRoundStats(experimentId, roundNumber);
  return sampleId;
}

module.exports = {
  recordExperimentSample,
  toRoundNumber,
  hashText
};
