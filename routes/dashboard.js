'use strict';

const express = require('express');
const {
  dbService,
} = require('./_shared');
const log = require('../lib/logger').child({ module: 'routes/dashboard' });

const router = express.Router();

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
        log.error({ err: e, route: req.originalUrl }, 'route handler error');
        res.status(500).json({ error: e.message });
    }
});

module.exports = router;
