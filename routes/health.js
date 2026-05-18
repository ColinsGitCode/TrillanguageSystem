'use strict';

const express = require('express');
const {
  geminiAuthService,
  HealthCheckService,
  E2E_TEST_MODE,
} = require('./_shared');

const router = express.Router();

router.get('/api/health', async (req, res) => {
    try {
        const status = await HealthCheckService.checkAll();
        if (status && typeof status === 'object') {
          status.e2e_test_mode = E2E_TEST_MODE;
        }
        res.json(status);
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

// ========== Gemini CLI Auth ==========
router.get('/api/gemini/auth/status', (req, res) => {
  const enabled = (process.env.GEMINI_MODE || 'host-proxy').toLowerCase() === 'cli';
  const status = geminiAuthService.getStatus();
  res.json({ enabled, ...status });
});

router.post('/api/gemini/auth/start', async (req, res) => {
  const enabled = (process.env.GEMINI_MODE || 'host-proxy').toLowerCase() === 'cli';
  if (!enabled) return res.status(400).json({ error: 'Gemini CLI not enabled' });
  try {
    const status = await geminiAuthService.startAuth();
    res.json({ enabled, ...status });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

router.post('/api/gemini/auth/submit', async (req, res) => {
  const { code } = req.body || {};
  if (!code) return res.status(400).json({ error: 'Missing authorization code' });
  try {
    const result = await geminiAuthService.submitCode(code);
    res.json(result);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

router.post('/api/gemini/auth/cancel', (req, res) => {
  const result = geminiAuthService.cancelAuth();
  res.json(result);
});

module.exports = router;
