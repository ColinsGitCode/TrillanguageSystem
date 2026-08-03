'use strict';

const express = require('express');
const defaultOnboardingService = require('../services/onboarding/onboardingService');

function createOnboardingRouter(onboardingService = defaultOnboardingService) {
  const router = express.Router();
  router.get('/api/onboarding', (_req, res) => {
    res.set('Cache-Control', 'no-store');
    return res.json({ success: true, ...onboardingService.getState() });
  });
  return router;
}

module.exports = createOnboardingRouter();
module.exports.createOnboardingRouter = createOnboardingRouter;
