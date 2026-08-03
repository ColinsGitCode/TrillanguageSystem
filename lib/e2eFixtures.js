'use strict';

// Deterministic generation fixtures used only when E2E_TEST_MODE is on.

const { buildFixtureContent, buildFixtureObservability } = require('../services/fixtures/e2eFixtureService');
const { buildBaseName, ensureFolderDirectory, ensureTodayDirectory } = require('../services/storage/fileManager');

const e2eGenerationAttempts = new Map();

function buildE2EGenerateResult({ phrase, cardType, requestedProvider, sourceMode, targetFolder = '' }) {
  const safePhrase = String(phrase || '').trim();
  if (safePhrase.includes('__E2E_ALWAYS_FAIL__')) {
    const error = new Error('e2e_fixture_forced_failure');
    error.status = 503;
    throw error;
  }
  if (safePhrase.includes('__E2E_AUTO_BACKOFF__')) {
    const key = `auto_backoff:${safePhrase}`;
    const attempt = Number(e2eGenerationAttempts.get(key) || 0) + 1;
    e2eGenerationAttempts.set(key, attempt);
    if (attempt === 1) {
      const error = new Error('DeepSeek API error (429): {"error":"rate limited","code":"MODEL_CAPACITY_EXHAUSTED"}');
      error.status = 429;
      error.payload = { error: 'DeepSeek rate limited', code: 'MODEL_CAPACITY_EXHAUSTED' };
      throw error;
    }
  }
  if (safePhrase.includes('__E2E_FAIL_ONCE__')) {
    const key = `fail_once:${safePhrase}`;
    const attempt = Number(e2eGenerationAttempts.get(key) || 0) + 1;
    e2eGenerationAttempts.set(key, attempt);
    if (attempt === 1) {
      const error = new Error('e2e_fixture_forced_retryable_failure');
      error.status = 503;
      throw error;
    }
  }

  const content = buildFixtureContent({ phrase, cardType });
  const { targetDir, folderName } = targetFolder
    ? ensureFolderDirectory(targetFolder)
    : ensureTodayDirectory();
  const baseName = buildBaseName(phrase, targetDir);
  const observability = buildFixtureObservability({
    provider: requestedProvider,
    model: 'e2e-fixture',
    phrase,
    cardType,
    sourceMode
  });
  return {
    output: content,
    prompt: `E2E fixture prompt for ${safePhrase}`,
    observability,
    baseName,
    targetDir,
    folderName,
    fallback: null
  };
}

function resetE2EFixtures() {
  e2eGenerationAttempts.clear();
}

module.exports = { buildE2EGenerateResult, resetE2EFixtures };
