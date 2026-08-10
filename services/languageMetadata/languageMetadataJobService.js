'use strict';

const defaultDbService = require('../storage/databaseService');
const {
  LANGUAGE_METADATA_ENABLED,
  LANGUAGE_METADATA_EXTRACTION_ENABLED,
} = require('../../lib/serverConfig');
const log = require('../../lib/logger').child({ module: 'svc/language-metadata-worker' });

class LanguageMetadataJobService {
  constructor(options = {}) {
    this.dbService = options.dbService || defaultDbService;
    this.enabled = options.enabled ?? (
      LANGUAGE_METADATA_ENABLED
      && LANGUAGE_METADATA_EXTRACTION_ENABLED
      && process.env.E2E_TEST_MODE !== '1'
    );
    this.processor = typeof options.processor === 'function' ? options.processor : null;
    this.pollIntervalMs = Math.max(1000, Number(options.pollIntervalMs || 30_000));
    this.retryDelayMs = Math.max(1000, Number(options.retryDelayMs || 5000));
    this.running = false;
    this.currentJobId = null;
    this.bootstrapDone = false;
    this.shuttingDown = false;
    this.timer = null;
    this.idleWaiters = new Set();
  }

  configureProcessor(processor) {
    this.processor = typeof processor === 'function' ? processor : null;
  }

  clearTimer() {
    if (!this.timer) return;
    clearTimeout(this.timer);
    this.timer = null;
  }

  schedule(delayMs = 0) {
    if (!this.enabled || this.shuttingDown || this.timer) return;
    this.timer = setTimeout(() => {
      this.timer = null;
      void this.processQueue();
    }, Math.max(0, Number(delayMs || 0)));
    this.timer.unref?.();
  }

  bootstrap() {
    if (!this.enabled || this.bootstrapDone) return { enabled: this.enabled, recovered: 0 };
    this.bootstrapDone = true;
    const recovered = this.dbService.recoverRunningLanguageMetadataJobs(new Date().toISOString());
    this.schedule(100);
    log.info({ recovered }, 'language metadata worker enabled');
    return { enabled: true, recovered };
  }

  notifyNewJob() {
    this.clearTimer();
    this.schedule();
  }

  notifyIdleWaiters() {
    if (this.running) return;
    for (const resolve of this.idleWaiters) resolve();
    this.idleWaiters.clear();
  }

  async processQueue() {
    if (!this.enabled || this.shuttingDown || this.running || !this.processor) return;
    let job;
    try {
      job = this.dbService.claimNextLanguageMetadataJob(new Date().toISOString());
    } catch (error) {
      log.warn({ err: error }, 'language metadata job claim failed');
      this.schedule(1000);
      return;
    }
    if (!job) {
      this.schedule(this.pollIntervalMs);
      return;
    }

    this.running = true;
    this.currentJobId = job.id;
    let retry = false;
    try {
      const result = await this.processor(job);
      retry = result?.status === 'failed';
    } catch (error) {
      retry = true;
      try {
        this.dbService.finishLanguageMetadataJob(job.id, {
          status: 'failed',
          lastErrorCode: error.code || 'WORKER_ERROR',
          nowUtc: new Date().toISOString(),
        });
      } catch (bookkeepingError) {
        log.error({ err: bookkeepingError, jobId: job.id }, 'language metadata worker bookkeeping failed');
      }
      log.error({ err: error, jobId: job.id }, 'language metadata worker failed');
    } finally {
      this.running = false;
      this.currentJobId = null;
      this.notifyIdleWaiters();
      this.schedule(retry ? this.retryDelayMs : 0);
    }
  }

  async shutdown({ timeoutMs = 30_000 } = {}) {
    this.shuttingDown = true;
    this.clearTimer();
    if (!this.running) return { drained: true, currentJobId: null };
    const activeJobId = this.currentJobId;
    let timeoutId;
    let idleResolver;
    const drained = await Promise.race([
      new Promise((resolve) => {
        idleResolver = () => resolve(true);
        this.idleWaiters.add(idleResolver);
      }),
      new Promise((resolve) => {
        timeoutId = setTimeout(() => resolve(false), Math.max(0, Number(timeoutMs || 0)));
      }),
    ]);
    if (timeoutId) clearTimeout(timeoutId);
    if (idleResolver) this.idleWaiters.delete(idleResolver);
    return { drained, currentJobId: drained ? null : activeJobId };
  }
}

const singleton = new LanguageMetadataJobService();
singleton.LanguageMetadataJobService = LanguageMetadataJobService;

module.exports = singleton;
