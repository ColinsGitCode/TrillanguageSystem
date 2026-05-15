'use strict';

const express = require('express');
const path = require('path');
const fs = require('fs');
const {
  deleteRecordFiles,
  dbService,
  buildTrainingSidecarPath,
} = require('./_shared');

const router = express.Router();

router.get('/api/folders', (req, res) => {
    const listFoldersWithHtml = require('../services/fileManager').listFoldersWithHtml; // Lazy require
    try {
        const folders = listFoldersWithHtml();
        res.json({ folders });
    } catch (e) { res.status(500).json({ error: e.message }); }
});

router.get('/api/folders/:folder/files', (req, res) => {
    const listHtmlFilesInFolder = require('../services/fileManager').listHtmlFilesInFolder;
    try {
        const files = listHtmlFilesInFolder(req.params.folder);
        res.json({ files });
    } catch (e) { res.status(500).json({ error: e.message }); }
});

router.get('/api/folders/:folder/files/:file', (req, res) => {
    const readFileInFolder = require('../services/fileManager').readFileInFolder;
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

// 卡片标红：读取（按 folder/base/sourceHash）
router.get('/api/highlights/by-file', (req, res) => {
    try {
        const folder = String(req.query.folder || '').trim();
        const base = String(req.query.base || '').trim();
        const sourceHash = String(req.query.sourceHash || '').trim();
        if (!folder || !base || !sourceHash) {
            return res.status(400).json({ error: 'folder, base and sourceHash are required' });
        }
        const highlight = dbService.getCardHighlightByFile(folder, base, sourceHash);
        res.json({ success: true, highlight: highlight || null });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// 卡片标红：保存（upsert）
router.put('/api/highlights/by-file', (req, res) => {
    try {
        const {
            folder,
            base,
            sourceHash,
            html,
            generationId = null,
            version = 1,
            updatedBy = 'ui'
        } = req.body || {};

        const folderName = String(folder || '').trim();
        const baseFilename = String(base || '').trim();
        const hash = String(sourceHash || '').trim();
        const htmlContent = String(html || '');
        if (!folderName || !baseFilename || !hash) {
            return res.status(400).json({ error: 'folder, base and sourceHash are required' });
        }
        if (!htmlContent.trim()) {
            return res.status(400).json({ error: 'html is required' });
        }
        if (htmlContent.length > 2_000_000) {
            return res.status(400).json({ error: 'html too large' });
        }

        const saved = dbService.upsertCardHighlight({
            folderName,
            baseFilename,
            sourceHash: hash,
            htmlContent,
            generationId: generationId ? Number(generationId) : null,
            version: Number(version || 1),
            updatedBy
        });

        res.json({ success: true, highlight: saved });
    } catch (err) {
        res.status(400).json({ error: err.message });
    }
});

// 卡片标红：删除（可选 sourceHash，默认删该卡片全部版本）
router.delete('/api/highlights/by-file', (req, res) => {
    try {
        const folder = String(req.query.folder || '').trim();
        const base = String(req.query.base || '').trim();
        const sourceHash = String(req.query.sourceHash || '').trim();
        if (!folder || !base) {
            return res.status(400).json({ error: 'folder and base are required' });
        }
        const deleted = dbService.deleteCardHighlightByFile(folder, base, sourceHash);
        res.json({ success: true, deleted });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
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
        for (const candidate of baseCandidates) {
            record = dbService.getGenerationByFile(folder, candidate);
            if (record) break;
        }
        if (record) {
            const recordDetail = dbService.getGenerationById(record.id);
            const recordFiles = [
                recordDetail?.md_file_path,
                recordDetail?.html_file_path,
                recordDetail?.meta_file_path,
            ].filter(Boolean);
            if (recordDetail?.md_file_path && recordDetail?.base_filename) {
                recordFiles.push(buildTrainingSidecarPath(path.dirname(recordDetail.md_file_path), recordDetail.base_filename));
            }

            if (recordDetail?.audioFiles?.length) {
                recordDetail.audioFiles.forEach((audio) => {
                    if (audio.file_path) recordFiles.push(audio.file_path);
                });
            }

            recordFiles.forEach((filePath) => {
                try {
                    if (fs.existsSync(filePath)) {
                        fs.unlinkSync(filePath);
                        deletedPaths.add(filePath);
                    }
                } catch (err) {
                    console.warn(`[Delete] Failed to remove file: ${filePath}`, err.message);
                }
            });

            dbService.deleteGeneration(record.id);
        }

        // 2) 兜底：按文件名扫描删除
        const fallbackDeleted = deleteRecordFiles(folder, baseRaw);
        fallbackDeleted.forEach((p) => deletedPaths.add(p));

        // 3) 清理卡片标红（兼容 generation_id 缺失场景）
        let highlightDeleted = 0;
        baseCandidates.forEach((candidate) => {
            highlightDeleted += dbService.deleteCardHighlightByFile(folder, candidate);
        });
        let trainingDeleted = 0;
        baseCandidates.forEach((candidate) => {
            trainingDeleted += dbService.deleteCardTrainingAssetByFile(folder, candidate);
        });

        res.json({
            success: true,
            deletedFiles: deletedPaths.size,
            recordDeleted: Boolean(record),
            highlightDeleted,
            trainingDeleted
        });
    } catch (err) {
        console.error('[API /records/by-file DELETE] Error:', err);
        res.status(500).json({ error: err.message });
    }
});

module.exports = router;
