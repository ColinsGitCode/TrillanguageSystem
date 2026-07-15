'use strict';

const express = require('express');
const dbService = require('../services/storage/databaseService');
const generationJobService = require('../services/generation/generationJobService');
const { TextbookImportService } = require('../services/textbooks/textbookImportService');
const { TextbookError } = require('../services/textbooks/textbookErrors');
const { streamOfficialAudio } = require('../services/textbooks/textbookMediaService');
const {
  TEXTBOOK_FEATURE_ENABLED,
  TEXTBOOK_SOURCE_ROOT,
  DEFAULT_DEEPSEEK_MODEL,
} = require('../lib/serverConfig');

const router = express.Router();
const importService = new TextbookImportService({
  dbService,
  sourceRoot: TEXTBOOK_SOURCE_ROOT,
});

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
  if (derivation.target_job_id && ['running', 'completed'].includes(derivation.status)) {
    const existingJob = dbService.getGenerationJobById(derivation.target_job_id);
    if (existingJob) {
      return send(res, { derivation, job: existingJob, reused: true, summary: generationJobService.getSummary() });
    }
  }
  const targetFolder = `Textbook/${expression.course_key}/Track-${String(expression.track_number).padStart(2, '0')}`;
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

module.exports = router;
