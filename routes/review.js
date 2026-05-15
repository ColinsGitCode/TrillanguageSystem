'use strict';

const express = require('express');
const {
  exampleReviewService,
} = require('./_shared');

const router = express.Router();

router.get('/api/review/campaigns', (req, res) => {
  try {
    const campaigns = exampleReviewService.getCampaigns();
    res.json({ success: true, campaigns });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/api/review/campaigns/active', (req, res) => {
  try {
    const campaign = exampleReviewService.getActiveCampaign();
    if (!campaign) return res.json({ success: true, campaign: null });
    const progress = exampleReviewService.getCampaignProgress(campaign.id);
    res.json({ success: true, campaign: progress || campaign });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/api/review/campaigns', (req, res) => {
  try {
    const { name, createdBy, notes } = req.body || {};
    const campaign = exampleReviewService.createCampaign({ name, createdBy, notes });
    res.json({ success: true, campaign });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/api/review/campaigns/:id/progress', (req, res) => {
  try {
    const progress = exampleReviewService.getCampaignProgress(Number(req.params.id));
    if (!progress) return res.status(404).json({ error: 'Campaign not found' });
    res.json({ success: true, progress });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/api/review/campaigns/:id/finalize', (req, res) => {
  try {
    const campaignId = Number(req.params.id);
    const progress = exampleReviewService.finalizeCampaign(campaignId, req.body || {});
    res.json({ success: true, progress });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

router.post('/api/review/campaigns/:id/rollback', (req, res) => {
  try {
    const campaignId = Number(req.params.id);
    const progress = exampleReviewService.rollbackCampaign(campaignId);
    res.json({ success: true, progress });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

router.post('/api/review/backfill', (req, res) => {
  try {
    const { limit = 0 } = req.body || {};
    const result = exampleReviewService.backfillMissingGenerations(Number(limit || 0));
    res.json({ success: true, result });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/api/review/generations/:id/examples', (req, res) => {
  try {
    const generationId = Number(req.params.id);
    if (!generationId) return res.status(400).json({ error: 'Invalid generation id' });
    const campaignId = req.query.campaignId ? Number(req.query.campaignId) : null;
    const reviewer = String(req.query.reviewer || process.env.REVIEW_DEFAULT_REVIEWER || 'owner');
    const examples = exampleReviewService.getGenerationExamples(generationId, { campaignId, reviewer });
    res.json({ success: true, examples });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/api/review/examples/:id/reviews', (req, res) => {
  try {
    const exampleId = Number(req.params.id);
    const {
      campaignId = null,
      reviewer = process.env.REVIEW_DEFAULT_REVIEWER || 'owner',
      scoreSentence,
      scoreTranslation,
      scoreTts,
      decision = 'neutral',
      comment = ''
    } = req.body || {};

    const result = exampleReviewService.upsertReview({
      exampleId,
      campaignId,
      reviewer,
      scoreSentence,
      scoreTranslation,
      scoreTts,
      decision,
      comment
    });

    res.json({ success: true, review: result });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

module.exports = router;
