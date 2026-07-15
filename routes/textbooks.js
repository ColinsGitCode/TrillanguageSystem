'use strict';

const express = require('express');
const dbService = require('../services/storage/databaseService');
const { TextbookImportService } = require('../services/textbooks/textbookImportService');
const { TextbookError } = require('../services/textbooks/textbookErrors');
const { streamOfficialAudio } = require('../services/textbooks/textbookMediaService');
const {
  TEXTBOOK_FEATURE_ENABLED,
  TEXTBOOK_SOURCE_ROOT,
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
