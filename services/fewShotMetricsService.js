const crypto = require('crypto');
const dbService = require('./databaseService');

function buildPromptHash(prompt) {
  if (!prompt) return null;
  return crypto.createHash('sha256').update(String(prompt)).digest('hex');
}

function insertFewShotRun(data) {
  const stmt = dbService.db.prepare(`
    INSERT INTO few_shot_runs (
      generation_id, experiment_id, variant, fewshot_enabled,
      strategy, example_count, min_score, context_window, token_budget_ratio,
      base_prompt_tokens, fewshot_prompt_tokens, total_prompt_tokens_est,
      output_tokens, output_chars, quality_score, quality_dimensions,
      latency_total_ms, success, fallback_reason, prompt_hash
    ) VALUES (
      @generationId, @experimentId, @variant, @fewshotEnabled,
      @strategy, @exampleCount, @minScore, @contextWindow, @tokenBudgetRatio,
      @basePromptTokens, @fewshotPromptTokens, @totalPromptTokensEst,
      @outputTokens, @outputChars, @qualityScore, @qualityDimensions,
      @latencyTotalMs, @success, @fallbackReason, @promptHash
    )
  `);

  const payload = {
    generationId: data.generationId,
    experimentId: data.experimentId,
    variant: data.variant,
    fewshotEnabled: data.fewshotEnabled ? 1 : 0,
    strategy: data.strategy || null,
    exampleCount: data.exampleCount || 0,
    minScore: data.minScore || null,
    contextWindow: data.contextWindow || null,
    tokenBudgetRatio: data.tokenBudgetRatio || null,
    basePromptTokens: data.basePromptTokens || 0,
    fewshotPromptTokens: data.fewshotPromptTokens || 0,
    totalPromptTokensEst: data.totalPromptTokensEst || 0,
    outputTokens: data.outputTokens || 0,
    outputChars: data.outputChars || 0,
    qualityScore: data.qualityScore || 0,
    qualityDimensions: data.qualityDimensions ? JSON.stringify(data.qualityDimensions) : null,
    latencyTotalMs: data.latencyTotalMs || 0,
    success: data.success ? 1 : 0,
    fallbackReason: data.fallbackReason || null,
    promptHash: data.promptHash || buildPromptHash(data.promptText || '')
  };

  const result = stmt.run(payload);
  return result.lastInsertRowid;
}

function insertFewShotExamples(runId, examples = []) {
  if (!examples.length) return 0;
  const stmt = dbService.db.prepare(`
    INSERT INTO few_shot_examples (
      run_id, example_generation_id, example_quality_score,
      example_prompt_hash, similarity_score
    ) VALUES (
      @runId, @exampleGenerationId, @exampleQualityScore,
      @examplePromptHash, @similarityScore
    )
  `);

  const tx = dbService.db.transaction((items) => {
    let count = 0;
    items.forEach((ex) => {
      stmt.run({
        runId,
        exampleGenerationId: ex.exampleGenerationId,
        exampleQualityScore: ex.exampleQualityScore || null,
        examplePromptHash: ex.examplePromptHash || null,
        similarityScore: ex.similarityScore || null
      });
      count += 1;
    });
    return count;
  });

  return tx(examples);
}

module.exports = {
  insertFewShotRun,
  insertFewShotExamples,
  buildPromptHash
};
