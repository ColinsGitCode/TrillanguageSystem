'use strict';

const express = require('express');
const { PRONUNCIATION_TELEMETRY_ENABLED } = require('../lib/serverConfig');
const telemetry = require('../services/pronunciation/pronunciationTelemetry');

const router = express.Router();

function enabled(req, res, next) {
  if (!PRONUNCIATION_TELEMETRY_ENABLED) {
    return res.status(404).json({
      error: 'Pronunciation telemetry is disabled',
      code: 'PRONUNCIATION_TELEMETRY_DISABLED',
    });
  }
  return next();
}

router.post('/api/pronunciation/telemetry', enabled, (req, res, next) => {
  try {
    const result = telemetry.record(req.body || {});
    return res.status(result.accepted ? 202 : 429).json({ success: result.accepted, ...result });
  } catch (error) {
    return next(error);
  }
});

router.get('/api/pronunciation/telemetry', enabled, (req, res) => (
  res.json({ success: true, telemetry: telemetry.snapshot() })
));

module.exports = router;
