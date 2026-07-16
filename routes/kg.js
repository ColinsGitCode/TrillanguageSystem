'use strict';

const express = require('express');
const dbService = require('../services/storage/databaseService');
const { KG_ENABLED } = require('../lib/serverConfig');
const { KnowledgeGraphService } = require('../services/kg/application/knowledgeGraphService');

const router = express.Router();
const service = new KnowledgeGraphService({
  db: dbService.db,
  busyRetry: (operation) => dbService.withBusyRetry(operation),
});

function send(res, payload) {
  return res.json({ success: true, ...payload });
}

function requireEnabled(_req, res, next) {
  if (!KG_ENABLED) {
    return res.status(404).json({ error: 'Not found', code: 'KG_FEATURE_DISABLED' });
  }
  return next();
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

function asyncRoute(handler) {
  return async (req, res, next) => {
    try {
      return await handler(req, res);
    } catch (error) {
      return next(error);
    }
  };
}

router.use('/api/kg', requireEnabled);

router.get('/api/kg/search', route((req, res) => send(res, {
  results: service.search({
    query: req.query.q,
    language: req.query.language,
    kind: req.query.kind,
    limit: req.query.limit,
  }),
})));

router.post('/api/kg/lookups', asyncRoute(async (req, res) => send(res, {
  lookup: await service.lookup(req.body || {}),
})));

router.get('/api/kg/points/:id', route((req, res) => send(res, {
  point: service.getPoint(req.params.id),
})));

router.get('/api/kg/points/:id/forms', route((req, res) => send(res, {
  forms: service.getForms(req.params.id),
})));

router.get('/api/kg/points/:id/evidence', route((req, res) => send(res, {
  evidence: service.getEvidence(req.params.id),
})));

router.get('/api/kg/resolution-cases/:id', route((req, res) => send(res, {
  resolutionCase: service.getResolutionCase(req.params.id),
})));

router.post('/api/kg/resolution-cases/:id/decisions', route((req, res) => send(res,
  service.resolveCase(req.params.id, req.body || {})
)));

module.exports = router;
