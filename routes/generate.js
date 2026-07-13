'use strict';

// /api/generate is an HTTP adapter. Generation orchestration lives in the
// application use case so workers and future route actions can call it directly.

const express = require('express');
const { checkGenerateThrottle } = require('./_shared');
const {
  executeCardGeneration,
  CardAdmissionError,
  GenerationCommandError,
  GenerationValidationError,
} = require('../services/application/executeCardGeneration');
const log = require('../lib/logger').child({ module: 'route/generate' });

const router = express.Router();

router.post('/api/generate', async (req, res) => {
  try {
    const throttle = checkGenerateThrottle(req);
    if (!throttle.allowed) {
      return res.status(429).json({
        error: 'Rate limit exceeded',
        retry_after_ms: throttle.retryAfterMs,
        hint: 'Please wait a few seconds before generating again.'
      });
    }

    const {
      phrase,
      card_type = 'trilingual',
      source_mode = null,
      target_folder = '',
      duplicate_policy = 'reject',
    } = req.body;
    if (!phrase) return res.status(400).json({ error: 'Phrase required' });
    const result = await executeCardGeneration({
      phrase,
      cardType: card_type,
      sourceMode: source_mode,
      targetFolder: target_folder,
      duplicatePolicy: duplicate_policy,
    });
    return res.json(result);
  } catch (err) {
    log.error({ err, route: '/api/generate' }, 'generate failed');
    if (err instanceof GenerationValidationError) {
      return res.status(422).json({
        error: err.message,
        details: err.details,
        prompt: err.prompt,
        llm_output: err.llmOutput,
      });
    }
    if (err instanceof GenerationCommandError) {
      return res.status(400).json({ error: err.message });
    }
    if (err instanceof CardAdmissionError) {
      return res.status(err.status || 422).json({
        error: err.message,
        code: err.code,
        details: err.details,
      });
    }
    return res.status(500).json({ error: err.message });
  }
});

module.exports = router;
