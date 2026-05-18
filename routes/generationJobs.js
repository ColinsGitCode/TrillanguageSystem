'use strict';

const express = require('express');
const generationJobService = require('../services/generationJobService');
const { DEFAULT_GEMINI_MODEL, normalizeCardType, normalizeSourceMode } = require('../lib/serverConfig');

const router = express.Router();

router.post('/api/generation-jobs', async (req, res) => {
  try {
    const phrase = String(req.body?.phrase || '').trim();
    if (!phrase) {
      return res.status(400).json({ error: 'Phrase required' });
    }

    const jobType = normalizeCardType(req.body?.card_type || req.body?.job_type || 'trilingual');
    const sourceMode = normalizeSourceMode(req.body?.source_mode);
    const provider = 'gemini';
    const llmModel = DEFAULT_GEMINI_MODEL;
    const targetFolder = String(req.body?.target_folder || '').trim();
    const sourceContext = req.body?.source_context && typeof req.body.source_context === 'object'
      ? req.body.source_context
      : {};

    const job = generationJobService.enqueue({
      jobType,
      phraseRaw: phrase,
      phraseNormalized: phrase,
      sourceMode,
      targetFolder,
      provider,
      llmModel,
      sourceContext,
      createdByClient: req.get('user-agent') || 'browser',
      requestPayload: {
        phrase,
        llm_provider: provider,
        card_type: jobType,
        source_mode: sourceMode,
        target_folder: targetFolder,
        llm_model: llmModel || null,
        source_context: sourceContext
      }
    });

    return res.json({ success: true, job, summary: generationJobService.getSummary() });
  } catch (err) {
    const message = String(err?.message || 'enqueue generation job failed');
    const status = message === 'duplicate_active_generation_job' ? 409 : 500;
    return res.status(status).json({ error: message });
  }
});

router.get('/api/generation-jobs', (req, res) => {
  try {
    const limit = Number(req.query.limit || 30);
    const jobs = generationJobService.listJobs(limit);
    return res.json({ success: true, jobs });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

router.get('/api/generation-jobs/summary', (req, res) => {
  try {
    return res.json({ success: true, summary: generationJobService.getSummary() });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

router.get('/api/generation-jobs/events', (req, res) => {
  try {
    const jobId = Number(req.query.jobId || 0);
    const limit = Number(req.query.limit || 20);
    const events = generationJobService.listEvents({ jobId, limit });
    return res.json({ success: true, events });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

router.get('/api/generation-jobs/:id(\\d+)', (req, res) => {
  try {
    const jobId = Number(req.params.id || 0);
    const includeEvents = req.query.includeEvents !== '0';
    const eventLimit = Number(req.query.eventLimit || 80);
    const job = generationJobService.getJob(jobId);
    if (!job) {
      return res.status(404).json({ error: 'job not found' });
    }
    const events = includeEvents
      ? generationJobService.listEvents({ jobId, limit: eventLimit })
      : [];
    return res.json({ success: true, job, events });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

router.post('/api/generation-jobs/clear-done', (req, res) => {
  try {
    const result = generationJobService.clearCompleted();
    return res.json({ success: true, ...result, summary: generationJobService.getSummary() });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

router.post('/api/generation-jobs/:id/retry', (req, res) => {
  try {
    const job = generationJobService.retryJob(Number(req.params.id));
    if (!job) {
      return res.status(404).json({ error: 'job not retryable' });
    }
    return res.json({ success: true, job, summary: generationJobService.getSummary() });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

router.post('/api/generation-jobs/:id/cancel', (req, res) => {
  try {
    const job = generationJobService.cancelJob(Number(req.params.id));
    if (!job) {
      return res.status(404).json({ error: 'job not cancellable' });
    }
    return res.json({ success: true, job, summary: generationJobService.getSummary() });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

module.exports = router;
