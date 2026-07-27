'use strict';

const express = require('express');
const dbService = require('../services/storage/databaseService');
const generationJobService = require('../services/generation/generationJobService');
const { TextbookImportService } = require('../services/textbooks/textbookImportService');
const { TextbookError } = require('../services/textbooks/textbookErrors');
const { streamGeneratedAudio, streamOfficialAudio } = require('../services/textbooks/textbookMediaService');
const { TextbookTtsService } = require('../services/textbooks/textbookTtsService');
const textbookOperationService = require('../services/textbooks/textbookOperationService');
const { TextbookWorkflowService } = require('../services/textbooks/textbookWorkflowService');
const {
  deleteTrackHighlight,
  getTrackHighlight,
  saveTrackHighlight,
} = require('../services/textbooks/textbookHighlightService');
const {
  annotationShadowReadService,
} = require('../services/annotations/annotationRuntime');
const {
  TEXTBOOK_FEATURE_ENABLED,
  TEXTBOOK_SOURCE_ROOT,
  TEXTBOOK_WORK_PATH,
  DEFAULT_DEEPSEEK_MODEL,
} = require('../lib/serverConfig');

const router = express.Router();
const importService = new TextbookImportService({
  dbService,
  sourceRoot: TEXTBOOK_SOURCE_ROOT,
});
const textbookTtsService = new TextbookTtsService({ dbService, workPath: TEXTBOOK_WORK_PATH });
const textbookWorkflowService = new TextbookWorkflowService({ dbService });

function textbookDerivationFolder(expression) {
  const courseKey = String(expression?.course_key || 'course')
    .replace(/[^a-z0-9._-]+/giu, '-')
    .replace(/^-+|-+$/gu, '') || 'course';
  return `Textbook-${courseKey}-Track-${String(expression?.track_number || 0).padStart(2, '0')}`;
}

function send(res, payload) {
  return res.json({ success: true, ...payload });
}

function requireEnabled(_req, res, next) {
  if (!TEXTBOOK_FEATURE_ENABLED) {
    return res.status(404).json({ error: 'Not found', code: 'TEXTBOOK_FEATURE_DISABLED' });
  }
  return next();
}

function asyncRoute(handler) {
  return async (req, res, next) => {
    try {
      return await handler(req, res);
    } catch (error) {
      if (error instanceof TextbookError) {
        if (error.code === 'TEXTBOOK_AUDIO_RANGE_INVALID') {
          return res.status(416).set('Content-Range', `bytes */${error.details?.size || 0}`).json({
            error: error.message,
            code: error.code,
            details: error.details,
          });
        }
        return res.status(error.status || 400).json({
          error: error.message,
          code: error.code,
          details: error.details,
        });
      }
      return next(error);
    }
  };
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

router.use('/api/textbooks', requireEnabled);

router.get('/api/textbooks/courses', route((_req, res) => send(res, {
  courses: dbService.listTextbookCourses(),
})));

router.get('/api/textbooks/courses/:id', route((req, res) => {
  const course = dbService.getTextbookCourse(req.params.id);
  if (!course) return res.status(404).json({ error: 'Not found', code: 'TEXTBOOK_COURSE_NOT_FOUND' });
  return send(res, { course });
}));

router.get('/api/textbooks/tracks/:id', route((req, res) => {
  const track = dbService.getTextbookTrack(req.params.id);
  if (!track) return res.status(404).json({ error: 'Not found', code: 'TEXTBOOK_TRACK_NOT_FOUND' });
  return send(res, { track });
}));

router.get('/api/textbooks/tracks/:id/workflow', route((req, res) => {
  const workflow = textbookWorkflowService.getWorkflow(req.params.id, req.query.operation || null);
  return send(res, { workflow });
}));

router.get('/api/textbooks/revisions/:id', route((req, res) => {
  const revision = dbService.getTextbookRevision(req.params.id);
  if (!revision) return res.status(404).json({ error: 'Not found', code: 'TEXTBOOK_REVISION_NOT_FOUND' });
  return send(res, { revision });
}));

router.patch('/api/textbooks/revisions/:id', route((req, res) => {
  const result = dbService.copyTextbookRevision(req.params.id, req.body || {});
  const track = dbService.getTextbookTrack(result.trackId);
  const workflow = textbookWorkflowService.getWorkflow(result.trackId);
  return send(res, { result, track, workflow });
}));

router.put('/api/textbooks/revisions/:id/expressions/:expressionId/review', route((req, res) => {
  const review = dbService.updateTextbookReviewState(
    req.params.id,
    req.params.expressionId,
    req.body || {}
  );
  const revision = dbService.getTextbookRevision(req.params.id);
  const workflow = textbookWorkflowService.getWorkflow(revision.track_id);
  return send(res, { review, workflow });
}));

router.post('/api/textbooks/tracks/:id/operations', route((req, res) => {
  const operation = textbookOperationService.enqueue(req.params.id, req.body || {});
  return res.status(202).json({ success: true, operation });
}));

router.get('/api/textbooks/operations/:id', route((req, res) => {
  const operation = dbService.getTextbookOperation(req.params.id);
  if (!operation) return res.status(404).json({ error: 'Not found', code: 'TEXTBOOK_OPERATION_NOT_FOUND' });
  return send(res, { operation });
}));

router.get('/api/textbooks/operations/:id/events', route((req, res) => {
  const operation = dbService.getTextbookOperation(req.params.id);
  if (!operation) return res.status(404).json({ error: 'Not found', code: 'TEXTBOOK_OPERATION_NOT_FOUND' });
  return send(res, { events: dbService.listTextbookOperationEvents(req.params.id) });
}));

router.post('/api/textbooks/operations/:id/retry', route((req, res) => {
  const operation = textbookOperationService.retry(req.params.id);
  return res.status(202).json({ success: true, operation });
}));

router.get('/api/textbooks/search', route((req, res) => {
  const query = String(req.query.q || '').trim();
  if (!query) return send(res, { results: [] });
  const limit = Math.min(Math.max(Number(req.query.limit) || 20, 1), 50);
  return send(res, { results: dbService.searchTextbookExpressions(query, limit) });
}));

router.post('/api/textbooks/imports/dry-run', asyncRoute(async (req, res) => {
  return send(res, await importService.dryRun(req.body || {}));
}));

router.post('/api/textbooks/imports', asyncRoute(async (req, res) => {
  return send(res, await importService.importDraft(req.body || {}));
}));

router.post('/api/textbooks/revisions/:id/verify', route((req, res) => {
  const track = dbService.verifyTextbookRevision(req.params.id, {
    expectedTrackStatus: req.body?.expectedTrackStatus,
  });
  return send(res, { track });
}));

router.get('/api/textbooks/tracks/:id/publish-preview', route((req, res) => {
  return send(res, { preview: dbService.previewTextbookPublish(req.params.id) });
}));

router.post('/api/textbooks/tracks/:id/publish', route((req, res) => {
  const result = dbService.publishTextbookTrack(req.params.id, {
    expectedTrackRevision: req.body?.expectedTrackRevision,
    confirmUnitCount: req.body?.confirmUnitCount,
    expectedPlanRevision: req.body?.expectedPlanRevision,
  });
  return send(res, result);
}));

router.post('/api/textbooks/tracks/:id/tts', asyncRoute(async (req, res) => {
  return send(res, await textbookTtsService.generateTrack(req.params.id, {
    force: Boolean(req.body?.force),
  }));
}));

router.get('/api/textbooks/tracks/:id/highlights', route((req, res) => {
  const { highlight } = getTrackHighlight({
    dbService,
    trackId: req.params.id,
    shadowReadService: annotationShadowReadService,
  });
  return send(res, { highlight });
}));

router.put('/api/textbooks/tracks/:id/highlights', route((req, res) => {
  const highlight = saveTrackHighlight({
    dbService,
    trackId: req.params.id,
    html: req.body?.html,
    updatedBy: req.body?.updatedBy || 'textbook-ui',
  });
  return send(res, { highlight });
}));

router.delete('/api/textbooks/tracks/:id/highlights/:highlightId', route((req, res) => {
  const deleted = deleteTrackHighlight({
    dbService,
    trackId: req.params.id,
    highlightId: req.params.highlightId,
  });
  return send(res, { deleted });
}));

router.post('/api/textbooks/expressions/:id/derivations/preview', route((req, res) => {
  const preview = dbService.previewTextbookDerivation(req.params.id, req.body || {});
  return send(res, {
    preview: {
      derivation: preview.derivation,
      request: preview.request,
      expression: {
        id: preview.expression.expression_id,
        revisionId: preview.expression.id,
        expressionKey: preview.expression.expression_key,
        trackId: preview.expression.track_id,
        trackTitle: preview.expression.track_title,
        officialEnText: preview.expression.official_en_text,
        officialJaText: preview.expression.official_ja_text,
        zhCueText: preview.expression.zh_cue_text,
      },
    },
  });
}));

router.post('/api/textbooks/expressions/:id/derivations', route((req, res) => {
  const created = dbService.createTextbookDerivation(req.params.id, req.body || {});
  const { request, expression, derivation } = created;
  const targetFolder = textbookDerivationFolder(expression);
  if (derivation.target_job_id && ['running', 'completed'].includes(derivation.status)) {
    const existingJob = dbService.getGenerationJobById(derivation.target_job_id);
    if (existingJob) {
      return send(res, { derivation, job: existingJob, reused: true, summary: generationJobService.getSummary() });
    }
  }
  if (derivation.target_job_id && derivation.status === 'pending') {
    const existingJob = dbService.getGenerationJobById(derivation.target_job_id);
    if (existingJob?.status === 'failed') {
      const repairedJob = dbService.updateGenerationJob(existingJob.id, {
        targetFolder,
        requestPayload: {
          ...(existingJob.requestPayload || {}),
          target_folder: targetFolder,
        },
      });
      const retried = generationJobService.retryJob(repairedJob.id);
      if (retried) {
        const linked = dbService.attachTextbookDerivationJob(derivation.id, retried.id);
        return send(res, {
          derivation: linked,
          job: retried,
          retried: true,
          summary: generationJobService.getSummary(),
        });
      }
    }
  }
  const job = generationJobService.enqueue({
    jobType: request.targetCardType,
    phraseRaw: request.targetPhrase,
    phraseNormalized: request.targetPhrase,
    sourceMode: 'textbook_selection',
    targetFolder,
    duplicatePolicy: 'create-version',
    provider: 'deepseek',
    llmModel: DEFAULT_DEEPSEEK_MODEL,
    sourceContext: {
      source: 'textbook_derivation',
      derivationId: Number(derivation.id),
      expressionId: request.expressionId,
      sourceExpressionRevisionId: request.sourceExpressionRevisionId,
      courseKey: expression.course_key,
      trackId: Number(expression.track_id),
      trackNumber: Number(expression.track_number),
      expressionKey: expression.expression_key,
      selectionLanguage: request.selectionLanguage,
      selectionHash: request.selectionHash,
    },
    createdByClient: req.get('user-agent') || 'browser',
    requestPayload: {
      phrase: request.targetPhrase,
      llm_provider: 'deepseek',
      llm_model: DEFAULT_DEEPSEEK_MODEL,
      card_type: request.targetCardType,
      source_mode: 'textbook_selection',
      target_folder: targetFolder,
      duplicate_policy: 'create-version',
      source_context: {
        source: 'textbook_derivation',
        derivation_id: Number(derivation.id),
      },
    },
  });
  const linked = dbService.attachTextbookDerivationJob(derivation.id, job.id);
  return send(res, { derivation: linked, job, summary: generationJobService.getSummary() });
}));

router.get('/api/textbooks/assets/:id/content', asyncRoute(async (req, res) => {
  return streamOfficialAudio({
    dbService,
    sourceRoot: TEXTBOOK_SOURCE_ROOT,
    req,
    res,
    assetId: req.params.id,
  });
}));

router.head('/api/textbooks/assets/:id/content', asyncRoute(async (req, res) => {
  return streamOfficialAudio({
    dbService,
    sourceRoot: TEXTBOOK_SOURCE_ROOT,
    req,
    res,
    assetId: req.params.id,
  });
}));

router.get('/api/textbooks/audio/:id/content', asyncRoute(async (req, res) => {
  return streamGeneratedAudio({
    dbService,
    workRoot: TEXTBOOK_WORK_PATH,
    req,
    res,
    audioFileId: req.params.id,
  });
}));

router.head('/api/textbooks/audio/:id/content', asyncRoute(async (req, res) => {
  return streamGeneratedAudio({
    dbService,
    workRoot: TEXTBOOK_WORK_PATH,
    req,
    res,
    audioFileId: req.params.id,
  });
}));

module.exports = router;
