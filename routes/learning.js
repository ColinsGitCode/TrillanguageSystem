'use strict';

const express = require('express');
const dbService = require('../services/storage/databaseService');
const { LearningService } = require('../services/learning/application/learningService');

const router = express.Router();
const service = new LearningService({
  db: dbService.db,
  busyRetry: (operation) => dbService.withBusyRetry(operation),
});

function send(res, payload) {
  return res.json({ success: true, ...payload });
}

function route(handler) {
  return (req, res, next) => {
    try {
      return handler(req, res);
    } catch (error) {
      return next(error);
    }
  };
}

router.get('/api/learning/plan', route((_req, res) => send(res, service.getPlan())));
router.put('/api/learning/plan', route((req, res) => send(res, service.putPlan(req.body))));
router.post('/api/learning/plan/preview', route((req, res) => send(res, service.previewPlan(req.body))));
router.post('/api/learning/plan/pause', route((_req, res) => send(res, service.setPlanStatus('paused'))));
router.post('/api/learning/plan/resume', route((_req, res) => send(res, service.setPlanStatus('active'))));
router.get('/api/learning/scope-options', route((_req, res) => send(res, service.getScopeOptions())));

router.post('/api/learning/queues/today', route((_req, res) => send(res, { queue: service.ensureTodayQueue() })));
router.get('/api/learning/queues/today', route((_req, res) => send(res, service.getTodayQueue())));

router.get('/api/learning/sessions/active', route((_req, res) => send(res, service.getActiveSession())));
router.post('/api/learning/sessions', route((req, res) => send(res, service.startSession(req.body))));
router.post('/api/learning/sessions/:id/reveal', route((req, res) => send(res, service.reveal(req.params.id, req.body))));
router.post('/api/learning/sessions/:id/reviews', route((req, res) => send(res, service.submitReview(req.params.id, req.body))));
router.post('/api/learning/sessions/:id/skip', route((req, res) => send(res, service.skip(req.params.id, req.body))));
router.post('/api/learning/sessions/:id/end', route((req, res) => send(res, service.endSession(req.params.id))));

router.get('/api/learning/reviews/by-key/:eventKey', route((req, res) => send(res, service.getReviewByKey(req.params.eventKey))));
router.get('/api/learning/items/:id', route((req, res) => send(res, { item: service.getItem(req.params.id) })));

module.exports = router;
