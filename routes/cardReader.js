'use strict';

const express = require('express');
const { dbService } = require('./_shared');
const {
  CARD_READER_V3_SHADOW_ENABLED,
  CARD_READER_V3_SHADOW_MAX_MARKDOWN_CHARS,
  CARD_READER_V3_CANARY_ENABLED,
  CARD_READER_V3_CANARY_GENERATION_IDS,
} = require('../lib/serverConfig');
const { createCardReaderShadowService } = require('../services/cardReader/cardReaderShadowService');

const router = express.Router();
const service = createCardReaderShadowService({
  dbService,
  maxMarkdownChars: CARD_READER_V3_SHADOW_MAX_MARKDOWN_CHARS,
  canaryGenerationIds: CARD_READER_V3_CANARY_GENERATION_IDS,
});

router.get('/api/card-reader/shadow/config', (_req, res) => {
  res.json({
    success: true,
    enabled: CARD_READER_V3_SHADOW_ENABLED,
    version: 'card-reader-shadow-v1',
    canaryEnabled: CARD_READER_V3_CANARY_ENABLED,
    canaryGenerationIds: CARD_READER_V3_CANARY_ENABLED
      ? CARD_READER_V3_CANARY_GENERATION_IDS
      : [],
  });
});

router.get('/api/card-reader/canary', async (req, res, next) => {
  if (!CARD_READER_V3_CANARY_ENABLED) {
    return res.status(404).json({
      error: 'Card Reader v3 Canary is disabled',
      code: 'CARD_READER_V3_CANARY_DISABLED',
    });
  }
  try {
    const canary = await service.readCanaryGeneration(req.query.generationId);
    return res.json({ success: true, canary });
  } catch (error) {
    return next(error);
  }
});

router.get('/api/card-reader/shadow', async (req, res, next) => {
  if (!CARD_READER_V3_SHADOW_ENABLED) {
    return res.status(404).json({
      error: 'Card Reader v3 shadow is disabled',
      code: 'CARD_READER_V3_SHADOW_DISABLED',
    });
  }
  try {
    const report = await service.compareGeneration(req.query.generationId);
    return res.json({ success: true, report });
  } catch (error) {
    return next(error);
  }
});

module.exports = router;
