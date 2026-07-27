'use strict';

const express = require('express');
const path = require('path');
const {
  deleteCard,
  deleteRecordFiles,
} = require('./_shared');
const { dbService } = require('./_shared');
const log = require('../lib/logger').child({ module: 'routes/files' });

const router = express.Router();

router.get('/api/folders', (req, res) => {
    const listFoldersWithHtml = require('../services/storage/fileManager').listFoldersWithHtml; // Lazy require
    try {
        const folders = listFoldersWithHtml();
        res.json({ folders });
    } catch (e) { res.status(500).json({ error: e.message }); }
});

router.get('/api/folders/:folder/files', (req, res) => {
    const listHtmlFilesInFolder = require('../services/storage/fileManager').listHtmlFilesInFolder;
    try {
        const files = listHtmlFilesInFolder(req.params.folder);
        res.json({ files });
    } catch (e) { res.status(500).json({ error: e.message }); }
});

router.get('/api/folders/:folder/files/:file', (req, res) => {
    const readFileInFolder = require('../services/storage/fileManager').readFileInFolder;
    try {
        const content = readFileInFolder(req.params.folder, req.params.file);
        const ext = path.extname(req.params.file || '').toLowerCase();
        if (ext === '.wav') {
            res.set('Content-Type', 'audio/wav');
            res.send(content);
            return;
        }
        if (ext === '.mp3') {
            res.set('Content-Type', 'audio/mpeg');
            res.send(content);
            return;
        }
        res.send(content);
    } catch (e) { res.status(404).send('Not Found'); }
});

// 根据文件夹+文件名定位记录
router.get('/api/records/by-file', (req, res) => {
    try {
        const folder = String(req.query.folder || '').trim();
        const baseRaw = String(req.query.base || '');
        const baseTrimmed = baseRaw.trim();
        if (!folder || !baseTrimmed) {
            return res.status(400).json({ error: 'folder and base are required' });
        }

        const baseCandidates = Array.from(new Set([baseRaw, baseTrimmed].filter(Boolean)));
        let record = null;
        for (const candidate of baseCandidates) {
            record = dbService.getGenerationByFile(folder, candidate);
            if (record) break;
        }
        if (!record) {
            return res.status(404).json({ error: 'Record not found' });
        }
        const fullRecord = dbService.getGenerationById(record.id);
        res.json({ record: fullRecord || record });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// 按文件名删除记录与文件（支持无数据库记录的历史文件）
router.delete('/api/records/by-file', (req, res) => {
    try {
        const folder = String(req.query.folder || '').trim();
        const baseRaw = String(req.query.base || '');
        const baseTrimmed = baseRaw.trim();
        if (!folder || !baseTrimmed) {
            return res.status(400).json({ error: 'folder and base are required' });
        }

        const deletedPaths = new Set();
        const baseCandidates = Array.from(new Set([baseRaw, baseTrimmed].filter(Boolean)));

        // 1) 尝试按数据库记录删除
        let record = null;
        let archivedStudyItems = 0;
        let cleanupErrors = [];
        let annotationsDeleted = 0;
        for (const candidate of baseCandidates) {
            record = dbService.getGenerationByFile(folder, candidate);
            if (record) break;
        }
        if (record) {
            const result = deleteCard(record.id);
            for (const filePath of result?.deletedPaths || []) deletedPaths.add(filePath);
            archivedStudyItems = result?.database?.archivedStudyItems || 0;
            cleanupErrors = result?.cleanupErrors || [];
            annotationsDeleted += result?.database?.deletedAnnotations || 0;
        }

        // 2) 兜底：按文件名扫描删除
        const fallbackDeleted = deleteRecordFiles(folder, baseRaw);
        fallbackDeleted.forEach((p) => deletedPaths.add(p));

        res.json({
            success: true,
            deletedFiles: deletedPaths.size,
            recordDeleted: Boolean(record),
            annotationsDeleted,
            archivedStudyItems,
            cleanupErrors
        });
    } catch (err) {
        log.error({ err, route: req.originalUrl }, 'route handler error');
        res.status(500).json({ error: err.message });
    }
});

module.exports = router;
