'use strict';

const express = require('express');
const path = require('path');
const {
  dbService,
  E2E_TEST_MODE,
  buildE2ETrainingResult,
  persistTrainingAssetRecord,
  generateAndPersistTrainingAsset,
  backfillTrainingAssets,
} = require('./_shared');

const router = express.Router();

router.get('/api/training/backfill/summary', (req, res) => {
    try {
        const summary = dbService.getTrainingBackfillSummary({
            folderName: String(req.query.folder || '').trim(),
            cardType: String(req.query.cardType || '').trim(),
            provider: String(req.query.provider || '').trim().toLowerCase()
        });
        res.json({ success: true, summary });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

router.post('/api/training/backfill', async (req, res) => {
    try {
        const {
            limit = 20,
            force = false,
            folder = '',
            cardType = '',
            provider = ''
        } = req.body || {};

        const result = await backfillTrainingAssets({
            limit,
            force,
            folderName: folder,
            cardType,
            provider
        });
        res.json({ success: true, ...result });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

router.get('/api/training/by-generation/:id', (req, res) => {
    try {
        const generationId = Number(req.params.id || 0);
        if (!generationId) {
            return res.status(400).json({ error: 'invalid generation id' });
        }
        const training = dbService.getCardTrainingAssetByGenerationId(generationId);
        if (!training) {
            return res.status(404).json({ error: 'training asset not found' });
        }
        res.json({ success: true, training });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

router.get('/api/training/by-file', (req, res) => {
    try {
        const folder = String(req.query.folder || '').trim();
        const base = String(req.query.base || '').trim();
        if (!folder || !base) {
            return res.status(400).json({ error: 'folder and base are required' });
        }
        const training = dbService.getCardTrainingAssetByFile(folder, base);
        if (!training) {
            return res.status(404).json({ error: 'training asset not found' });
        }
        res.json({ success: true, training });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

router.post('/api/training/by-generation/:id/regenerate', async (req, res) => {
    try {
        const generationId = Number(req.params.id || 0);
        if (!generationId) {
            return res.status(400).json({ error: 'invalid generation id' });
        }
        const record = dbService.getGenerationById(generationId);
        if (!record) {
            return res.status(404).json({ error: 'generation not found' });
        }
        const targetDir = record.md_file_path ? path.dirname(record.md_file_path) : '';
        const training = E2E_TEST_MODE
          ? persistTrainingAssetRecord({
              generationId: record.id,
              phrase: record.phrase,
              cardType: record.card_type,
              folderName: record.folder_name,
              baseName: record.base_filename,
              targetDir
            }, buildE2ETrainingResult({ phrase: record.phrase, cardType: record.card_type }))
          : await generateAndPersistTrainingAsset({
              generationId: record.id,
              phrase: record.phrase,
              cardType: record.card_type,
              markdown: record.markdown_content || '',
              folderName: record.folder_name,
              baseName: record.base_filename,
              targetDir
            });
        res.json({ success: true, training });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

module.exports = router;
