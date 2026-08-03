'use strict';

const express = require('express');
const dbService = require('../services/storage/databaseService');
const { ManualTagService } = require('../services/manualTags/manualTagService');

const router = express.Router();
const service = new ManualTagService({ database: dbService });

router.get('/api/manual-tags', (req, res, next) => {
  try {
    const result = service.list({
      targetKind: req.query.targetKind,
      targetId: req.query.targetId,
      includeArchived: req.query.includeArchived === '1',
    });
    return res.json({ success: true, ...result });
  } catch (error) { return next(error); }
});

router.post('/api/manual-tags', (req, res, next) => {
  try {
    return res.status(201).json({ success: true, tag: service.create(req.body || {}) });
  } catch (error) { return next(error); }
});

router.patch('/api/manual-tags/:id', (req, res, next) => {
  try {
    return res.json({ success: true, tag: service.update(req.params.id, req.body || {}) });
  } catch (error) { return next(error); }
});

router.delete('/api/manual-tags/:id', (req, res, next) => {
  try {
    return res.json({ success: true, tag: service.archive(req.params.id, req.body || {}) });
  } catch (error) { return next(error); }
});

router.put('/api/manual-tags/assignments/current', (req, res, next) => {
  try {
    return res.json({ success: true, ...service.replaceAssignments(req.body || {}) });
  } catch (error) { return next(error); }
});

router.get('/api/manual-tags/:id/targets', (req, res, next) => {
  try {
    return res.json({ success: true, ...service.listTargets(req.params.id, req.query) });
  } catch (error) { return next(error); }
});

module.exports = router;
