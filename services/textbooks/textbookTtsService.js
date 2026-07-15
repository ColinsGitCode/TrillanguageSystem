'use strict';

const fs = require('node:fs');
const path = require('node:path');
const defaultDbService = require('../storage/databaseService');
const { generateAudioBatch } = require('../generation/ttsService');
const { TEXTBOOK_WORK_PATH } = require('../../lib/serverConfig');
const { textbookError } = require('./textbookErrors');

function expressionSuffix(language, expressionKey) {
  const stableKey = String(expressionKey || '')
    .toLowerCase()
    .replace(/^expr:/u, '')
    .replace(/[^a-z0-9]+/gu, '_')
    .replace(/^_+|_+$/gu, '');
  return `_${language}_expr_${stableKey || 'unknown'}`;
}

function safePathSegment(value) {
  const segment = String(value || '').replace(/[^a-z0-9._-]/giu, '_');
  if (!segment || segment === '.' || segment === '..') throw textbookError('TEXTBOOK_MEDIA_PATH_REJECTED', 403);
  return segment;
}

class TextbookTtsService {
  constructor(options = {}) {
    this.dbService = options.dbService || defaultDbService;
    this.generateAudioBatch = options.generateAudioBatch || generateAudioBatch;
    this.workPath = options.workPath || TEXTBOOK_WORK_PATH;
  }

  async generateTrack(trackId, { force = false } = {}) {
    const track = this.dbService.getTextbookTrack(trackId);
    if (!track) throw textbookError('TEXTBOOK_TRACK_NOT_FOUND', 404);
    if (track.status !== 'published' || !track.generation_id) {
      throw textbookError('TEXTBOOK_TRACK_NOT_PUBLISHED', 409);
    }
    const outputDir = path.join(
      this.workPath,
      safePathSegment(track.course_key),
      `track-${String(track.track_number).padStart(2, '0')}`,
      'audio'
    );
    fs.mkdirSync(outputDir, { recursive: true });
    const existing = new Map(
      this.dbService.listTextbookAudioFiles(track.generation_id)
        .map((audio) => [audio.filename_suffix, audio])
    );
    const tasks = [];
    for (const expression of track.expressions.filter((item) => item.lifecycle === 'active')) {
      for (const language of ['en', 'ja']) {
        const filenameSuffix = expressionSuffix(language, expression.expression_key);
        const current = existing.get(filenameSuffix);
        if (
          !force
          && current
          && ['generated', 'fallback_generated'].includes(current.status)
          && current.text === (language === 'en' ? expression.official_en_text : expression.official_ja_text)
          && fs.existsSync(current.file_path)
        ) {
          continue;
        }
        tasks.push({
          lang: language,
          text: language === 'en' ? expression.official_en_text : expression.official_ja_text,
          filename_suffix: filenameSuffix,
          extension: language === 'en' ? 'mp3' : 'wav',
          expressionId: Number(expression.expression_id),
        });
      }
    }

    const generated = await this.generateAudioBatch(tasks, {
      outputDir,
      baseName: `track-${String(track.track_number).padStart(2, '0')}`,
    });
    const resultByIndex = new Map(generated.results.map((result) => [result.index, result]));
    const errorByIndex = new Map(generated.errors.map((error) => [error.index, error]));
    const rows = tasks.map((task, index) => {
      const result = resultByIndex.get(index);
      const error = errorByIndex.get(index);
      const expectedExtension = task.extension;
      const expectedPath = path.join(
        outputDir,
        `track-${String(track.track_number).padStart(2, '0')}${task.filename_suffix}.${expectedExtension}`
      );
      return {
        language: task.lang,
        text: task.text,
        filenameSuffix: task.filename_suffix,
        filePath: result?.filePath || expectedPath,
        ttsProvider: result?.ttsProvider || null,
        ttsModel: result?.ttsModel || null,
        ttsVoice: result?.ttsVoice || null,
        fileSize: result?.filePath && fs.existsSync(result.filePath) ? fs.statSync(result.filePath).size : null,
        format: result?.extension || expectedExtension,
        status: result?.status || 'failed',
        errorMessage: error?.message || null,
      };
    });
    if (rows.length) this.dbService.upsertTextbookAudioFiles(track.generation_id, rows);
    const refreshed = this.dbService.getTextbookTrack(track.id);
    return {
      track: refreshed,
      summary: {
        requested: tasks.length,
        generated: generated.results.length,
        failed: generated.errors.length,
        skipped: Math.max(0, (track.expressions.filter((item) => item.lifecycle === 'active').length * 2) - tasks.length),
      },
    };
  }
}

module.exports = {
  TextbookTtsService,
  expressionSuffix,
};
