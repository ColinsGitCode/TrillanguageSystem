'use strict';

// JLM proposal inspection and human adjudication, gated by
// LANGUAGE_METADATA_ENABLED, which defaults to off.

const express = require('express');
const dbService = require('../services/storage/databaseService');
const { LANGUAGE_METADATA_ENABLED } = require('../lib/serverConfig');
const languageMetadataRuntime = require('../services/languageMetadata/runtime');
const {
  createLanguageMetadataCorrectionService,
} = require('../services/languageMetadata/application/correctionService');

const router = express.Router();
const correctionService = createLanguageMetadataCorrectionService({ dbService });

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

function decide(status) {
  return (req, res, next) => {
    try {
      const proposal = dbService.getLanguageMetadataProposal(req.params.id);
      if (!proposal) {
        return res.status(404).json({ error: 'proposal not found', code: 'LANGUAGE_METADATA_PROPOSAL_NOT_FOUND' });
      }
      if (proposal.status === 'stale') {
        return res.status(409).json({ error: 'proposal is stale', code: 'LANGUAGE_METADATA_PROPOSAL_STALE' });
      }
      const decided = dbService.decideLanguageMetadataProposal({
        id: proposal.id,
        expectedStatus: 'pending',
        status,
        decidedBy: 'user',
        nowUtc: new Date().toISOString(),
      });
      // Optimistic: a candidate already judged by someone else must surface as a
      // conflict rather than being quietly re-decided.
      if (!decided) {
        return res.status(409).json({ error: 'proposal already decided', code: 'LANGUAGE_METADATA_PROPOSAL_CONFLICT' });
      }
      return res.json({ success: true, proposal: decided });
    } catch (error) { return next(error); }
  };
}

router.post('/api/language-metadata/proposals/:id/accept', enabled, decide('accepted'));
router.post('/api/language-metadata/proposals/:id/reject', enabled, decide('rejected'));

// Manual compensation for the rare case where the original post-persist hand-
// off could not create a job. The operation is idempotent on the generation's
// content hash and never invokes the provider inside this request.
router.post('/api/language-metadata/jobs', enabled, (req, res, next) => {
  try {
    const generationId = Number(req.body?.generationId);
    if (!Number.isSafeInteger(generationId) || generationId <= 0) {
      return res.status(400).json({
        error: 'generationId is required',
        code: 'LANGUAGE_METADATA_TARGET_INVALID',
      });
    }
    const result = languageMetadataRuntime.enqueueGeneration(generationId);
    const status = result.status === 'queued' ? 202 : 200;
    return res.status(status).json({ success: true, ...result });
  } catch (error) { return next(error); }
});

// A human correction is an accepted proposal with origin='human'. That is what
// puts it above the curated dictionary in the read order, and it is why a wrong
// curated entry can be overridden without editing the shipped dictionary file.
router.post('/api/language-metadata/corrections', enabled, (req, res, next) => {
  try {
    const result = correctionService.correct(req.body || {});
    return res.status(result.created ? 201 : 200).json({ success: true, ...result });
  } catch (error) { return next(error); }
});

module.exports = router;
