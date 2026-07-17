'use strict';

const defaultDbService = require('../storage/databaseService');
const { KG_INCREMENTAL_SYNC_ENABLED, KG_ENABLED } = require('../../lib/serverConfig');
const { buildKnowledgeSyncPlan } = require('./application/buildKnowledgeSyncPlan');
const { processKnowledgeSyncJob } = require('./application/processKnowledgeSyncJob');
const log = require('../../lib/logger').child({ module: 'svc/kg-source-sync' });

class KgSourceSyncService {
  constructor(options = {}) {
    this.dbService = options.dbService || defaultDbService;
    this.enabled = options.enabled ?? (KG_ENABLED && KG_INCREMENTAL_SYNC_ENABLED && process.env.E2E_TEST_MODE !== '1');
    this.processor = options.processor || ((job) => processKnowledgeSyncJob({ db: this.dbService.db, job }));
    this.pollIntervalMs = Math.max(1000, Number(options.pollIntervalMs || 30_000));
    this.running = false;
    this.currentJobId = null;
    this.bootstrapDone = false;
    this.shuttingDown = false;
    this.timer = null;
    this.idleWaiters = new Set();
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

  reconcile() {
    const plan = buildKnowledgeSyncPlan({ db: this.dbService.db });
    const queued = this.dbService.enqueueKgSourceSyncJobs(plan.descriptors, {
      planHash: plan.planHash,
      requeueTerminal: true,
    });
    return { plan, queued };
  }

  bootstrap() {
    if (!this.enabled || this.bootstrapDone) return { enabled: this.enabled, recovered: 0, queued: 0 };
    this.bootstrapDone = true;
    const recovered = this.dbService.recoverStaleKgSourceSyncJobs();
    const reconciliation = this.reconcile();
    this.schedule(100);
    log.info({
      recovered,
      planned: reconciliation.plan.descriptors.length,
      queued: reconciliation.queued.inserted,
    }, 'KG incremental source sync enabled');
    return { enabled: true, recovered, queued: reconciliation.queued.inserted };
  }

  retryDelayMs(job) {
    return Math.min(5 * 60_000, 5000 * (2 ** Math.max(0, Number(job?.attempts || 1) - 1)));
  }

  notifyIdleWaiters() {
    if (this.running) return;
    for (const resolve of this.idleWaiters) resolve();
    this.idleWaiters.clear();
  }

  scheduleNextWakeup() {
    const retryAt = this.dbService.getNextKgSourceSyncRetryTs();
    if (retryAt != null) {
      this.schedule(Math.max(0, retryAt - Date.now()));
      return;
    }
    this.schedule(this.pollIntervalMs);
  }

  async processQueue() {
    if (!this.enabled || this.shuttingDown || this.running) return;
    let job;
    try {
      job = this.dbService.claimNextKgSourceSyncJob();
    } catch (error) {
      log.warn({ err: error }, 'KG sync job claim failed');
      this.schedule(1000);
      return;
    }
    if (!job) {
      try {
        this.reconcile();
      } catch (error) {
        log.warn({ err: error }, 'KG reconciliation failed');
      }
      this.scheduleNextWakeup();
      return;
    }

    this.running = true;
    this.currentJobId = job.id;
    try {
      const result = await this.processor(job);
      this.dbService.finishKgSourceSyncJob(
        job.id,
        result?.terminalStatus === 'superseded' ? 'superseded' : 'succeeded',
        result || {}
      );
    } catch (error) {
      const retryable = !['KG_EVENT_KEY_CONFLICT', 'KG_SOURCE_SYNC_INVALID'].includes(String(error?.code || ''));
      this.dbService.failKgSourceSyncJob(job.id, error, {
        retryable,
        retryAfterTs: Date.now() + this.retryDelayMs(job),
      });
      log.error({ err: error, jobId: job.id }, 'KG source sync job failed');
    } finally {
      this.running = false;
      this.currentJobId = null;
      this.notifyIdleWaiters();
      this.schedule();
    }
  }

  async shutdown(options = {}) {
    this.shuttingDown = true;
    this.clearTimer();
    if (!this.running) return { drained: true, currentJobId: null };
    const timeoutMs = Math.max(0, Number(options.timeoutMs || 30_000));
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
      }),
    ]);
    if (timeoutId) clearTimeout(timeoutId);
    if (idleResolver) this.idleWaiters.delete(idleResolver);
    return { drained, currentJobId: drained ? null : activeJobId };
  }
}

const singleton = new KgSourceSyncService();
singleton.KgSourceSyncService = KgSourceSyncService;

module.exports = singleton;
