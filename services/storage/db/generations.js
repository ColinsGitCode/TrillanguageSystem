'use strict';

// Generations + errors domain extracted from databaseService.js. Owns the
// generations table (and its observability_metrics + audio_files children via
// transaction insert), plus generation_errors and the FTS-backed search.
// Functions take `db` first; databaseService.js wraps these as class methods.

const { safeJsonParse } = require('./helpers');
const log = require('../../../lib/logger').child({ module: 'svc/db/generations' });

function insertGeneration(db, data) {
  const transaction = db.transaction((genData, obsData, audioData) => {
    try {
      const genInsert = db.prepare(`
        INSERT INTO generations (
          phrase, phrase_language, card_type, source_mode, llm_provider, llm_model,
          folder_name, base_filename, md_file_path, html_file_path, meta_file_path,
          markdown_content, en_translation, ja_translation, zh_translation,
          generation_date, request_id
        ) VALUES (
          @phrase, @phraseLanguage, @cardType, @sourceMode, @llmProvider, @llmModel,
          @folderName, @baseFilename, @mdFilePath, @htmlFilePath, @metaFilePath,
          @markdownContent, @enTranslation, @jaTranslation, @zhTranslation,
          @generationDate, @requestId
        )
      `);

      const genResult = genInsert.run(genData);
      const generationId = genResult.lastInsertRowid;

      const obsInsert = db.prepare(`
        INSERT INTO observability_metrics (
          generation_id, tokens_input, tokens_output, tokens_total, tokens_cached,
          cost_input, cost_output, cost_total, cost_currency,
          quota_used, quota_limit, quota_remaining, quota_reset_at, quota_percentage,
          performance_total_ms, performance_phases,
          quality_score, quality_checks, quality_dimensions, quality_warnings,
          prompt_full, prompt_parsed, llm_output, llm_finish_reason, metadata
        ) VALUES (
          @generationId, @tokensInput, @tokensOutput, @tokensTotal, @tokensCached,
          @costInput, @costOutput, @costTotal, @costCurrency,
          @quotaUsed, @quotaLimit, @quotaRemaining, @quotaResetAt, @quotaPercentage,
          @performanceTotalMs, @performancePhases,
          @qualityScore, @qualityChecks, @qualityDimensions, @qualityWarnings,
          @promptFull, @promptParsed, @llmOutput, @llmFinishReason, @metadata
        )
      `);

      obsInsert.run({ ...obsData, generationId });

      if (audioData && audioData.length > 0) {
        const audioInsert = db.prepare(`
          INSERT INTO audio_files (
            generation_id, language, text, filename_suffix, file_path,
            tts_provider, tts_model, status
          ) VALUES (
            @generationId, @language, @text, @filenameSuffix, @filePath,
            @ttsProvider, @ttsModel, @status
          )
        `);

        for (const audio of audioData) {
          audioInsert.run({ ...audio, generationId });
        }
      }

      return generationId;
    } catch (error) {
      log.error({ err: error }, 'insert error');
      throw error;
    }
  });

  return transaction(data.generation, data.observability, data.audioFiles || []);
}

function insertError(db, errorData) {
  const stmt = db.prepare(`
    INSERT INTO generation_errors (
      phrase, llm_provider, request_id, error_type, error_message,
      error_stack, prompt, llm_response, validation_errors
    ) VALUES (
      @phrase, @llmProvider, @requestId, @errorType, @errorMessage,
      @errorStack, @prompt, @llmResponse, @validationErrors
    )
  `);

  return stmt.run(errorData);
}

function query(db, { page = 1, limit = 20, provider, cardType, dateFrom, dateTo, search }) {
  let sql = `
    SELECT g.*,
      (SELECT COUNT(*) FROM audio_files WHERE generation_id = g.id AND status = 'generated') as audio_count,
      om.quality_score, om.tokens_total, om.cost_total, om.performance_total_ms
    FROM generations g
    LEFT JOIN observability_metrics om ON g.id = om.generation_id
    WHERE 1=1
  `;

  const params = {};

  if (provider) {
    sql += ` AND g.llm_provider = @provider`;
    params.provider = provider;
  }

  if (cardType) {
    sql += ` AND g.card_type = @cardType`;
    params.cardType = cardType;
  }

  if (dateFrom) {
    sql += ` AND g.generation_date >= @dateFrom`;
    params.dateFrom = dateFrom;
  }

  if (dateTo) {
    sql += ` AND g.generation_date <= @dateTo`;
    params.dateTo = dateTo;
  }

  if (search) {
    sql += ` AND g.id IN (
      SELECT rowid FROM generations_fts WHERE generations_fts MATCH @search
    )`;
    params.search = search;
  }

  sql += ` ORDER BY g.created_at DESC LIMIT @limit OFFSET @offset`;
  params.limit = limit;
  params.offset = (page - 1) * limit;

  return db.prepare(sql).all(params);
}

function getTotalCount(db, { provider, cardType, dateFrom, dateTo, search }) {
  let sql = `SELECT COUNT(*) as total FROM generations WHERE 1=1`;
  const params = {};

  if (provider) { sql += ` AND llm_provider = @provider`; params.provider = provider; }
  if (cardType) { sql += ` AND card_type = @cardType`; params.cardType = cardType; }
  if (dateFrom) { sql += ` AND generation_date >= @dateFrom`; params.dateFrom = dateFrom; }
  if (dateTo) { sql += ` AND generation_date <= @dateTo`; params.dateTo = dateTo; }
  if (search) {
    sql += ` AND id IN (
      SELECT rowid FROM generations_fts WHERE generations_fts MATCH @search
    )`;
    params.search = search;
  }

  return db.prepare(sql).get(params).total;
}

function getById(db, id) {
  const generation = db.prepare(`SELECT * FROM generations WHERE id = ?`).get(id);
  if (!generation) return null;

  const observability = db.prepare(`
    SELECT * FROM observability_metrics WHERE generation_id = ?
  `).get(id);

  const audioFiles = db.prepare(`
    SELECT * FROM audio_files WHERE generation_id = ? ORDER BY filename_suffix
  `).all(id);

  return {
    ...generation,
    observability: observability ? {
      ...observability,
      performance_phases: JSON.parse(observability.performance_phases || '{}'),
      quality_checks: JSON.parse(observability.quality_checks || '[]'),
      quality_dimensions: JSON.parse(observability.quality_dimensions || '{}'),
      quality_warnings: JSON.parse(observability.quality_warnings || '[]'),
      prompt_parsed: JSON.parse(observability.prompt_parsed || '{}'),
      metadata: JSON.parse(observability.metadata || '{}')
    } : null,
    audioFiles
  };
}

function getByFile(db, folderName, baseFilename) {
  const generation = db.prepare(`
    SELECT * FROM generations
    WHERE folder_name = ? AND base_filename = ?
    ORDER BY id DESC
    LIMIT 1
  `).get(folderName, baseFilename);

  return generation || null;
}

function fullTextSearch(db, query, limit = 20) {
  const sql = `
    SELECT g.*,
      snippet(generations_fts, 4, '<mark>', '</mark>', '...', 30) as snippet
    FROM generations_fts
    JOIN generations g ON generations_fts.rowid = g.id
    WHERE generations_fts MATCH @query
    ORDER BY rank
    LIMIT @limit
  `;
  return db.prepare(sql).all({ query, limit });
}

function getRecent(db, limit = 10) {
  const sql = `
    SELECT g.id, g.phrase, g.llm_provider, g.created_at,
      om.quality_score, om.tokens_total
    FROM generations g
    LEFT JOIN observability_metrics om ON g.id = om.generation_id
    ORDER BY g.created_at DESC
    LIMIT ?
  `;
  return db.prepare(sql).all(limit);
}

function remove(db, id) {
  const result = db.prepare(`DELETE FROM generations WHERE id = ?`).run(id);
  if (result.changes === 0) {
    throw new Error(`Generation with id ${id} not found`);
  }
  log.info({ id, changes: result.changes }, 'deleted generation');
  return result.changes;
}

module.exports = {
  insertGeneration,
  insertError,
  query,
  getTotalCount,
  getById,
  getByFile,
  fullTextSearch,
  getRecent,
  remove,
  // alias `safeJsonParse` re-export for the few external callers that pulled
  // it through dbService — keeps the migration lossless.
  safeJsonParse,
};
