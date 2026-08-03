'use strict';

const express = require('express');
const {
  recordUiPerformance,
  UiPerformanceValidationError,
} = require('../services/observability/uiPerformanceService');

function createUiPerformanceRouter(workspacePolicy) {
  const router = express.Router();
  router.post('/api/ui-performance', express.json({ limit: '16kb' }), (req, res, next) => {
    try {
      const accepted = recordUiPerformance(req.body, {
        workspaceMode: workspacePolicy.mode,
        deploymentExposure: workspacePolicy.exposure,
      });
      res.set('Cache-Control', 'no-store');
      return res.status(202).json({
        success: true,
        accepted: accepted.metrics.length,
      });
    } catch (error) {
      if (error instanceof UiPerformanceValidationError) {
        return res.status(error.status).json({
          error: error.message,
          code: error.code,
        });
      }
      return next(error);
    }
  });
  return router;
}

module.exports = {
  createUiPerformanceRouter,
};
