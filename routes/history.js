'use strict';

const express = require('express');
const {
  dbService,
  normalizeCardType,
} = require('./_shared');
const log = require('../lib/logger').child({ module: 'routes/history' });

const router = express.Router();

router.get('/api/history', (req, res) => {
    try {
        const {
            page = 1,
            limit = 20,
            search,
            provider,
            card_type,
            dateFrom,
            dateTo
        } = req.query;
        const cardTypeFilter = card_type ? normalizeCardType(card_type) : null;

        const records = dbService.queryGenerations({
            page: Number(page),
            limit: Number(limit),
            search,
            provider,
            cardType: cardTypeFilter,
            dateFrom,
            dateTo
        });

        const total = dbService.getTotalCount({
            search,
            provider,
            cardType: cardTypeFilter,
            dateFrom,
            dateTo
        });

        res.json({
            success: true,
            records,
            pagination: {
                page: Number(page),
                limit: Number(limit),
                total,
                totalPages: Math.ceil(total / limit),
                hasNext: Number(page) * Number(limit) < total,
                hasPrev: Number(page) > 1
            }
        });
    } catch (e) {
        log.error({ err: e, route: req.originalUrl }, 'route handler error');
        res.status(500).json({ error: e.message });
    }
});

// 获取单条记录详情
router.get('/api/history/:id', (req, res) => {
    try {
        const record = dbService.getGenerationById(Number(req.params.id));

        if (!record) {
            return res.status(404).json({ error: 'Record not found' });
        }

        res.json({
            success: true,
            record
        });
    } catch (e) {
        log.error({ err: e, route: req.originalUrl }, 'route handler error');
        res.status(500).json({ error: e.message });
    }
});

// 统计分析
router.get('/api/statistics', (req, res) => {
    try {
        const {
            provider,
            dateFrom = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString().split('T')[0],
            dateTo = new Date().toISOString().split('T')[0]
        } = req.query;

        const stats = dbService.getStatistics({
            provider,
            dateFrom,
            dateTo
        });

        res.json({
            success: true,
            statistics: stats,
            period: { dateFrom, dateTo }
        });
    } catch (e) {
        log.error({ err: e, route: req.originalUrl }, 'route handler error');
        res.status(500).json({ error: e.message });
    }
});

// 全文搜索
router.get('/api/search', (req, res) => {
    try {
        const { q, limit = 20 } = req.query;

        if (!q) {
            return res.status(400).json({ error: 'Query parameter "q" is required' });
        }

        const results = dbService.fullTextSearch(q, Number(limit));

        res.json({
            success: true,
            query: q,
            results,
            count: results.length
        });
    } catch (e) {
        log.error({ err: e, route: req.originalUrl }, 'route handler error');
        res.status(500).json({ error: e.message });
    }
});

// 最近记录
router.get('/api/recent', (req, res) => {
    try {
        const { limit = 10 } = req.query;
        const records = dbService.getRecentGenerations(Number(limit));

        res.json({
            success: true,
            records
        });
    } catch (e) {
        log.error({ err: e, route: req.originalUrl }, 'route handler error');
        res.status(500).json({ error: e.message });
    }
});

module.exports = router;
