'use strict';

const express = require('express');
const {
  exampleReviewService,
  dbService,
} = require('./_shared');

const router = express.Router();

router.get('/api/dashboard/review-stats', (req, res) => {
    try {
        const reviewStats = dbService.getReviewStats();
        const activeCampaign = exampleReviewService.getActiveCampaign();
        let campaignProgress = null;
        if (activeCampaign) {
            campaignProgress = exampleReviewService.getCampaignProgress(activeCampaign.id);
        }
        res.json({ success: true, ...reviewStats, campaign: campaignProgress });
    } catch (e) {
        console.error('[API /dashboard/review-stats] Error:', e);
        res.status(500).json({ error: e.message });
    }
});

router.get('/api/dashboard/fewshot-stats', (req, res) => {
    try {
        const stats = dbService.getFewShotStats();
        res.json({ success: true, ...stats });
    } catch (e) {
        console.error('[API /dashboard/fewshot-stats] Error:', e);
        res.status(500).json({ error: e.message });
    }
});

router.get('/api/dashboard/highlight-stats', (req, res) => {
    try {
        const {
            provider,
            cardType,
            dateFrom = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString().split('T')[0],
            dateTo = new Date().toISOString().split('T')[0]
        } = req.query;
        const stats = dbService.getHighlightStats({ provider, cardType, dateFrom, dateTo });
        res.json({
            success: true,
            ...stats,
            period: { dateFrom, dateTo }
        });
    } catch (e) {
        console.error('[API /dashboard/highlight-stats] Error:', e);
        res.status(500).json({ error: e.message });
    }
});

module.exports = router;
