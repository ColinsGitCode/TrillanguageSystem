'use strict';

const express = require('express');
const defaultActivityService = require('../services/activity/activityService');

function createActivityRouter(activityService = defaultActivityService) {
  const router = express.Router();
  router.get('/api/activity', (req, res) => {
    const feed = activityService.getFeed({ limit: req.query.limit });
    res.set('Cache-Control', 'no-store');
    return res.json({ success: true, ...feed });
  });
  return router;
}

module.exports = createActivityRouter();
module.exports.createActivityRouter = createActivityRouter;
