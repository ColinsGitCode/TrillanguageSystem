'use strict';

const express = require('express');
const {
  knowledgeJobService,
  dbService,
  E2E_TEST_MODE,
  getE2EKnowledgeJob,
  listE2EKnowledgeJobs,
  createE2EKnowledgeJob,
  cancelE2EKnowledgeJob,
} = require('./_shared');

const router = express.Router();

router.post('/api/knowledge/jobs/start', (req, res) => {
  try {
    const {
      jobType,
      scope = {},
      batchSize = 50,
      triggeredBy = 'owner',
      options = {}
    } = req.body || {};

    if (!jobType) {
      return res.status(400).json({ error: 'jobType is required' });
    }

    if (E2E_TEST_MODE) {
      const job = createE2EKnowledgeJob({
        jobType,
        scope,
        batchSize,
        triggeredBy
      });
      return res.json({ success: true, job });
    }

    const normalizedScope = {
      folderFrom: scope.folderFrom || null,
      folderTo: scope.folderTo || null,
      cardTypes: Array.isArray(scope.cardTypes) ? scope.cardTypes : undefined,
      limit: scope.limit ? Number(scope.limit) : undefined
    };

    const job = knowledgeJobService.startJob({
      jobType,
      scope: normalizedScope,
      batchSize: Number(batchSize || 50),
      triggeredBy: String(triggeredBy || 'owner'),
      options: {
        minCandidateScore: options.minCandidateScore,
        maxPairs: options.maxPairs,
        maxLlmPairs: options.maxLlmPairs,
        llmEnabled: options.llmEnabled,
        model: options.model,
        promptVersion: options.promptVersion,
        schemaVersion: options.schemaVersion,
        llmTimeoutMs: options.llmTimeoutMs
      }
    });
    return res.json({ success: true, job });
  } catch (err) {
    return res.status(400).json({ error: err.message });
  }
});

router.get('/api/knowledge/jobs', (req, res) => {
  try {
    const limit = Number(req.query.limit || 20);
    if (E2E_TEST_MODE) {
      return res.json({ success: true, jobs: listE2EKnowledgeJobs(limit) });
    }
    const jobs = knowledgeJobService.listJobs(limit);
    res.json({ success: true, jobs });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/api/knowledge/jobs/:id', (req, res) => {
  try {
    const jobId = Number(req.params.id);
    if (!jobId) return res.status(400).json({ error: 'invalid job id' });
    if (E2E_TEST_MODE) {
      const job = getE2EKnowledgeJob(jobId);
      if (!job) return res.status(404).json({ error: 'job not found' });
      return res.json({ success: true, job });
    }
    const job = knowledgeJobService.getJob(jobId);
    if (!job) return res.status(404).json({ error: 'job not found' });
    res.json({ success: true, job });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/api/knowledge/jobs/:id/cancel', (req, res) => {
  try {
    const jobId = Number(req.params.id);
    if (!jobId) return res.status(400).json({ error: 'invalid job id' });
    if (E2E_TEST_MODE) {
      const cancelled = cancelE2EKnowledgeJob(jobId);
      return res.json({ success: true, cancelled: Boolean(cancelled) });
    }
    const cancelled = knowledgeJobService.cancelJob(jobId);
    res.json({ success: true, cancelled });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/api/knowledge/index', (req, res) => {
  try {
    const query = String(req.query.query || '');
    const limit = Number(req.query.limit || 100);
    const entries = dbService.getKnowledgeIndex({ query, limit });
    res.json({ success: true, entries });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Knowledge-base learner browse: paginated/filterable term library.
router.get('/api/knowledge/base/terms', (req, res) => {
  try {
    const pageSize = Math.min(200, Math.max(1, Number(req.query.pageSize || 20)));
    const page = Math.max(1, Number(req.query.page || 1));
    const result = dbService.listKnowledgeBaseTerms({
      query: String(req.query.query || ''),
      langProfile: String(req.query.langProfile || ''),
      cardType: String(req.query.cardType || ''),
      tag: String(req.query.tag || ''),
      clusterKey: String(req.query.category || req.query.clusterKey || ''),
      uncategorized: ['1', 'true', 'yes'].includes(String(req.query.uncategorized || '').toLowerCase()),
      difficulty: String(req.query.difficulty || ''),
      sort: String(req.query.sort || 'recent'),
      limit: pageSize,
      offset: (page - 1) * pageSize
    });
    res.json({ success: true, ...result, page, pageSize });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Semantic-classification category navigation for the knowledge-base browse
// panel. taxonomy = function (grammar axis) | topic (vocab axis) | all.
router.get('/api/knowledge/base/categories', (req, res) => {
  try {
    const categories = dbService.getKnowledgeCategories({
      taxonomy: String(req.query.taxonomy || 'all')
    });
    res.json({ success: true, categories });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Knowledge-base landing aggregate: totals + breakdowns by language / card
// type / top tags.
router.get('/api/knowledge/base/overview', (req, res) => {
  try {
    const overview = dbService.getKnowledgeBaseOverview({
      topTagLimit: Number(req.query.topTagLimit || 20)
    });
    res.json({ success: true, overview });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/api/knowledge/synonyms', (req, res) => {
  try {
    const phrase = String(req.query.phrase || '');
    if (!phrase) return res.status(400).json({ error: 'phrase is required' });
    const limit = Number(req.query.limit || 20);
    const groups = dbService.getKnowledgeSynonymsByPhrase(phrase, limit);
    res.json({ success: true, groups });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/api/knowledge/synonyms/list', (req, res) => {
  try {
    const page = Number(req.query.page || 1);
    const pageSize = Number(req.query.pageSize || 20);
    const jobId = req.query.jobId ? Number(req.query.jobId) : undefined;
    const riskLevel = req.query.riskLevel ? String(req.query.riskLevel) : undefined;
    const query = req.query.query ? String(req.query.query) : '';
    const data = dbService.listKnowledgeSynonymBoundaries({
      jobId,
      riskLevel,
      query,
      page,
      pageSize
    });
    res.json({ success: true, ...data });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/api/knowledge/synonyms/:pairKey', (req, res) => {
  try {
    const pairKey = String(req.params.pairKey || '').trim();
    if (!pairKey) return res.status(400).json({ error: 'pairKey is required' });
    const jobId = req.query.jobId ? Number(req.query.jobId) : undefined;
    const detail = dbService.getKnowledgeSynonymBoundaryDetail({ pairKey, jobId });
    if (!detail) return res.status(404).json({ error: 'synonym boundary not found' });
    res.json({ success: true, detail });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/api/knowledge/grammar', (req, res) => {
  try {
    const pattern = String(req.query.pattern || '');
    const limit = Number(req.query.limit || 30);
    const patterns = dbService.getKnowledgeGrammarPatterns({ pattern, limit });
    res.json({ success: true, patterns });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/api/knowledge/clusters', (req, res) => {
  try {
    const limit = Number(req.query.limit || 20);
    const clusters = dbService.getKnowledgeClusters(limit);
    res.json({ success: true, clusters });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/api/knowledge/issues', (req, res) => {
  try {
    const issueType = req.query.issueType ? String(req.query.issueType) : undefined;
    const severity = req.query.severity ? String(req.query.severity) : undefined;
    const resolved = req.query.resolved === undefined
      ? undefined
      : ['1', 'true', 'yes'].includes(String(req.query.resolved).toLowerCase());
    const limit = Number(req.query.limit || 100);
    const issues = dbService.getKnowledgeIssues({ issueType, severity, resolved, limit });
    res.json({ success: true, issues });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/api/knowledge/overview', (req, res) => {
  try {
    const limit = Number(req.query.limit || 8);
    const overview = dbService.getKnowledgeOverview({ limit });
    res.json({ success: true, overview });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/api/knowledge/cards/:generationId/relations', (req, res) => {
  try {
    const generationId = Number(req.params.generationId);
    if (!generationId) return res.status(400).json({ error: 'invalid generation id' });
    const limit = Number(req.query.limit || 12);
    const relations = dbService.getKnowledgeCardRelations(generationId, { limit });
    if (!relations) return res.status(404).json({ error: 'card not found' });
    res.json({ success: true, relations });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/api/knowledge/terms/:term/relations', (req, res) => {
  try {
    const term = String(req.params.term || '').trim();
    if (!term) return res.status(400).json({ error: 'term is required' });
    const limit = Number(req.query.limit || 20);
    const relations = dbService.getKnowledgeTermRelations(term, { limit });
    res.json({ success: true, relations });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/api/knowledge/patterns/:pattern/relations', (req, res) => {
  try {
    const pattern = String(req.params.pattern || '').trim();
    if (!pattern) return res.status(400).json({ error: 'pattern is required' });
    const limit = Number(req.query.limit || 20);
    const relations = dbService.getKnowledgePatternRelations(pattern, { limit });
    res.json({ success: true, relations });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/api/knowledge/clusters/:clusterKey/relations', (req, res) => {
  try {
    const clusterKey = String(req.params.clusterKey || '').trim();
    if (!clusterKey) return res.status(400).json({ error: 'clusterKey is required' });
    const limit = Number(req.query.limit || 20);
    const relations = dbService.getKnowledgeClusterRelations(clusterKey, { limit });
    res.json({ success: true, relations });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/api/knowledge/summary/latest', (req, res) => {
  try {
    const summary = dbService.getLatestKnowledgeSummary();
    res.json({ success: true, summary: summary || null });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
