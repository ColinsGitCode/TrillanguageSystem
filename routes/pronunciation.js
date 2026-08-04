'use strict';

const express = require('express');
const { dbService } = require('./_shared');
const {
  PRONUNCIATION_OVERLAY_ENABLED,
  PRONUNCIATION_ACTIONS_ENABLED,
  PRONUNCIATION_LEGACY_RUBY_READER_ENABLED,
} = require('../lib/serverConfig');
const { createPronunciationService } = require('../services/pronunciation/pronunciationService');

const router = express.Router();
const pronunciationService = createPronunciationService({
  dbService,
  legacyReaderEnabled: PRONUNCIATION_LEGACY_RUBY_READER_ENABLED,
});

function enabled(req, res, next) {
  if (!PRONUNCIATION_OVERLAY_ENABLED) {
    return res.status(404).json({ error: 'Pronunciation overlay is disabled', code: 'PRONUNCIATION_FEATURE_DISABLED' });
  }
  return next();
}

function actionsEnabled(req, res, next) {
  if (!PRONUNCIATION_ACTIONS_ENABLED) {
    return res.status(404).json({ error: 'Pronunciation actions are disabled', code: 'PRONUNCIATION_ACTIONS_DISABLED' });
  }
  return next();
}

function numericId(value) {
  const id = Number(value);
  if (!Number.isSafeInteger(id) || id < 1) {
    const error = new Error('targetId must be a positive integer');
    error.status = 400;
    error.code = 'PRONUNCIATION_TARGET_INVALID';
    throw error;
  }
  return id;
}

router.get('/api/pronunciation', enabled, async (req, res, next) => {
  try {
    const targetKind = String(req.query.targetKind || 'generation');
    const targetId = numericId(req.query.targetId);
    if (!['generation', 'textbook_expression'].includes(targetKind)) {
      return res.status(501).json({ error: 'This pronunciation target is not enabled yet', code: 'PRONUNCIATION_TARGET_UNSUPPORTED' });
    }
    const result = targetKind === 'textbook_expression'
      ? await pronunciationService.readTextbookExpression(targetId, { refresh: String(req.query.refresh || '') === '1' })
      : await pronunciationService.readGeneration(targetId, {
      refresh: String(req.query.refresh || '') === '1',
    });
    return res.json({
      success: true,
      target: { targetKind, targetId },
      plainText: result.plainText,
      document: result.document,
      tokens: result.tokens,
    });
  } catch (error) {
    return next(error);
  }
});

router.post('/api/pronunciation/corrections', enabled, actionsEnabled, async (req, res, next) => {
  try {
    const payload = req.body || {};
    if (!payload.eventKey || !payload.tokenKey || !payload.eventType) {
      const error = new Error('eventKey, tokenKey and eventType are required');
      error.status = 400;
      error.code = 'PRONUNCIATION_CORRECTION_INVALID';
      throw error;
    }
    const result = await pronunciationService.correct({
      ...payload,
      targetKind: payload.targetKind || 'generation',
      targetId: numericId(payload.targetId),
    });
    return res.status(result.idempotent ? 200 : 201).json({ success: true, ...result });
  } catch (error) {
    return next(error);
  }
});

module.exports = router;
