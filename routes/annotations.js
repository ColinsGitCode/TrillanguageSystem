'use strict';

const express = require('express');
const {
  CARD_ANNOTATIONS_ENABLED,
} = require('../lib/serverConfig');
const {
  annotationConsumerService,
} = require('../services/annotations/annotationRuntime');

const router = express.Router();

function annotationsEnabled(req, res, next) {
  if (!CARD_ANNOTATIONS_ENABLED) {
    return res.status(404).json({
      error: 'Not found',
      code: 'ANNOTATION_FEATURE_DISABLED',
    });
  }
  return next();
}

router.get('/api/annotations', annotationsEnabled, (req, res, next) => {
  try {
    const result = annotationConsumerService.list(
      String(req.query.targetKind || ''),
      req.query.targetId
    );
    return res.json({ success: true, ...result });
  } catch (error) {
    return next(error);
  }
});

router.post('/api/annotations', annotationsEnabled, async (req, res, next) => {
  try {
    const result = await annotationConsumerService.create(req.body || {});
    return res.status(201).json({ success: true, ...result });
  } catch (error) {
    return next(error);
  }
});

router.patch('/api/annotations/:id', annotationsEnabled, async (req, res, next) => {
  try {
    const result = await annotationConsumerService.update(req.params.id, req.body || {});
    return res.json({ success: true, ...result });
  } catch (error) {
    return next(error);
  }
});

router.delete('/api/annotations/:id', annotationsEnabled, async (req, res, next) => {
  try {
    const result = await annotationConsumerService.remove(req.params.id, req.body || {});
    return res.json({ success: true, ...result });
  } catch (error) {
    return next(error);
  }
});

module.exports = router;
