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

// A human correction is an accepted proposal with origin='human'. That is what
// puts it above the curated dictionary in the read order, and it is why a wrong
// curated entry can be overridden without editing the shipped dictionary file.
router.post('/api/language-metadata/corrections', enabled, (req, res, next) => {
  try {
    const body = req.body || {};
    const targetKind = String(body.targetKind || 'generation');
    const targetId = Number(body.targetId);
    const sourceContentHash = String(body.sourceContentHash || '');
    const surface = String(body.surface || '').trim();
    const originTerm = String(body.originTerm || '').trim();
    const originLanguage = String(body.originLanguage || 'en').trim().toLowerCase();
    const startCodePoint = Number(body.startCodePoint);
    const endCodePoint = Number(body.endCodePoint);

    if (!['generation', 'textbook_expression'].includes(targetKind)
      || !Number.isSafeInteger(targetId) || targetId <= 0
      || sourceContentHash.length !== 64
      || !surface || surface.length > 80
      || !originTerm || originTerm.length > 80
      || !/^[a-z]{2}$/u.test(originLanguage)
      || !Number.isSafeInteger(startCodePoint) || startCodePoint < 0
      || !Number.isSafeInteger(endCodePoint) || endCodePoint <= startCodePoint) {
      return res.status(400).json({ error: 'invalid correction', code: 'LANGUAGE_METADATA_CORRECTION_INVALID' });
    }

    const nowUtc = new Date().toISOString();
    const result = dbService.insertLanguageMetadataProposal({
      proposalKey: `human:${targetKind}:${targetId}:${sourceContentHash}:${startCodePoint}:${endCodePoint}`,
      targetKind,
      targetId,
      sourceContentHash,
      metadataKind: 'foreign-origin',
      surface,
      startCodePoint,
      endCodePoint,
      valueJson: JSON.stringify({ originTerm, originLanguage }),
      confidence: 'high',
      origin: 'human',
      status: 'accepted',
      nowUtc,
    });
    if (!result.created) {
      const updated = dbService.decideLanguageMetadataProposal({
        id: result.proposal.id,
        expectedStatus: result.proposal.status,
        status: 'accepted',
        decidedBy: 'user',
        nowUtc,
      });
      return res.json({ success: true, proposal: updated || result.proposal, replaced: true });
    }
    return res.status(201).json({ success: true, proposal: result.proposal });
  } catch (error) { return next(error); }
});

module.exports = router;
