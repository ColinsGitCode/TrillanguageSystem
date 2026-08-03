'use strict';

const express = require('express');
const crypto = require('node:crypto');
const generationJobService = require('../services/generation/generationJobService');
const cardEngagementService = require('../services/cardEngagement/cardEngagementService');
const dbService = require('../services/storage/databaseService');
const { assertDuplicatePolicy, normalizeDuplicatePolicy } = require('../services/application/cardAdmission');
const { DEFAULT_DEEPSEEK_MODEL, normalizeCardType, normalizeSourceMode } = require('../lib/serverConfig');

const router = express.Router();

function interactionKey(value) {
  const supplied = String(value || '').trim();
  return /^[A-Za-z0-9][A-Za-z0-9._:-]{7,96}$/u.test(supplied)
    ? supplied
    : `generation:${crypto.randomUUID()}`;
}

function duplicateSummary(item, cardType) {
  return {
    generationId: Number(item.id),
    phrase: item.phrase,
    cardType: item.card_type || item.cardType || cardType,
    contentHash: item.content_hash || item.contentHash || null,
    folderName: item.folder_name || item.folderName || null,
    baseFilename: item.base_filename || item.baseFilename || null,
    generationDate: item.generation_date || item.generationDate || null,
    createdAt: item.created_at || item.createdAt || null,
  };
}

router.post('/api/generation-jobs/preflight', (req, res, next) => {
  try {
    const phrase = String(req.body?.phrase || '').trim();
    if (!phrase) return res.status(400).json({ error: 'Phrase required' });
    const jobType = normalizeCardType(req.body?.card_type || 'trilingual');
    const key = interactionKey(req.body?.interaction_key);
    const duplicates = dbService.findDuplicateGenerations(phrase, jobType);
    const activeJob = generationJobService.listJobs(100).find((job) => (
      (job.status === 'queued' || job.status === 'running')
      && job.jobType === jobType
      && job.phraseNormalized.trim() === phrase
    )) || null;
    cardEngagementService.record({
      eventKey: `${key}:requested`,
      phrase,
      cardType: jobType,
      eventKind: 'generation_requested',
      sourceSurface: 'cards_factory',
      metadata: { preflight: true },
    });
    if (duplicates.length) {
      cardEngagementService.record({
        eventKey: `${key}:duplicate`,
        generationId: Number(duplicates[0].id),
        phrase,
        cardType: jobType,
        eventKind: 'duplicate_card_hit',
        sourceSurface: 'cards_factory',
        metadata: { duplicateCount: duplicates.length, preflight: true },
      });
    }
    return res.json({
      success: true,
      interactionKey: key,
      duplicates: duplicates.map((item) => duplicateSummary(item, jobType)),
      activeJob,
    });
  } catch (error) {
    return next(error);
  }
});

router.post('/api/generation-jobs', async (req, res) => {
  let interaction = null;
  try {
    const phrase = String(req.body?.phrase || '').trim();
    if (!phrase) {
      return res.status(400).json({ error: 'Phrase required' });
    }

    const jobType = normalizeCardType(req.body?.card_type || req.body?.job_type || 'trilingual');
    const sourceMode = normalizeSourceMode(req.body?.source_mode);
    const provider = 'deepseek';
    const llmModel = DEFAULT_DEEPSEEK_MODEL;
    const targetFolder = String(req.body?.target_folder || '').trim();
    const duplicatePolicy = normalizeDuplicatePolicy(req.body?.duplicate_policy);
    const requestInteractionKey = interactionKey(req.body?.interaction_key);
    const preflightRecorded = req.body?.preflight_recorded === true;
    interaction = { phrase, jobType, interactionKey: requestInteractionKey, duplicatePolicy };
    if (!preflightRecorded) {
      cardEngagementService.record({
        eventKey: `${requestInteractionKey}:requested`,
        phrase,
        cardType: jobType,
        eventKind: 'generation_requested',
        sourceSurface: 'cards_factory',
        metadata: { sourceMode, duplicatePolicy },
      });
    }
    const duplicates = dbService.findDuplicateGenerations(phrase, jobType);
    if (!preflightRecorded && duplicates.length && duplicatePolicy !== 'create-version') {
      cardEngagementService.record({
        eventKey: `${requestInteractionKey}:duplicate`,
        generationId: Number(duplicates[0].id),
        phrase,
        cardType: jobType,
        eventKind: 'duplicate_card_hit',
        sourceSurface: 'cards_factory',
        metadata: { duplicateCount: duplicates.length },
      });
    }
    assertDuplicatePolicy({
      cardType: jobType,
      duplicates,
      duplicatePolicy,
    });
    if (duplicatePolicy === 'create-version') {
      cardEngagementService.record({
        eventKey: `${requestInteractionKey}:new-version`,
        generationId: duplicates[0] ? Number(duplicates[0].id) : null,
        phrase,
        cardType: jobType,
        eventKind: 'new_version_requested',
        sourceSurface: 'cards_factory',
        metadata: { existingVersionCount: duplicates.length },
      });
    }
    const sourceContext = req.body?.source_context && typeof req.body.source_context === 'object'
      ? req.body.source_context
      : {};

    const job = generationJobService.enqueue({
      jobType,
      phraseRaw: phrase,
      phraseNormalized: phrase,
      sourceMode,
      targetFolder,
      duplicatePolicy,
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
        duplicate_policy: duplicatePolicy,
        llm_model: llmModel,
        source_context: sourceContext
      }
    });

    return res.json({ success: true, job, summary: generationJobService.getSummary() });
  } catch (err) {
    const message = String(err?.message || 'enqueue generation job failed');
    if (message === 'duplicate_active_generation_job' && interaction) {
      try {
        cardEngagementService.record({
          eventKey: `${interaction.interactionKey}:active-duplicate`,
          phrase: interaction.phrase,
          cardType: interaction.jobType,
          eventKind: 'duplicate_card_hit',
          sourceSurface: 'cards_factory',
          metadata: { activeJob: true },
        });
      } catch (_recordError) {
        // The original queue conflict remains the user-facing error.
      }
    }
    const status = message === 'duplicate_active_generation_job' || err?.code === 'CARD_DUPLICATE_EXISTS'
      ? 409
      : err?.code === 'GENERATION_WORKER_SHUTTING_DOWN' ? 503 : Number(err?.status || 500);
    return res.status(status).json({ error: message, code: err?.code, details: err?.details });
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
