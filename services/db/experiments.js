'use strict';

// Experiments + few-shot domain extracted from databaseService.js. Owns the
// experiment_rounds / experiment_samples / teacher_references tables plus
// the few_shot_runs / few_shot_examples read helpers. Functions take `db`
// as their first argument; databaseService.js wraps them as thin class
// methods so external callers don't change.

function getFewShotRuns(db, experimentId) {
  if (!experimentId) return [];
  return db.prepare(`
    SELECT * FROM few_shot_runs
    WHERE experiment_id = ?
    ORDER BY created_at ASC
  `).all(experimentId);
}

function getFewShotExamples(db, runIds = []) {
  if (!runIds.length) return [];
  const placeholders = runIds.map(() => '?').join(', ');
  return db.prepare(`
    SELECT * FROM few_shot_examples
    WHERE run_id IN (${placeholders})
    ORDER BY id ASC
  `).all(...runIds);
}

function upsertRound(db, roundData) {
  const stmt = db.prepare(`
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

function insertSample(db, sample) {
  const stmt = db.prepare(`
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

function upsertTeacherReference(db, ref) {
  const stmt = db.prepare(`
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

function recomputeRoundStats(db, experimentId, roundNumber) {
  const localStats = db.prepare(`
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

  const teacherStats = db.prepare(`
    SELECT AVG(quality_score) AS teacherAvg
    FROM teacher_references
    WHERE experiment_id = ?
      AND round_number <= ?
  `).get(experimentId, roundNumber);

  db.prepare(`
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

function getRoundTrend(db, experimentId) {
  if (!experimentId) return [];
  return db.prepare(`
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

function getSamples(db, experimentId) {
  if (!experimentId) return [];
  const rows = db.prepare(`
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

function getTeacherReferences(db, experimentId) {
  if (!experimentId) return [];
  return db.prepare(`
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

module.exports = {
  getFewShotRuns,
  getFewShotExamples,
  upsertRound,
  insertSample,
  upsertTeacherReference,
  recomputeRoundStats,
  getRoundTrend,
  getSamples,
  getTeacherReferences,
};
