'use strict';

const express = require('express');
const {
  CARD_ANNOTATIONS_ENABLED,
  KG_ENABLED,
  KG_PLANNING_ENABLED,
  PRONUNCIATION_LEGACY_RUBY_READER_ENABLED,
} = require('../lib/serverConfig');
const dbService = require('../services/storage/databaseService');
const { GraphPlanningSignalReader } = require('../services/kg/storage/graphPlanningSignalReader');
const { CardEngagementPlanningSignalReader } = require('../services/cardEngagement/cardEngagementPlanningSignalReader');
const { LearningService } = require('../services/learning/application/learningService');
const { createPronunciationService } = require('../services/pronunciation/pronunciationService');
const { createDefaultPlanningSignalProvider } = require('../services/learning/planning/defaultPlanningSignalProvider');
const cardEngagementService = require('../services/cardEngagement/cardEngagementService');
const {
  annotationService,
  textbookAnnotationService,
} = require('../services/annotations/annotationRuntime');

const router = express.Router();
const graphSignalReader = new GraphPlanningSignalReader({
  db: dbService.db,
  enabled: KG_ENABLED && KG_PLANNING_ENABLED,
});
const engagementSignalReader = new CardEngagementPlanningSignalReader({ db: dbService.db });
const pronunciationService = createPronunciationService({
  dbService,
  legacyReaderEnabled: PRONUNCIATION_LEGACY_RUBY_READER_ENABLED,
});
const service = new LearningService({
  db: dbService.db,
  busyRetry: (operation) => dbService.withBusyRetry(operation),
  planningSignalProvider: createDefaultPlanningSignalProvider({ graphSignalReader, engagementSignalReader }),
  annotationsEnabled: CARD_ANNOTATIONS_ENABLED,
  annotationService,
  textbookAnnotationService,
  pronunciationService,
});

function send(res, payload) {
  return res.json({ success: true, ...payload });
}

function route(handler) {
  return (req, res, next) => {
    return Promise.resolve()
      .then(() => handler(req, res))
      .catch(next);
  };
}

router.get('/api/learning/plan', route((_req, res) => send(res, service.getPlan())));
router.put('/api/learning/plan', route((req, res) => send(res, service.putPlan(req.body))));
router.post('/api/learning/plan/preview', route((req, res) => send(res, service.previewPlan(req.body))));
router.post('/api/learning/plan/pause', route((_req, res) => send(res, service.setPlanStatus('paused'))));
router.post('/api/learning/plan/resume', route((_req, res) => send(res, service.setPlanStatus('active'))));
router.get('/api/learning/scope-options', route((_req, res) => send(res, service.getScopeOptions())));
router.get('/api/learning/history', route((req, res) => send(res, service.getHistory({
  range: req.query.range,
  unitKind: req.query.unitKind,
}))));

router.post('/api/learning/queues/today', route((_req, res) => send(res, { queue: service.ensureTodayQueue() })));
router.get('/api/learning/queues/today', route((_req, res) => send(res, service.getTodayQueue())));
router.post('/api/learning/manual-queue-intents', route((req, res) => send(res, service.addManualQueueIntent(req.body))));
router.get('/api/learning/manual-queue-intents/today', route((_req, res) => send(res, service.getTodayManualQueueIntents())));
router.post('/api/learning/generations/:id/add-to-today', route((req, res) => {
  const generation = dbService.getGenerationById(req.params.id);
  if (!generation) {
    const error = new Error('Generation not found');
    error.code = 'CARD_ENGAGEMENT_GENERATION_NOT_FOUND';
    error.status = 404;
    throw error;
  }
  const requestKey = String(req.body?.requestKey || '').trim();
  const result = service.addGenerationToToday({ generationId: generation.id, requestKey });
  const engagement = cardEngagementService.record({
    eventKey: `${requestKey}:added`,
    generationId: generation.id,
    phrase: generation.phrase,
    cardType: generation.card_type || 'trilingual',
    eventKind: 'added_to_today',
    sourceSurface: 'cards_factory',
    metadata: {
      queuedStudyItems: result.queued,
      eligibleStudyItems: result.eligible,
      totalStudyItems: result.total,
    },
  });
  return send(res, { engagement: engagement.event, learning: result });
}));

router.get('/api/learning/sessions/active', route((_req, res) => send(res, service.getActiveSession())));
router.post('/api/learning/sessions', route((req, res) => send(res, service.startSession(req.body))));
router.post('/api/learning/sessions/:id/reveal', route((req, res) => send(res, service.reveal(req.params.id, req.body))));
router.post('/api/learning/sessions/:id/reviews', route((req, res) => send(res, service.submitReview(req.params.id, req.body))));
router.post('/api/learning/sessions/:id/skip', route((req, res) => send(res, service.skip(req.params.id, req.body))));
router.post('/api/learning/sessions/:id/end', route((req, res) => send(res, service.endSession(req.params.id))));

router.get('/api/learning/reviews/by-key/:eventKey', route((req, res) => send(res, service.getReviewByKey(req.params.eventKey))));
router.get('/api/learning/items/:id', route(async (req, res) => send(res, {
  item: await service.getItem(req.params.id),
})));

module.exports = router;
