'use strict';

const crypto = require('node:crypto');
const express = require('express');
const log = require('../lib/logger').child({ module: 'route/selection-tts' });
const { SelectionTtsService } = require('../services/selectionTts/selectionTtsService');

const router = express.Router();
const service = new SelectionTtsService();

function safeHeader(value) {
  return String(value ?? '').replace(/[\r\n]/g, ' ').slice(0, 240);
}

router.get('/api/tts/selection', (_req, res) => {
  res.json({ success: true, ...service.publicConfig() });
});

router.post('/api/tts/selection', async (req, res, next) => {
  const requestId = crypto.randomUUID();
  const startedAt = Date.now();
  const requestedLanguage = String(req.body?.language || '').trim().toLowerCase().slice(0, 16);
  const requestedSpeed = Number(req.body?.speed);
  const characterCount = typeof req.body?.text === 'string'
    ? Array.from(req.body.text).length
    : 0;
  const controller = new AbortController();
  const onClose = () => {
    if (!res.writableEnded) controller.abort();
  };
  res.once('close', onClose);
  try {
    const result = await service.synthesize(req.body, { signal: controller.signal });
    if (controller.signal.aborted || res.destroyed) return;
    res.set({
      'X-Request-Id': requestId,
      'Content-Type': safeHeader(result.contentType),
      'Content-Length': String(result.buffer.length),
      'Cache-Control': 'no-store',
      'X-TTS-Provider': safeHeader(result.ttsProvider),
      'X-TTS-Model': safeHeader(result.ttsModel),
      'X-TTS-Voice': safeHeader(result.ttsVoice),
      'X-TTS-Cache': safeHeader(result.cacheStatus),
      'X-TTS-Queue-Wait-Ms': String(result.queueWaitMs || 0),
      'X-TTS-Contended': result.contended ? '1' : '0',
    });
    log.info({
      requestId,
      language: requestedLanguage,
      speed: requestedSpeed,
      characterCount: result.characterCount,
      provider: result.ttsProvider,
      model: result.ttsModel,
      voice: result.ttsVoice,
      cache: result.cacheStatus,
      queueWaitMs: result.queueWaitMs || 0,
      durationMs: Date.now() - startedAt,
    }, 'selection TTS completed');
    res.end(result.buffer);
  } catch (error) {
    if (!controller.signal.aborted && !res.headersSent) {
      log.warn({
        requestId,
        language: requestedLanguage,
        speed: requestedSpeed,
        characterCount,
        code: error?.code || 'SELECTION_TTS_FAILED',
        status: error?.status || 500,
        durationMs: Date.now() - startedAt,
      }, 'selection TTS failed');
      next(error);
    }
  } finally {
    res.off('close', onClose);
  }
});

module.exports = router;
module.exports.service = service;
