'use strict';

const express = require('express');
const dbService = require('../services/storage/databaseService');
const { LocalGlossaryService } = require('../services/localGlossary/localGlossaryService');

const router = express.Router();
const service = new LocalGlossaryService({ database: dbService });

router.get('/api/local-glossary/lookup', async (req, res, next) => {
  try {
    const lookup = await service.lookup({
      text: req.query.text,
      language: req.query.language,
      generationId: req.query.generationId,
      reading: req.query.reading,
      context: req.query.context,
    });
    return res.json({ success: true, lookup });
  } catch (error) { return next(error); }
});

router.get('/api/local-glossary/entries', async (req, res, next) => {
  try {
    const entries = await service.listEntries({
      language: req.query.language,
      query: req.query.query,
      includeArchived: req.query.includeArchived === '1',
      limit: req.query.limit,
    });
    return res.json({ success: true, entries });
  } catch (error) { return next(error); }
});

router.get('/api/local-glossary/catalog', (req, res, next) => {
  try {
    return res.json({ success: true, catalog: service.catalog() });
  } catch (error) { return next(error); }
});

// DIC-R2: the only write path for usage facts. GET /lookup stays read-only, so
// nothing is recorded unless the client explicitly submits an outcome here.
router.post('/api/local-glossary/feedback', async (req, res, next) => {
  try {
    const result = await service.recordFeedback(req.body || {});
    return res.status(201).json({ success: true, ...result });
  } catch (error) { return next(error); }
});

router.get('/api/local-glossary/feedback/stats', (req, res, next) => {
  try {
    const stats = service.feedbackStats({
      language: req.query.language,
      since: req.query.since,
      limit: req.query.limit,
    });
    return res.json({ success: true, stats });
  } catch (error) { return next(error); }
});

router.post('/api/local-glossary/entries', async (req, res, next) => {
  try {
    const entry = await service.createEntry({ ...req.body, sourceKind: 'manual' });
    return res.status(201).json({ success: true, entry });
  } catch (error) { return next(error); }
});

router.patch('/api/local-glossary/entries/:id', async (req, res, next) => {
  try {
    const entry = await service.updateEntry(req.params.id, req.body || {});
    return res.json({ success: true, entry });
  } catch (error) { return next(error); }
});

router.delete('/api/local-glossary/entries/:id', (req, res, next) => {
  try {
    const entry = service.archiveEntry(req.params.id, req.body || {});
    return res.json({ success: true, entry });
  } catch (error) { return next(error); }
});

router.post('/api/local-glossary/entries/:id/restore', (req, res, next) => {
  try {
    const entry = service.restoreEntry(req.params.id, req.body || {});
    return res.json({ success: true, entry });
  } catch (error) { return next(error); }
});

router.post('/api/local-glossary/proposals', async (req, res, next) => {
  try {
    const result = await service.propose(req.body || {});
    return res.status(result.idempotent ? 200 : 201).json({ success: true, ...result });
  } catch (error) { return next(error); }
});

router.post('/api/local-glossary/proposals/:id/accept', async (req, res, next) => {
  try {
    const result = await service.acceptProposal(req.params.id, req.body || {});
    return res.json({ success: true, ...result });
  } catch (error) { return next(error); }
});

router.post('/api/local-glossary/proposals/:id/reject', (req, res, next) => {
  try {
    const result = service.rejectProposal(req.params.id);
    return res.json({ success: true, ...result });
  } catch (error) { return next(error); }
});

module.exports = router;
