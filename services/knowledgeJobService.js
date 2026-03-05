const dbService = require('./databaseService');
const { runTask } = require('./knowledgeAnalysisEngine');

const SUPPORTED_TASKS = new Set([
  'summary',
  'index',
  'synonym_boundary',
  'grammar_link',
  'cluster',
  'issues_audit'
]);

const BATCHABLE_TASKS = new Set(['index', 'issues_audit']);

function chunkArray(items, size) {
  if (!Array.isArray(items) || items.length === 0) return [];
  const chunkSize = Math.max(1, Number(size || 50));
  const chunks = [];
  for (let i = 0; i < items.length; i += chunkSize) {
    chunks.push(items.slice(i, i + chunkSize));
  }
  return chunks;
}

class KnowledgeJobService {
  constructor() {
    this.queue = [];
    this.running = false;
    this.cancelRequests = new Set();
  }

  validateTaskType(jobType) {
    const normalized = String(jobType || '').trim().toLowerCase();
    if (!SUPPORTED_TASKS.has(normalized)) {
      throw new Error(`Unsupported knowledge job type: ${jobType}`);
    }
    return normalized;
  }

  startJob(payload = {}) {
    const jobType = this.validateTaskType(payload.jobType);
    const scope = payload.scope || {};
    const batchSize = Math.max(1, Number(payload.batchSize || 50));
    const job = dbService.createKnowledgeJob({
      jobType,
      scope,
      batchSize,
      engineVersion: payload.engineVersion || 'local-v1',
      triggeredBy: payload.triggeredBy || 'owner'
    });

    this.queue.push(job.id);
    this.processQueue();
    return job;
  }

  listJobs(limit = 20) {
    return dbService.listKnowledgeJobs(limit);
  }

  getJob(jobId) {
    return dbService.getKnowledgeJobById(Number(jobId));
  }

  cancelJob(jobId) {
    const numericId = Number(jobId);
    if (!numericId) return false;
    const queueIndex = this.queue.indexOf(numericId);
    if (queueIndex >= 0) {
      this.queue.splice(queueIndex, 1);
    }
    this.cancelRequests.add(numericId);
    return dbService.cancelKnowledgeJob(numericId);
  }

  async processQueue() {
    if (this.running) return;
    const nextJobId = this.queue.shift();
    if (!nextJobId) return;

    this.running = true;
    try {
      await this.runJob(nextJobId);
    } catch (err) {
      console.error('[KnowledgeJob] process error:', err.message);
    } finally {
      this.running = false;
      if (this.queue.length > 0) {
        setTimeout(() => this.processQueue(), 0);
      }
    }
  }

  async runJob(jobId) {
    const job = dbService.getKnowledgeJobById(jobId);
    if (!job) return;
    if (job.status === 'cancelled') return;

    const scope = job.scope || {};
    const cards = dbService.getKnowledgeSourceCards(scope);
    const shouldBatch = BATCHABLE_TASKS.has(job.jobType);
    const batches = shouldBatch ? chunkArray(cards, job.batchSize) : [cards];
    const totalBatches = Math.max(1, batches.length);

    dbService.updateKnowledgeJobStatus(jobId, {
      status: 'running',
      startedAt: new Date().toISOString(),
      totalBatches,
      doneBatches: 0,
      errorBatches: 0,
      errorMessage: null
    });

    const aggregate = {
      task: job.jobType,
      status: 'ok',
      warnings: [],
      errors: [],
      quality: { confidence: 0, coverageRatio: 0 },
      result: {}
    };
    let doneBatches = 0;
    let errorBatches = 0;

    for (let index = 0; index < batches.length; index += 1) {
      if (this.cancelRequests.has(jobId)) {
        dbService.updateKnowledgeJobStatus(jobId, {
          status: 'cancelled',
          finishedAt: new Date().toISOString(),
          doneBatches,
          errorBatches
        });
        this.cancelRequests.delete(jobId);
        return;
      }

      const batchNo = index + 1;
      const batchCards = batches[index];
      const output = runTask(job.jobType, batchCards);
      const isFailed = output.status === 'failed';
      dbService.insertKnowledgeRawOutput(jobId, batchNo, {
        input: {
          cardCount: batchCards.length,
          scope: scope || {}
        },
        status: output.status,
        output,
        errorMessage: isFailed ? (output.errors || []).join('; ') : null
      });

      doneBatches += 1;
      if (isFailed) errorBatches += 1;
      this.mergeResult(aggregate, output);

      dbService.updateKnowledgeJobStatus(jobId, {
        doneBatches,
        errorBatches
      });
    }

    this.persistMaterialized(jobId, job.jobType, aggregate.result);

    const finalStatus = errorBatches === 0 ? 'success' : (doneBatches > errorBatches ? 'partial' : 'failed');
    dbService.updateKnowledgeJobStatus(jobId, {
      status: finalStatus,
      doneBatches,
      errorBatches,
      resultSummary: {
        task: job.jobType,
        totalCards: cards.length,
        doneBatches,
        errorBatches,
        quality: aggregate.quality,
        resultShape: Object.keys(aggregate.result || {})
      },
      finishedAt: new Date().toISOString()
    });
  }

  mergeResult(target, incoming) {
    if (!incoming) return;
    if (Array.isArray(incoming.warnings) && incoming.warnings.length) {
      target.warnings.push(...incoming.warnings);
    }
    if (Array.isArray(incoming.errors) && incoming.errors.length) {
      target.errors.push(...incoming.errors);
    }

    const incomingConfidence = Number(incoming.quality?.confidence || 0);
    const incomingCoverage = Number(incoming.quality?.coverageRatio || 0);
    target.quality.confidence = Math.max(target.quality.confidence, incomingConfidence);
    target.quality.coverageRatio = Math.max(target.quality.coverageRatio, incomingCoverage);

    const incomingResult = incoming.result || {};
    if (incomingResult.entries) {
      const list = target.result.entries || [];
      target.result.entries = list.concat(incomingResult.entries);
    } else if (incomingResult.issues) {
      const list = target.result.issues || [];
      target.result.issues = list.concat(incomingResult.issues);
    } else if (incomingResult.groups) {
      const list = target.result.groups || [];
      target.result.groups = list.concat(incomingResult.groups);
    } else if (incomingResult.patterns) {
      const list = target.result.patterns || [];
      target.result.patterns = list.concat(incomingResult.patterns);
    } else if (incomingResult.clusters) {
      const list = target.result.clusters || [];
      target.result.clusters = list.concat(incomingResult.clusters);
    } else {
      target.result = { ...target.result, ...incomingResult };
    }
  }

  persistMaterialized(jobId, jobType, result) {
    if (!result) return;
    switch (jobType) {
      case 'index':
        dbService.upsertKnowledgeTermsIndex(result.entries || [], jobId);
        break;
      case 'issues_audit':
        dbService.replaceKnowledgeIssues(result.issues || [], jobId);
        break;
      case 'synonym_boundary':
        dbService.replaceKnowledgeSynonymData(result.groups || [], jobId);
        break;
      case 'grammar_link':
        dbService.replaceKnowledgeGrammarData(result.patterns || [], jobId);
        break;
      case 'cluster':
        dbService.replaceKnowledgeClusterData(result.clusters || [], jobId);
        break;
      case 'summary':
      default:
        break;
    }
  }
}

module.exports = new KnowledgeJobService();
