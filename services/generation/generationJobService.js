const dbService = require('../storage/databaseService');

class GenerationJobService {
  constructor() {
    this.running = false;
    this.executor = null;
    this.bootstrapDone = false;
    this.retryTimer = null;
  }

  configureExecutor(fn) {
    this.executor = typeof fn === 'function' ? fn : null;
  }

  // Test-only: drop the in-process scheduling state so the next test starts
  // with a fresh queue. Persistent rows are wiped separately via DB truncate.
  // Executor + bootstrapDone are left in place; they were configured by
  // server.js on listen() and shouldn't be re-bound.
  resetForTests() {
    this.clearRetryTimer();
    this.running = false;
  }

  bootstrap() {
    if (this.bootstrapDone) return;
    this.bootstrapDone = true;
    dbService.recoverStaleRunningGenerationJobs();
    setTimeout(() => this.processQueue(), 100);
  }

  enqueue(payload = {}) {
    const phraseNormalized = String(payload.phraseNormalized || '').trim();
    const jobType = String(payload.jobType || 'trilingual').trim() || 'trilingual';
    if (!phraseNormalized) {
      throw new Error('phraseNormalized is required');
    }
    if (dbService.hasActiveDuplicateGenerationJob(phraseNormalized, jobType)) {
      throw new Error('duplicate_active_generation_job');
    }

    const job = dbService.createGenerationJob(payload);
    dbService.appendGenerationJobEvent(job.id, 'created', {
      phrase: job.phraseNormalized,
      jobType: job.jobType,
      sourceMode: job.sourceMode,
      targetFolder: job.targetFolder,
      provider: job.provider,
      llmModel: job.llmModel
    });
    this.processQueue();
    return dbService.getGenerationJobById(job.id);
  }

  listJobs(limit = 30) {
    return dbService.listGenerationJobs(limit);
  }

  getJob(jobId) {
    return dbService.getGenerationJobById(Number(jobId || 0));
  }

  getSummary() {
    return dbService.getGenerationJobSummary();
  }

  listEvents({ jobId = 0, limit = 20 } = {}) {
    return dbService.listGenerationJobEvents({ jobId, limit });
  }

  retryJob(jobId) {
    const job = dbService.retryGenerationJob(Number(jobId || 0));
    if (job) {
      dbService.appendGenerationJobEvent(job.id, 'retry_scheduled', {
        attempts: job.attempts,
        maxRetries: job.maxRetries,
        manual: true
      });
      this.processQueue();
    }
    return job;
  }

  clearCompleted() {
    const cleared = dbService.clearCompletedGenerationJobs();
    return { cleared };
  }

  cancelJob(jobId) {
    const job = dbService.cancelGenerationJob(Number(jobId || 0));
    if (job) {
      dbService.appendGenerationJobEvent(job.id, 'cancelled', {
        status: job.status
      });
    }
    return job;
  }

  clearRetryTimer() {
    if (!this.retryTimer) return;
    clearTimeout(this.retryTimer);
    this.retryTimer = null;
  }

  scheduleRetryWakeup() {
    this.clearRetryTimer();
    const nextRetryTs = dbService.getNextQueuedGenerationRetryTs();
    if (!nextRetryTs) return;
    const delayMs = Math.max(0, nextRetryTs - Date.now());
    this.retryTimer = setTimeout(() => {
      this.retryTimer = null;
      this.processQueue();
    }, delayMs);
  }

  isTransientCapacityError(err) {
    const status = Number(err?.status || err?.payload?.status || 0) || 0;
    const payloadText = (() => {
      if (!err?.payload) return '';
      if (typeof err.payload === 'string') return err.payload;
      try {
        return JSON.stringify(err.payload);
      } catch {
        return '';
      }
    })();
    const haystack = `${String(err?.message || '')}\n${payloadText}`;
    const patterns = [
      /MODEL_CAPACITY_EXHAUSTED/i,
      /No capacity available for model/i,
      /Gemini CLI rate limited/i,
      /Gemini proxy error\s*\(429\)/i,
      /\brate limited\b/i
    ];
    return status === 429 || patterns.some((pattern) => pattern.test(haystack));
  }

  classifyTransientError(err) {
    const status = Number(err?.status || err?.payload?.status || 0) || null;
    const payloadText = (() => {
      if (!err?.payload) return '';
      if (typeof err.payload === 'string') return err.payload;
      try {
        return JSON.stringify(err.payload);
      } catch {
        return '';
      }
    })();
    const haystack = `${String(err?.message || '')}\n${payloadText}`;
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

  getRetryDelayMs(job) {
    const baseMs = Math.max(250, Number(process.env.GENERATION_JOB_TRANSIENT_RETRY_BASE_MS || 60_000));
    const maxMs = Math.max(baseMs, Number(process.env.GENERATION_JOB_TRANSIENT_RETRY_MAX_MS || 5 * 60_000));
    const exponent = Math.max(0, Number(job?.attempts || 1) - 1);
    return Math.min(maxMs, baseMs * (2 ** exponent));
  }

  async processQueue() {
    if (this.running || !this.executor) return;
    this.clearRetryTimer();
    const nextJob = dbService.takeNextQueuedGenerationJob();
    if (!nextJob) {
      this.scheduleRetryWakeup();
      return;
    }

    this.running = true;
    dbService.appendGenerationJobEvent(nextJob.id, 'picked', {
      attempts: nextJob.attempts,
      startedAt: nextJob.startedAt
    });

    try {
      const result = await this.executor(nextJob);
      const resultSummary = {
        success: Boolean(result?.success),
        generationId: result?.generationId || null,
        folder: result?.result?.folder || result?.resultFolder || '',
        baseName: result?.result?.baseName || result?.baseName || '',
        providerUsed: result?.provider_used || result?.providerUsed || '',
        modelUsed: result?.observability?.metadata?.model || result?.modelUsed || '',
        cardType: result?.card_type || nextJob.jobType,
        sourceMode: result?.source_mode || nextJob.sourceMode || null
      };

      dbService.updateGenerationJob(nextJob.id, {
        status: 'success',
        finishedAt: new Date().toISOString(),
        resultGenerationId: resultSummary.generationId,
        resultFolder: resultSummary.folder,
        resultBaseFilename: resultSummary.baseName,
        resultSummary
      });
      dbService.appendGenerationJobEvent(nextJob.id, 'succeeded', resultSummary);
    } catch (err) {
      const message = String(err?.message || 'generation job failed');
      const transient = this.classifyTransientError(err);
      const canRetry = transient.retryable && Number(nextJob.attempts || 0) < Number(nextJob.maxRetries || 0);

      if (canRetry) {
        const retryDelayMs = this.getRetryDelayMs(nextJob);
        const retryAfterTs = Date.now() + retryDelayMs;
        dbService.updateGenerationJob(nextJob.id, {
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
        dbService.appendGenerationJobEvent(nextJob.id, 'retry_scheduled', {
          error: message,
          status: transient.status,
          code: transient.code,
          retryDelayMs,
          retryAfterTs,
          attempts: nextJob.attempts,
          maxRetries: nextJob.maxRetries,
          manual: false
        });
      } else {
        dbService.updateGenerationJob(nextJob.id, {
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
        dbService.appendGenerationJobEvent(nextJob.id, 'failed', {
          error: message,
          status: transient.status,
          code: transient.code || null
        });
      }
    } finally {
      this.running = false;
      setTimeout(() => this.processQueue(), 0);
    }
  }
}

module.exports = new GenerationJobService();
