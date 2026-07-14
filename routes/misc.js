'use strict';

const express = require('express');
const {
  deleteCard,
} = require('./_shared');
const log = require('../lib/logger').child({ module: 'routes/misc' });

const router = express.Router();

// 删除记录（数据库 + 文件）
router.delete('/api/records/:id', async (req, res) => {
    try {
        const recordId = Number(req.params.id);

        const result = deleteCard(recordId);
        if (!result) {
            return res.status(404).json({ error: 'Record not found' });
        }

        log.info({ recordId, filesRemoved: result.deletedFiles }, 'delete: record deleted');

        res.json({
            success: true,
            message: 'Record deleted successfully',
            deletedFiles: result.deletedFiles,
            highlightDeleted: result.highlightDeleted,
            archivedStudyItems: result.database.archivedStudyItems,
            cleanupErrors: result.cleanupErrors
        });

    } catch (err) {
        log.error({ err, route: req.originalUrl }, 'route handler error');
        res.status(500).json({ error: err.message });
    }
});

module.exports = router;
