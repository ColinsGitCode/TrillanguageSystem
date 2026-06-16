'use strict';

const express = require('express');
const {
  tesseractOcrService,
  E2E_TEST_MODE,
} = require('./_shared');
const localLlmService = require('../services/llm/localLlmService');
const log = require('../lib/logger').child({ module: 'route/ocr' });

const router = express.Router();

router.post('/api/ocr', async (req, res) => {
  try {
    const { image, provider, langs } = req.body || {};
    if (!image) return res.status(400).json({ error: 'No image' });

    if (E2E_TEST_MODE) {
      return res.json({
        text: 'Queue   state ◆\nキューに追加する\npersistent   highlight',
        provider: 'e2e-fixture'
      });
    }

    const selectedProvider = String(provider || process.env.OCR_PROVIDER || 'tesseract').toLowerCase();
    let text = '';
    let actualProvider = selectedProvider;

    if (selectedProvider === 'tesseract') {
      text = await tesseractOcrService.recognizeImage(image, { langs });
    } else if (selectedProvider === 'local') {
      text = await localLlmService.recognizeImage(image);
    } else if (selectedProvider === 'auto') {
      try {
        text = await tesseractOcrService.recognizeImage(image, { langs });
        actualProvider = 'tesseract';
      } catch (ocrErr) {
        log.warn({ err: ocrErr }, 'tesseract failed in auto mode, falling back to local OCR');
        text = await localLlmService.recognizeImage(image);
        actualProvider = 'local';
      }
    } else {
      return res.status(400).json({ error: `Unsupported OCR provider: ${selectedProvider}` });
    }

    res.json({ text: text || 'No text found', provider: actualProvider });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

module.exports = router;
