'use strict';

const express = require('express');
const path = require('path');
const fs = require('fs');
const {
  deleteRecordFiles,
  dbService,
  buildTrainingSidecarPath,
} = require('./_shared');
const log = require('../lib/logger').child({ module: 'routes/misc' });

const router = express.Router();

router.get('/api/experiments/:id', (req, res) => {
    try {
        const experimentId = String(req.params.id || '').trim();
        if (!experimentId) {
            return res.status(400).json({ error: 'experiment id required' });
        }
        const runs = dbService.getFewShotRuns(experimentId);
        const examples = dbService.getFewShotExamples(runs.map(r => r.id));
        const rounds = dbService.getExperimentRoundTrend(experimentId);
        const samples = dbService.getExperimentSamples(experimentId);
        const teacherRefs = dbService.getTeacherReferences(experimentId);
        const baseline = rounds.find((r) => Number(r.roundNumber) === 0) || rounds[0] || null;
        const deltas = rounds.map((round) => ({
            roundNumber: round.roundNumber,
            roundName: round.roundName,
            deltaQuality: baseline ? (Number(round.avgQualityScore || 0) - Number(baseline.avgQualityScore || 0)) : 0,
            deltaTokens: baseline ? (Number(round.avgTokensTotal || 0) - Number(baseline.avgTokensTotal || 0)) : 0,
            deltaLatency: baseline ? (Number(round.avgLatencyMs || 0) - Number(baseline.avgLatencyMs || 0)) : 0,
            deltaTeacherGap: baseline ? (Number(round.teacherGap || 0) - Number(baseline.teacherGap || 0)) : 0
        }));
        res.json({
            experimentId,
            runs,
            examples,
            rounds,
            samples,
            teacherRefs,
            deltas,
            trend: {
                roundCount: rounds.length,
                sampleCount: samples.length,
                hasTeacher: teacherRefs.length > 0
            }
        });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// 删除记录（数据库 + 文件）
router.delete('/api/records/:id', async (req, res) => {
    try {
        const recordId = Number(req.params.id);

        // 1. 从数据库获取记录详情
        const record = dbService.getGenerationById(recordId);

        if (!record) {
            return res.status(404).json({ error: 'Record not found' });
        }

        // 2. 删除物理文件
        const filesToDelete = [
            record.md_file_path,
            record.html_file_path,
            record.meta_file_path,
            record.md_file_path && record.base_filename
                ? buildTrainingSidecarPath(path.dirname(record.md_file_path), record.base_filename)
                : null
        ].filter(Boolean);

        // 获取音频文件路径
        if (record.audioFiles && Array.isArray(record.audioFiles)) {
            record.audioFiles.forEach(audio => {
                if (audio.file_path) {
                    filesToDelete.push(audio.file_path);
                }
            });
        }

        // 删除文件
        const deletedPaths = new Set();
        for (const filePath of filesToDelete) {
            try {
                if (fs.existsSync(filePath)) {
                    fs.unlinkSync(filePath);
                    deletedPaths.add(filePath);
                    log.info({ filePath }, 'delete: removed file');
                }
            } catch (fileErr) {
                log.warn({ err: fileErr, filePath }, 'delete: failed to remove file');
            }
        }

        // 兜底清理：处理历史遗留的音频/sidecar文件（即使未写入 audio_files 表也可清理）
        try {
            const fallbackDeleted = deleteRecordFiles(record.folder_name, record.base_filename);
            fallbackDeleted.forEach((filePath) => deletedPaths.add(filePath));
        } catch (cleanupErr) {
            log.warn({ err: cleanupErr }, 'delete: fallback file cleanup failed');
        }

        // 3. 从数据库删除记录（级联删除会自动删除音频和observability记录）
        dbService.deleteGeneration(recordId);

        // 兼容旧数据：若标红记录未绑定 generation_id，则按 folder/base 再清理一次
        const highlightDeleted = dbService.deleteCardHighlightByFile(record.folder_name, record.base_filename);
        const trainingDeleted = dbService.deleteCardTrainingAssetByFile(record.folder_name, record.base_filename);

        log.info({ recordId, filesRemoved: deletedPaths.size }, 'delete: record deleted');

        res.json({
            success: true,
            message: 'Record deleted successfully',
            deletedFiles: deletedPaths.size,
            highlightDeleted,
            trainingDeleted
        });

    } catch (err) {
        log.error({ err, route: req.originalUrl }, 'route handler error');
        res.status(500).json({ error: err.message });
    }
});

module.exports = router;
