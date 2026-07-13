'use strict';

const defaultDbService = require('../storage/databaseService');
const { GENERATION_WORKER_SHUTDOWN_TIMEOUT_MS } = require('../../lib/serverConfig');
const { errorCodeOf, isRetriableCode } = require('../llm/llmErrors');
const log = require('../../lib/logger').child({ module: 'svc/generation-worker' });

class GenerationJobService {
  constructor(options = {}) {
    this.dbService = options.dbService || defaultDbService;
    this.executor = typeof options.executor === 'function' ? options.executor : null;
    this.running = false;
    this.currentJobId = null;
    this.bootstrapDone = false;
    this.shuttingDown = false;
    this.retryTimer = null;
    this.queueTimer = null;
    this.idleWaiters = new Set();
  }

  configureExecutor(fn) {
    this.executor = typeof fn === 'function' ? fn : null;
  }

  // Test-only: persistent rows are wiped separately via DB truncate.
  resetForTests() {
    this.clearRetryTimer();
    this.clearQueueTimer();
    this.running = false;
    this.currentJobId = null;
    this.shuttingDown = false;
    this.notifyIdleWaiters();
  }

  bootstrap() {
    if (this.bootstrapDone) return 0;
    this.bootstrapDone = true;
    const recovered = this.dbService.recoverStaleRunningGenerationJobs();
    this.scheduleProcess(100);
    return recovered;
  }

  enqueue(payload = {}) {
    if (this.shuttingDown) {
      const error = new Error('generation_worker_shutting_down');
      error.code = 'GENERATION_WORKER_SHUTTING_DOWN';
      throw error;
    }

    const phraseNormalized = String(payload.phraseNormalized || '').trim();
    const jobType = String(payload.jobType || 'trilingual').trim() || 'trilingual';
    if (!phraseNormalized) {
      throw new Error('phraseNormalized is required');
    }
    if (this.dbService.hasActiveDuplicateGenerationJob(phraseNormalized, jobType)) {
      throw new Error('duplicate_active_generation_job');
    }

    const job = this.dbService.createGenerationJob(payload);
    this.dbService.appendGenerationJobEvent(job.id, 'created', {
      phrase: job.phraseNormalized,
      jobType: job.jobType,
      sourceMode: job.sourceMode,
      targetFolder: job.targetFolder,
      provider: job.provider,
      llmModel: job.llmModel
    });
    this.scheduleProcess();
    return this.dbService.getGenerationJobById(job.id);
  }

  listJobs(limit = 30) {
    return this.dbService.listGenerationJobs(limit);
  }

  getJob(jobId) {
    return this.dbService.getGenerationJobById(Number(jobId || 0));
  }

  getSummary() {
    return this.dbService.getGenerationJobSummary();
  }

  listEvents({ jobId = 0, limit = 20 } = {}) {
    return this.dbService.listGenerationJobEvents({ jobId, limit });
  }

  retryJob(jobId) {
    if (this.shuttingDown) return null;
    const job = this.dbService.retryGenerationJob(Number(jobId || 0));
    if (job) {
      this.dbService.appendGenerationJobEvent(job.id, 'retry_scheduled', {
        attempts: job.attempts,
        maxRetries: job.maxRetries,
        manual: true
      });
      this.scheduleProcess();
    }
    return job;
  }

  clearCompleted() {
    const cleared = this.dbService.clearCompletedGenerationJobs();
    return { cleared };
  }

  cancelJob(jobId) {
    const job = this.dbService.cancelGenerationJob(Number(jobId || 0));
    if (job) {
      this.dbService.appendGenerationJobEvent(job.id, 'cancelled', {
        status: job.status
      });
    }
    return job;
  }

  clearQueueTimer() {
    if (!this.queueTimer) return;
    clearTimeout(this.queueTimer);
    this.queueTimer = null;
  }

  scheduleProcess(delayMs = 0) {
    if (this.shuttingDown || this.queueTimer) return;
    this.queueTimer = setTimeout(() => {
      this.queueTimer = null;
      void this.processQueue();
    }, Math.max(0, Number(delayMs || 0)));
    this.queueTimer.unref?.();
  }

  clearRetryTimer() {
    if (!this.retryTimer) return;
    clearTimeout(this.retryTimer);
    this.retryTimer = null;
  }

  scheduleRetryWakeup() {
    this.clearRetryTimer();
    if (this.shuttingDown) return;
    const nextRetryTs = this.dbService.getNextQueuedGenerationRetryTs();
    if (!nextRetryTs) return;
    const delayMs = Math.max(0, nextRetryTs - Date.now());
    this.retryTimer = setTimeout(() => {
      this.retryTimer = null;
      this.scheduleProcess();
    }, delayMs);
    this.retryTimer.unref?.();
  }

  isTransientCapacityError(err) {
    const status = Number(err?.status || err?.payload?.status || 0) || 0;
    const payloadText = this.getErrorPayloadText(err);
    const haystack = `${String(err?.message || '')}\n${payloadText}`;
    const patterns = [
      /MODEL_CAPACITY_EXHAUSTED/i,
      /No capacity available for model/i,
      /\brate[-\s_]?limit(?:ed)?\b/i
    ];
    return status === 429 || patterns.some((pattern) => pattern.test(haystack));
  }

  getErrorPayloadText(err) {
    if (!err?.payload) return '';
    if (typeof err.payload === 'string') return err.payload;
    try {
      return JSON.stringify(err.payload);
    } catch {
      return '';
    }
  }

  classifyTransientError(err) {
    const sqliteCode = String(err?.code || '').toUpperCase();
    if (sqliteCode === 'SQLITE_BUSY' || sqliteCode === 'SQLITE_LOCKED') {
      return { retryable: true, code: 'SQLITE_BUSY', status: null };
    }

    const status = Number(err?.status || err?.payload?.status || 0) || null;
    const providerCode = errorCodeOf(err);
    if (isRetriableCode(providerCode)) {
      return { retryable: true, code: providerCode, status };
    }

    const haystack = `${String(err?.message || '')}\n${this.getErrorPayloadText(err)}`;
    if (this.isTransientCapacityError(err)) {
      return {
        retryable: true,
        code: /MODEL_CAPACITY_EXHAUSTED|No capacity available for model/i.test(haystack)
          ? 'MODEL_CAPACITY_EXHAUSTED'
          : 'RATE_LIMITED',
        status
      };
    }
    return { retryable: false, code: '', status };
  }

  getRetryDelayMs(job, transientCode = '') {
    const sqliteRetry = transientCode === 'SQLITE_BUSY';
    const defaultBaseMs = sqliteRetry ? 500 : 60_000;
    const defaultMaxMs = sqliteRetry ? 5_000 : 5 * 60_000;
    const baseEnv = sqliteRetry
      ? process.env.GENERATION_JOB_SQLITE_RETRY_BASE_MS
      : process.env.GENERATION_JOB_TRANSIENT_RETRY_BASE_MS;
    const maxEnv = sqliteRetry
      ? process.env.GENERATION_JOB_SQLITE_RETRY_MAX_MS
      : process.env.GENERATION_JOB_TRANSIENT_RETRY_MAX_MS;
    const baseMs = Math.max(250, Number(baseEnv || defaultBaseMs));
    const maxMs = Math.max(baseMs, Number(maxEnv || defaultMaxMs));
    const exponent = Math.max(0, Number(job?.attempts || 1) - 1);
    return Math.min(maxMs, baseMs * (2 ** exponent));
  }

  notifyIdleWaiters() {
    if (this.running) return;
    for (const resolve of this.idleWaiters) resolve();
    this.idleWaiters.clear();
  }

  async shutdown(options = {}) {
    const timeoutMs = Math.max(
      0,
      Number(options.timeoutMs ?? GENERATION_WORKER_SHUTDOWN_TIMEOUT_MS)
    );
    this.shuttingDown = true;
    this.clearRetryTimer();
    this.clearQueueTimer();

    if (!this.running) {
      return { drained: true, currentJobId: null };
    }

    const activeJobId = this.currentJobId;
    let timeoutId;
    let idleResolver;
    const drained = await Promise.race([
      new Promise((resolve) => {
        idleResolver = () => resolve(true);
        this.idleWaiters.add(idleResolver);
      }),
      new Promise((resolve) => {
        timeoutId = setTimeout(() => resolve(false), timeoutMs);
      })
    ]);
    if (timeoutId) clearTimeout(timeoutId);
    if (idleResolver) this.idleWaiters.delete(idleResolver);
    return { drained, currentJobId: drained ? null : activeJobId };
  }

  persistJobFailure(nextJob, err) {
    const message = String(err?.message || 'generation job failed');
    const transient = this.classifyTransientError(err);
    const canRetry = transient.retryable
      && Number(nextJob.attempts || 0) < Number(nextJob.maxRetries || 0);

    if (canRetry) {
      const retryDelayMs = this.getRetryDelayMs(nextJob, transient.code);
      const retryAfterTs = Date.now() + retryDelayMs;
      this.dbService.updateGenerationJob(nextJob.id, {
        status: 'queued',
        errorMessage: message,
        retryAfterTs,
        startedAt: null,
        finishedAt: null,
        resultSummary: {
          success: false,
          transient: true,
          status: transient.status,
          code: transient.code,
          retryDelayMs,
          retryAfterTs
        }
      });
      this.dbService.appendGenerationJobEvent(nextJob.id, 'retry_scheduled', {
        error: message,
        status: transient.status,
        code: transient.code,
        retryDelayMs,
        retryAfterTs,
        attempts: nextJob.attempts,
        maxRetries: nextJob.maxRetries,
        manual: false
      });
      return;
    }

    this.dbService.updateGenerationJob(nextJob.id, {
      status: 'failed',
      errorMessage: message,
      retryAfterTs: null,
      finishedAt: new Date().toISOString(),
      resultSummary: {
        success: false,
        status: transient.status,
        code: transient.code || null
      }
    });
    this.dbService.appendGenerationJobEvent(nextJob.id, 'failed', {
      error: message,
      status: transient.status,
      code: transient.code || null
    });
  }

  async processQueue() {
    if (this.shuttingDown || this.running || !this.executor) return;
    this.clearRetryTimer();

    let nextJob;
    try {
      nextJob = this.dbService.takeNextQueuedGenerationJob();
    } catch (err) {
      log.warn({ err }, 'generation queue claim failed; retrying');
      this.scheduleProcess(this.getRetryDelayMs(null, 'SQLITE_BUSY'));
      return;
    }

    if (!nextJob) {
      try {
        this.scheduleRetryWakeup();
      } catch (err) {
        log.warn({ err }, 'generation retry schedule lookup failed; retrying');
        this.scheduleProcess(this.getRetryDelayMs(null, 'SQLITE_BUSY'));
      }
      return;
    }

    this.running = true;
    this.currentJobId = nextJob.id;

    try {
      this.dbService.appendGenerationJobEvent(nextJob.id, 'picked', {
        attempts: nextJob.attempts,
        startedAt: nextJob.startedAt
      });

      const result = await this.executor(nextJob);
      const resultSummary = {
        success: Boolean(result?.success),
        generationId: result?.generationId || null,
        folder: result?.result?.folder || result?.resultFolder || '',
        baseName: result?.result?.baseName || result?.baseName || '',
        providerUsed: result?.provider_used || result?.providerUsed || '',
        modelUsed: result?.observability?.metadata?.model || result?.modelUsed || '',
        cardType: result?.card_type || nextJob.jobType,
        sourceMode: result?.source_mode || nextJob.sourceMode || null,
        admissionStatus: result?.admission?.status || null,
        duplicatePolicy: result?.duplicate_policy || nextJob.duplicatePolicy || 'reject'
      };

      this.dbService.updateGenerationJob(nextJob.id, {
        status: 'success',
        finishedAt: new Date().toISOString(),
        resultGenerationId: resultSummary.generationId,
        resultFolder: resultSummary.folder,
        resultBaseFilename: resultSummary.baseName,
        resultSummary
      });
      this.dbService.appendGenerationJobEvent(nextJob.id, 'succeeded', resultSummary);
    } catch (err) {
      try {
        this.persistJobFailure(nextJob, err);
      } catch (persistenceError) {
        log.error({
          err: persistenceError,
          jobId: nextJob.id,
          executionError: String(err?.message || err),
        }, 'generation job failure state could not be persisted; startup recovery will requeue it');
      }
    } finally {
      this.running = false;
      this.currentJobId = null;
      this.notifyIdleWaiters();
      this.scheduleProcess();
    }
  }
}

const generationJobService = new GenerationJobService();

module.exports = generationJobService;
module.exports.GenerationJobService = GenerationJobService;
