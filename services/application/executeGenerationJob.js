'use strict';

const { executeCardGeneration } = require('./executeCardGeneration');
const {
  DEFAULT_DEEPSEEK_MODEL,
  normalizeCardType,
  normalizeSourceMode,
} = require('../../lib/serverConfig');

function commandFromGenerationJob(job = {}) {
  return {
    phrase: String(job.phraseNormalized || job.phraseRaw || '').trim(),
    cardType: normalizeCardType(job.jobType),
    sourceMode: normalizeSourceMode(job.sourceMode),
    targetFolder: String(job.targetFolder || '').trim(),
    requestedProvider: String(job.provider || 'deepseek').trim() || 'deepseek',
    modelOverride: String(job.llmModel || DEFAULT_DEEPSEEK_MODEL).trim() || DEFAULT_DEEPSEEK_MODEL,
  };
}

function createGenerationJobExecutor(execute = executeCardGeneration) {
  if (typeof execute !== 'function') throw new TypeError('generation use case must be a function');
  return async function executeGenerationJob(job) {
    return execute(commandFromGenerationJob(job));
  };
}

const executeGenerationJob = createGenerationJobExecutor();

module.exports = {
  commandFromGenerationJob,
  createGenerationJobExecutor,
  executeGenerationJob,
};
