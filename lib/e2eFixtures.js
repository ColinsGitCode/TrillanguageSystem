'use strict';

// Deterministic fixtures used only when E2E_TEST_MODE is on. Keeps the e2e
// scaffolding (forced failures, fake knowledge jobs) out of the request code.

const { buildFixtureContent, buildFixtureObservability } = require('../services/fixtures/e2eFixtureService');
const { buildBaseName, ensureTodayDirectory } = require('../services/storage/fileManager');

// In-memory e2e state — never used in production.
const e2eKnowledgeJobs = {
  nextId: 1,
  jobs: [],
  timers: new Map()
};
const e2eGenerationAttempts = new Map();

function buildE2EGenerateResult({ phrase, cardType, requestedProvider, sourceMode }) {
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
      error.payload = {
        error: 'DeepSeek rate limited',
        code: 'MODEL_CAPACITY_EXHAUSTED'
      };
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
  const { targetDir, folderName } = ensureTodayDirectory();
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
    prompt: `E2E fixture prompt for ${String(phrase || '').trim()}`,
    observability,
    baseName,
    targetDir,
    folderName,
    fallback: null
  };
}

function cloneE2EKnowledgeJob(job) {
  return job ? JSON.parse(JSON.stringify(job)) : null;
}

function getE2EKnowledgeJob(jobId) {
  return cloneE2EKnowledgeJob(e2eKnowledgeJobs.jobs.find((job) => Number(job.id) === Number(jobId)) || null);
}

function listE2EKnowledgeJobs(limit = 20) {
  return e2eKnowledgeJobs.jobs
    .slice()
    .sort((a, b) => Number(b.id) - Number(a.id))
    .slice(0, Math.max(1, Number(limit || 20)))
    .map(cloneE2EKnowledgeJob);
}

function clearE2EKnowledgeTimers(jobId) {
  const timers = e2eKnowledgeJobs.timers.get(Number(jobId));
  if (timers) {
    timers.forEach((timer) => clearTimeout(timer));
    e2eKnowledgeJobs.timers.delete(Number(jobId));
  }
}

function scheduleE2EKnowledgeJob(jobId) {
  const runningTimer = setTimeout(() => {
    const job = e2eKnowledgeJobs.jobs.find((item) => Number(item.id) === Number(jobId));
    if (!job || job.status === 'cancelled') return;
    job.status = 'running';
    job.startedAt = job.startedAt || new Date().toISOString();
  }, 80);

  const successTimer = setTimeout(() => {
    const job = e2eKnowledgeJobs.jobs.find((item) => Number(item.id) === Number(jobId));
    if (!job || job.status === 'cancelled') return;
    job.status = 'success';
    job.startedAt = job.startedAt || new Date().toISOString();
    job.doneBatches = 1;
    job.errorBatches = 0;
    job.finishedAt = new Date().toISOString();
    job.resultSummary = {
      task: job.jobType,
      totalCards: 3,
      doneBatches: 1,
      errorBatches: 0,
      quality: {
        confidence: 1,
        coverageRatio: 1
      },
      resultShape: ['summary'],
      synonymStats: null
    };
    clearE2EKnowledgeTimers(jobId);
  }, 4000);

  e2eKnowledgeJobs.timers.set(Number(jobId), [runningTimer, successTimer]);
}

function createE2EKnowledgeJob(payload = {}) {
  const jobId = e2eKnowledgeJobs.nextId++;
  const createdAt = new Date().toISOString();
  const job = {
    id: jobId,
    jobType: String(payload.jobType || 'summary'),
    status: 'queued',
    scope: payload.scope || {},
    batchSize: Math.max(1, Number(payload.batchSize || 50)),
    triggeredBy: String(payload.triggeredBy || 'dashboard'),
    engineVersion: 'e2e-fixture',
    totalBatches: 1,
    doneBatches: 0,
    errorBatches: 0,
    resultSummary: null,
    createdAt,
    startedAt: null,
    finishedAt: null
  };
  e2eKnowledgeJobs.jobs.push(job);
  scheduleE2EKnowledgeJob(jobId);
  return cloneE2EKnowledgeJob(job);
}

function cancelE2EKnowledgeJob(jobId) {
  const job = e2eKnowledgeJobs.jobs.find((item) => Number(item.id) === Number(jobId));
  if (!job) return false;
  if (job.status === 'success' || job.status === 'failed' || job.status === 'cancelled') {
    return cloneE2EKnowledgeJob(job);
  }
  clearE2EKnowledgeTimers(jobId);
  job.status = 'cancelled';
  job.finishedAt = new Date().toISOString();
  return cloneE2EKnowledgeJob(job);
}

module.exports = {
  buildE2EGenerateResult,
  getE2EKnowledgeJob,
  listE2EKnowledgeJobs,
  createE2EKnowledgeJob,
  cancelE2EKnowledgeJob,
};
