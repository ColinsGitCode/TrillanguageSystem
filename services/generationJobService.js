const dbService = require('./databaseService');

class GenerationJobService {
  constructor() {
    this.running = false;
    this.executor = null;
    this.bootstrapDone = false;
  }

  configureExecutor(fn) {
    this.executor = typeof fn === 'function' ? fn : null;
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
        maxRetries: job.maxRetries
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

  async processQueue() {
    if (this.running || !this.executor) return;
    const nextJob = dbService.takeNextQueuedGenerationJob();
    if (!nextJob) return;

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
        sourceMode: result?.source_mode || nextJob.sourceMode || null,
        training: result?.training || null
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
      dbService.updateGenerationJob(nextJob.id, {
        status: 'failed',
        errorMessage: message,
        finishedAt: new Date().toISOString(),
        resultSummary: {
          success: false,
          status: Number(err?.status || 0) || null
        }
      });
      dbService.appendGenerationJobEvent(nextJob.id, 'failed', {
        error: message,
        status: Number(err?.status || 0) || null
      });
    } finally {
      this.running = false;
      setTimeout(() => this.processQueue(), 0);
    }
  }
}

module.exports = new GenerationJobService();
