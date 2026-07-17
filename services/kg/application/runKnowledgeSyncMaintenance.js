'use strict';

const { buildKnowledgeSyncPlan } = require('./buildKnowledgeSyncPlan');
const { processKnowledgeSyncJob } = require('./processKnowledgeSyncJob');
const jobs = require('../../storage/db/kgSourceSyncJobs');
const { sha256, stableJson } = require('../domain/knowledgeIdentity');

const REPORT_VERSION = 'kg-r2-incremental-sync-report-v1';

function normalizeHash(value) {
  const hash = String(value || '').trim().toLowerCase();
  if (!/^[a-f0-9]{64}$/u.test(hash)) throw new TypeError('expectedPlanHash must be a SHA-256 digest');
  return hash;
}

async function runKnowledgeSyncMaintenance({
  db,
  expectedPlanHash,
  now = () => new Date().toISOString(),
  processor = processKnowledgeSyncJob,
} = {}) {
  if (!db) throw new TypeError('runKnowledgeSyncMaintenance requires db');
  const expected = normalizeHash(expectedPlanHash);
  const plan = buildKnowledgeSyncPlan({ db });
  if (plan.planHash !== expected) {
    const error = new Error('The approved KG-R2 reconciliation plan no longer matches the current source snapshot');
    error.code = 'KG_SOURCE_SYNC_PLAN_MISMATCH';
    error.details = { expectedPlanHash: expected, actualPlanHash: plan.planHash };
    throw error;
  }
  const before = jobs.summary(db);
  const queued = jobs.enqueueJobs(db, plan.descriptors, {
    planHash: plan.planHash,
    now: now(),
    requeueTerminal: true,
  });
  const processed = [];
  let job;
  while ((job = jobs.claimNextJob(db, { now: now() }))) {
    try {
      const result = await processor({ db, job, now: now() });
      const status = result?.terminalStatus === 'superseded' ? 'superseded' : 'succeeded';
      jobs.finishJob(db, job.id, status, result, { now: now() });
      processed.push({ jobId: job.id, status, result });
    } catch (error) {
      jobs.failJob(db, job.id, error, { retryable: false, now: now() });
      processed.push({
        jobId: job.id,
        status: 'failed',
        errorCode: String(error?.code || 'KG_SOURCE_SYNC_FAILED'),
        errorMessage: String(error?.message || error),
      });
    }
  }
  const after = jobs.summary(db);
  const reportBody = {
    schemaVersion: REPORT_VERSION,
    mode: 'apply',
    planHash: plan.planHash,
    sourceSummary: plan.summary,
    queued: { inserted: queued.inserted, requeued: queued.requeued, existing: queued.existing },
    before,
    after,
    processed,
    overallPass: processed.every((entry) => entry.status !== 'failed') && after.failed === before.failed,
    completedAtUtc: now(),
  };
  return { ...reportBody, reportHash: sha256(stableJson(reportBody)) };
}

module.exports = {
  REPORT_VERSION,
  runKnowledgeSyncMaintenance,
};
