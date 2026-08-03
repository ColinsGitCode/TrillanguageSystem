'use strict';

const express = require('express');
const cardEngagementService = require('../services/cardEngagement/cardEngagementService');

const router = express.Router();

router.post('/api/card-engagement/events', (req, res, next) => {
  try {
    return res.json({ success: true, ...cardEngagementService.record(req.body || {}) });
  } catch (error) {
    return next(error);
  }
});

router.get('/api/card-engagement/generations/:id/stats', (req, res, next) => {
  try {
    return res.json({ success: true, stats: cardEngagementService.stats(req.params.id) });
  } catch (error) {
    return next(error);
  }
});

router.get('/api/card-engagement/today', (_req, res, next) => {
  try {
    return res.json({ success: true, ...cardEngagementService.today() });
  } catch (error) {
    return next(error);
  }
});

module.exports = router;
