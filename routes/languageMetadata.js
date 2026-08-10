'use strict';

// JLM-A0 read-only inspection of shadow extraction output.
//
// Shadow output is worthless if it cannot be looked at, but A0 displays nothing
// in the product UI. This route is therefore strictly read-only and gated by
// LANGUAGE_METADATA_ENABLED, which defaults to off.
//
// Accept/reject/correction endpoints belong to JLM-A1 and are deliberately
// absent here: A0 must not be able to promote a candidate.

const express = require('express');
const dbService = require('../services/storage/databaseService');
const { LANGUAGE_METADATA_ENABLED } = require('../lib/serverConfig');

const router = express.Router();

function enabled(req, res, next) {
  if (!LANGUAGE_METADATA_ENABLED) {
    return res.status(404).json({ error: 'language metadata is disabled', code: 'LANGUAGE_METADATA_DISABLED' });
  }
  return next();
}

router.get('/api/language-metadata', enabled, (req, res, next) => {
  try {
    const targetKind = String(req.query.targetKind || 'generation');
    const targetId = Number(req.query.targetId);
    if (!['generation', 'textbook_expression'].includes(targetKind) || !Number.isSafeInteger(targetId) || targetId <= 0) {
      return res.status(400).json({ error: 'targetKind and targetId are required', code: 'LANGUAGE_METADATA_TARGET_INVALID' });
    }
    return res.json({
      success: true,
      jobs: dbService.listLanguageMetadataJobs({ targetKind, targetId }),
      proposals: dbService.listLanguageMetadataProposals({ targetKind, targetId }),
    });
  } catch (error) { return next(error); }
});

module.exports = router;
