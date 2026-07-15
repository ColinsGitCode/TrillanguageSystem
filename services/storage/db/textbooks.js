'use strict';

const crypto = require('node:crypto');
const { textbookError } = require('../../textbooks/textbookErrors');

const TEXTBOOK_DECISION_VERSION = 'textbook-publish-v1';
const TEXTBOOK_STATE_VERSION = 'textbook-admission-v1';

function json(value) {
  return JSON.stringify(value ?? {});
}

function nowIso() {
  return new Date().toISOString();
}

function stableJson(value) {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableJson(value[key])}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

function sha256(value) {
  return crypto.createHash('sha256').update(String(value)).digest('hex');
}

function trackBaseFilename(trackNumber) {
  return `track-${String(trackNumber).padStart(2, '0')}`;
}

function projectionPaths(courseKey, trackNumber, revisionNumber) {
  const base = trackBaseFilename(trackNumber);
  const folder = `textbook:${courseKey}`;
  const hiddenPath = `textbook/${courseKey}/${base}/revision-${revisionNumber}`;
  return {
    folder,
    base,
    md: `${hiddenPath}.md`,
    html: `${hiddenPath}.html`,
    meta: `${hiddenPath}.meta.json`,
  };
}

function assetRows(manifest) {
  return manifest.assets.map((asset) => ({
    assetKey: asset.assetKey,
    kind: asset.kind,
    ordinal: asset.ordinal,
    relativePath: asset.relativePath,
    sha256: asset.sha256,
    byteSize: asset.byteSize,
    mimeType: asset.mimeType,
    durationMs: asset.durationMs ?? null,
  }));
}

function importDraft(db, { manifest, manifestRelativePath, manifestHash }) {
  const timestamp = nowIso();
  const txn = db.transaction(() => {
    const existingByFingerprint = db.prepare(`
      SELECT r.id AS revision_id, r.track_id, r.manifest_hash, t.course_id, t.track_number
      FROM textbook_track_revisions r
      JOIN textbook_tracks t ON t.id = r.track_id
      WHERE r.source_fingerprint = ?
    `).get(manifest.integrity.sourceFingerprint);
    if (existingByFingerprint) {
      if (existingByFingerprint.manifest_hash === manifestHash) {
        return getTrack(db, existingByFingerprint.track_id);
      }
      throw textbookError('TEXTBOOK_IMPORT_SOURCE_CONFLICT', 409);
    }

    const courseResult = db.prepare(`
      INSERT INTO textbook_courses(course_key, title, source_notice, status, created_at_utc, updated_at_utc)
      VALUES (@courseKey, @title, @sourceNotice, 'active', @timestamp, @timestamp)
      ON CONFLICT(course_key) DO UPDATE SET
        title = excluded.title,
        source_notice = excluded.source_notice,
        updated_at_utc = excluded.updated_at_utc
    `).run({
      courseKey: manifest.course.key,
      title: manifest.course.title,
      sourceNotice: manifest.course.sourceNotice || null,
      timestamp,
    });
    const course = db.prepare('SELECT id FROM textbook_courses WHERE course_key = ?').get(manifest.course.key);
    const courseId = Number(course?.id || courseResult.lastInsertRowid);

    db.prepare(`
      INSERT INTO textbook_tracks(course_id, track_number, display_order, title, status, created_at_utc, updated_at_utc)
      VALUES (?, ?, ?, ?, 'draft', ?, ?)
      ON CONFLICT(course_id, track_number) DO UPDATE SET
        title = excluded.title,
        updated_at_utc = excluded.updated_at_utc
    `).run(courseId, manifest.track.number, manifest.track.displayOrder || manifest.track.number, manifest.track.title, timestamp, timestamp);
    const track = db.prepare(`
      SELECT id FROM textbook_tracks WHERE course_id = ? AND track_number = ?
    `).get(courseId, manifest.track.number);
    const trackId = Number(track.id);

    const sameRevision = db.prepare(`
      SELECT id FROM textbook_track_revisions
      WHERE track_id = ? AND revision_number = ? AND manifest_hash = ?
    `).get(trackId, manifest.revision.number, manifestHash);
    if (sameRevision) {
      db.prepare('UPDATE textbook_tracks SET pending_revision_id = ?, updated_at_utc = ? WHERE id = ?')
        .run(sameRevision.id, timestamp, trackId);
      return getTrack(db, trackId);
    }

    const conflict = db.prepare(`
      SELECT id FROM textbook_track_revisions
      WHERE track_id = ? AND revision_number = ? AND manifest_hash <> ?
    `).get(trackId, manifest.revision.number, manifestHash);
    if (conflict) throw textbookError('TEXTBOOK_IMPORT_REVISION_CONFLICT', 409);

    const revisionId = Number(db.prepare(`
      INSERT INTO textbook_track_revisions(
        track_id, revision_number, parent_revision_id, status, origin,
        manifest_schema_version, manifest_relative_path, manifest_hash, source_fingerprint,
        content_hash, projection_hash, expression_count, skill_name, skill_version,
        skill_input_summary_json, change_summary_json, created_at_utc
      ) VALUES (
        @trackId, @revisionNumber, NULL, 'draft', 'import',
        @schemaVersion, @manifestRelativePath, @manifestHash, @sourceFingerprint,
        @contentHash, @projectionHash, @expressionCount, @skillName, @skillVersion,
        @skillInputSummaryJson, @changeSummaryJson, @timestamp
      )
    `).run({
      trackId,
      revisionNumber: manifest.revision.number,
      schemaVersion: manifest.schemaVersion,
      manifestRelativePath,
      manifestHash,
      sourceFingerprint: manifest.integrity.sourceFingerprint,
      contentHash: manifest.integrity.contentHash,
      projectionHash: manifest.integrity.contentHash,
      expressionCount: manifest.expressions.length,
      skillName: manifest.import.skillName,
      skillVersion: manifest.import.skillVersion,
      skillInputSummaryJson: json(manifest.import.inputSummary),
      changeSummaryJson: json({ imported: true }),
      timestamp,
    }).lastInsertRowid);

    const insertAsset = db.prepare(`
      INSERT INTO textbook_track_assets(
        revision_id, asset_key, kind, ordinal, relative_path, sha256, byte_size,
        mime_type, duration_ms, availability, observed_mtime_ms, verified_at_utc
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'available', NULL, ?)
    `);
    for (const asset of assetRows(manifest)) {
      insertAsset.run(
        revisionId,
        asset.assetKey,
        asset.kind,
        asset.ordinal,
        asset.relativePath,
        asset.sha256,
        asset.byteSize,
        asset.mimeType,
        asset.durationMs,
        timestamp
      );
    }

    const insertExpression = db.prepare(`
      INSERT INTO textbook_expressions(
        track_id, expression_key, lifecycle, created_revision_id, created_at_utc, updated_at_utc
      ) VALUES (?, ?, 'active', ?, ?, ?)
      ON CONFLICT(track_id, expression_key) DO UPDATE SET
        updated_at_utc = excluded.updated_at_utc
      RETURNING id
    `);
    const lookupExpression = db.prepare(`
      SELECT id FROM textbook_expressions WHERE track_id = ? AND expression_key = ?
    `);
    const insertExpressionRevision = db.prepare(`
      INSERT INTO textbook_expression_revisions(
        revision_id, expression_id, display_ordinal, official_en_text, official_ja_text,
        zh_cue_text, ja_ruby_html, phrase_analysis_json, grammar_points_json,
        confidence_json, source_spans_json, provenance_json, editor_note,
        en_unit_hash, ja_unit_hash, created_at_utc
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    for (const expression of manifest.expressions) {
      const inserted = insertExpression.get(trackId, expression.key, revisionId, timestamp, timestamp);
      const expressionId = Number(inserted?.id || lookupExpression.get(trackId, expression.key).id);
      insertExpressionRevision.run(
        revisionId,
        expressionId,
        expression.ordinal,
        expression.official.en.text,
        expression.official.ja.text,
        expression.derived.zhCue,
        rubyHtml(expression.derived.rubySegments),
        json(expression.derived.analysis?.phrases || []),
        json(expression.derived.analysis?.grammar || []),
        json(expression.confidence),
        json([
          expression.official.en.sourceSpan,
          expression.official.ja.sourceSpan,
        ]),
        json({
          official: { en: 'source-image', ja: 'source-image' },
          derived: { zhCue: 'ai-derived', ruby: 'ai-derived', analysis: 'ai-derived' },
        }),
        expression.editorNote || null,
        expression.unitHashes.en,
        expression.unitHashes.ja,
        timestamp
      );
    }

    db.prepare('UPDATE textbook_tracks SET pending_revision_id = ?, status = ?, updated_at_utc = ? WHERE id = ?')
      .run(revisionId, 'draft', timestamp, trackId);
    return getTrack(db, trackId);
  });
  return txn();
}

function rubyHtml(segments = []) {
  return segments.map((segment) => {
    const text = escapeHtml(segment.text || '');
    if (!segment.reading) return text;
    return `<ruby>${text}<rt>${escapeHtml(segment.reading)}</rt></ruby>`;
  }).join('');
}

function escapeHtml(value) {
  return String(value)
    .replace(/&/gu, '&amp;')
    .replace(/</gu, '&lt;')
    .replace(/>/gu, '&gt;')
    .replace(/"/gu, '&quot;')
    .replace(/'/gu, '&#39;');
}

function listCourses(db) {
  return db.prepare(`
    SELECT c.*,
      COUNT(t.id) AS track_count,
      SUM(CASE WHEN t.status = 'published' THEN 1 ELSE 0 END) AS published_track_count
    FROM textbook_courses c
    LEFT JOIN textbook_tracks t ON t.course_id = c.id
    GROUP BY c.id
    ORDER BY c.updated_at_utc DESC, c.id DESC
  `).all();
}

function getCourse(db, id) {
  const course = db.prepare('SELECT * FROM textbook_courses WHERE id = ?').get(id);
  if (!course) return null;
  const tracks = db.prepare(`
    SELECT t.*, r.expression_count, r.manifest_hash
    FROM textbook_tracks t
    LEFT JOIN textbook_track_revisions r ON r.id = COALESCE(t.current_revision_id, t.pending_revision_id)
    WHERE t.course_id = ?
    ORDER BY t.display_order, t.track_number
  `).all(course.id);
  return { ...course, tracks };
}

function getTrack(db, id) {
  const track = db.prepare(`
    SELECT t.*, c.course_key, c.title AS course_title,
      r.id AS revision_id, r.revision_number, r.status AS revision_status,
      r.expression_count, r.manifest_hash, r.source_fingerprint, r.content_hash, r.projection_hash
    FROM textbook_tracks t
    JOIN textbook_courses c ON c.id = t.course_id
    LEFT JOIN textbook_track_revisions r ON r.id = COALESCE(t.current_revision_id, t.pending_revision_id)
    WHERE t.id = ?
  `).get(id);
  if (!track) return null;
  const expressions = track.revision_id ? listExpressionsByRevision(db, track.revision_id) : [];
  return {
    ...track,
    expressions,
    assets: track.revision_id ? listAssetsByRevision(db, track.revision_id) : [],
    tts_audio: track.generation_id ? listTextbookAudio(db, track.generation_id).map((audio) => ({
      id: audio.id,
      generation_id: audio.generation_id,
      language: audio.language,
      text: audio.text,
      filename_suffix: audio.filename_suffix,
      tts_provider: audio.tts_provider,
      tts_model: audio.tts_model,
      tts_voice: audio.tts_voice,
      file_size: audio.file_size,
      format: audio.format,
      status: audio.status,
      error_message: audio.error_message,
      generated_at: audio.generated_at,
      playback_url: `/api/textbooks/audio/${audio.id}/content`,
    })) : [],
  };
}

function listTextbookAudio(db, generationId) {
  return db.prepare(`
    SELECT id, generation_id, language, text, filename_suffix, file_path,
      tts_provider, tts_model, tts_voice, file_size, format, status, error_message,
      created_at, generated_at
    FROM audio_files
    WHERE generation_id = ?
    ORDER BY filename_suffix
  `).all(Number(generationId || 0));
}

function upsertTextbookAudioFiles(db, generationId, rows = []) {
  const generation = db.prepare(`
    SELECT id FROM generations WHERE id = ? AND card_type = 'textbook_track'
  `).get(Number(generationId || 0));
  if (!generation) throw textbookError('TEXTBOOK_TRACK_NOT_PUBLISHED', 409);
  const statement = db.prepare(`
    INSERT INTO audio_files(
      generation_id, language, text, filename_suffix, file_path,
      tts_provider, tts_model, tts_voice, file_size, format,
      status, error_message, generated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(generation_id, filename_suffix) DO UPDATE SET
      language=excluded.language,
      text=excluded.text,
      file_path=excluded.file_path,
      tts_provider=excluded.tts_provider,
      tts_model=excluded.tts_model,
      tts_voice=excluded.tts_voice,
      file_size=excluded.file_size,
      format=excluded.format,
      status=excluded.status,
      error_message=excluded.error_message,
      generated_at=excluded.generated_at
  `);
  const transaction = db.transaction(() => {
    for (const row of rows) {
      const generatedAt = ['generated', 'fallback_generated'].includes(row.status) ? nowIso() : null;
      statement.run(
        Number(generationId),
        row.language,
        row.text,
        row.filenameSuffix,
        row.filePath,
        row.ttsProvider,
        row.ttsModel,
        row.ttsVoice,
        row.fileSize,
        row.format,
        row.status,
        row.errorMessage,
        generatedAt
      );
    }
  });
  transaction();
  return listTextbookAudio(db, generationId);
}

function getTextbookAudioFile(db, audioFileId) {
  return db.prepare(`
    SELECT af.*
    FROM audio_files af
    JOIN generations g ON g.id = af.generation_id AND g.card_type = 'textbook_track'
    WHERE af.id = ?
    LIMIT 1
  `).get(Number(audioFileId || 0)) || null;
}

function buildProjectionMarkdown(track, expressions) {
  const lines = [
    `# ${track.title}`,
    '',
    `> Textbook Course: ${track.course_title}`,
    `> Track: ${String(track.track_number).padStart(2, '0')}`,
    '',
    '## Expressions',
    '',
  ];
  for (const expression of expressions) {
    lines.push(
      `### ${String(expression.display_ordinal).padStart(2, '0')}. ${expression.expression_key}`,
      '',
      `- **中文**: ${expression.zh_cue_text}`,
      `- **English**: ${expression.official_en_text}`,
      `- **日本語**: ${expression.official_ja_text}`,
      ''
    );
  }
  return `${lines.join('\n').trim()}\n`;
}

function textbookLocator({ track, expression, direction }) {
  return {
    schemaVersion: 2,
    extractorVersion: 'textbook-unit-v1',
    section: 'textbook-expression',
    trackId: Number(track.id),
    expressionId: Number(expression.expression_id),
    expressionRevisionId: Number(expression.id),
    expressionKey: expression.expression_key,
    direction,
  };
}

function publishTrack(db, trackId, {
  expectedTrackRevision,
  confirmUnitCount,
  expectedPlanRevision,
} = {}) {
  const timestamp = nowIso();
  const txn = db.transaction(() => {
    const track = getTrack(db, trackId);
    if (!track) throw textbookError('TEXTBOOK_TRACK_NOT_FOUND', 404);
    if (track.status !== 'verified' || track.revision_status !== 'verified') {
      throw textbookError('TEXTBOOK_TRACK_NOT_VERIFIED', 409);
    }
    if (expectedTrackRevision !== undefined && Number(expectedTrackRevision) !== Number(track.revision_number)) {
      throw textbookError('TEXTBOOK_REVISION_CONFLICT', 409);
    }
    const unavailableAssets = db.prepare(`
      SELECT COUNT(*) AS count FROM textbook_track_assets
      WHERE revision_id = ? AND availability <> 'available'
    `).get(track.revision_id).count;
    if (unavailableAssets > 0) throw textbookError('TEXTBOOK_MEDIA_NOT_FOUND', 409);
    const expressions = track.expressions.filter((expression) => expression.lifecycle === 'active');
    const unitCount = expressions.length * 2;
    if (confirmUnitCount !== undefined && Number(confirmUnitCount) !== unitCount) {
      throw textbookError('TEXTBOOK_PUBLISH_CONFIRMATION_MISMATCH', 409, { expected: unitCount, actual: Number(confirmUnitCount) });
    }
    const plan = db.prepare('SELECT revision FROM learning_plans WHERE id = 1').get() || null;
    if (expectedPlanRevision !== undefined && plan && Number(expectedPlanRevision) !== Number(plan.revision)) {
      throw textbookError('TEXTBOOK_PLAN_REVISION_CONFLICT', 409, { actualRevision: Number(plan.revision) });
    }

    const projection = projectionPaths(track.course_key, track.track_number, track.revision_number);
    const markdownContent = buildProjectionMarkdown(track, expressions);
    const generationPayload = {
      phrase: track.title,
      phrase_language: 'mixed',
      card_type: 'textbook_track',
      source_mode: 'textbook_import',
      llm_provider: 'textbook',
      llm_model: `import-textbook-track@${track.revision_number}`,
      folder_name: projection.folder,
      base_filename: projection.base,
      md_file_path: projection.md,
      html_file_path: projection.html,
      meta_file_path: projection.meta,
      markdown_content: markdownContent,
      content_hash: track.content_hash,
      en_translation: expressions.map((expression) => expression.official_en_text).join('\n'),
      ja_translation: expressions.map((expression) => expression.official_ja_text).join('\n'),
      zh_translation: expressions.map((expression) => expression.zh_cue_text).join('\n'),
      generation_date: timestamp.slice(0, 10),
      request_id: `textbook:${track.course_key}:track:${String(track.track_number).padStart(2, '0')}`,
    };

    let generationId = track.generation_id ? Number(track.generation_id) : null;
    if (generationId) {
      db.prepare(`
        UPDATE generations SET
          phrase=@phrase, phrase_language=@phrase_language, card_type=@card_type,
          source_mode=@source_mode, llm_provider=@llm_provider, llm_model=@llm_model,
          folder_name=@folder_name, base_filename=@base_filename,
          md_file_path=@md_file_path, html_file_path=@html_file_path, meta_file_path=@meta_file_path,
          markdown_content=@markdown_content, content_hash=@content_hash,
          en_translation=@en_translation, ja_translation=@ja_translation, zh_translation=@zh_translation,
          generation_date=@generation_date, updated_at=CURRENT_TIMESTAMP
        WHERE id=@generationId AND card_type='textbook_track'
      `).run({ ...generationPayload, generationId });
    } else {
      generationId = Number(db.prepare(`
        INSERT INTO generations(
          phrase, phrase_language, card_type, source_mode, llm_provider, llm_model,
          folder_name, base_filename, md_file_path, html_file_path, meta_file_path,
          markdown_content, content_hash, en_translation, ja_translation, zh_translation,
          generation_date, request_id
        ) VALUES (
          @phrase, @phrase_language, @card_type, @source_mode, @llm_provider, @llm_model,
          @folder_name, @base_filename, @md_file_path, @html_file_path, @meta_file_path,
          @markdown_content, @content_hash, @en_translation, @ja_translation, @zh_translation,
          @generation_date, @request_id
        )
      `).run(generationPayload).lastInsertRowid);
      db.prepare(`
        INSERT INTO observability_metrics(
          generation_id, tokens_input, tokens_output, tokens_total, tokens_cached,
          cost_input, cost_output, cost_total, cost_currency,
          performance_total_ms, performance_phases, quality_score, quality_checks,
          quality_dimensions, quality_warnings, prompt_full, prompt_parsed,
          llm_output, llm_finish_reason, metadata
        ) VALUES (?, 0, 0, 0, 0, 0, 0, 0, 'USD', 0, '{}', 100, '[]', '{}', '[]', '', '{}', '', 'textbook-import', ?)
      `).run(generationId, json({ source: 'textbook_publish', trackId: Number(track.id), revisionId: Number(track.revision_id) }));
    }

    db.prepare(`
      INSERT INTO learning_source_admissions(
        generation_id, status, content_hash, reasons_json, decision_version, state_version,
        dp_state_hash, materialization_disposition, identity_anchor_generation_id,
        admission_source, evaluated_at_utc, created_at_utc, updated_at_utc
      ) VALUES (?, 'eligible', ?, '[]', ?, ?, NULL, 'create-items', ?, 'manual', ?, ?, ?)
      ON CONFLICT(generation_id) DO UPDATE SET
        status='eligible', content_hash=excluded.content_hash, reasons_json='[]',
        decision_version=excluded.decision_version, state_version=excluded.state_version,
        materialization_disposition='create-items', identity_anchor_generation_id=excluded.identity_anchor_generation_id,
        admission_source='manual', evaluated_at_utc=excluded.evaluated_at_utc, updated_at_utc=excluded.updated_at_utc
    `).run(generationId, track.content_hash, TEXTBOOK_DECISION_VERSION, TEXTBOOK_STATE_VERSION, generationId, timestamp, timestamp, timestamp);

    const existingItems = new Map(db.prepare(`
      SELECT * FROM study_items WHERE source_generation_id = ?
    `).all(generationId).map((item) => [item.unit_key, item]));
    const expectedKeys = new Set();
    const itemActions = { inserted: 0, updated: 0, unchanged: 0, archived: 0 };
    const upsertItem = db.prepare(`
      INSERT INTO study_items(
        generation_id, source_generation_id, unit_key, unit_kind, unit_locator_json,
        content_hash, content_revision, lifecycle, created_at_utc, updated_at_utc
      ) VALUES (?, ?, ?, ?, ?, ?, 1, 'active', ?, ?)
      ON CONFLICT(source_generation_id, unit_key) DO UPDATE SET
        generation_id=excluded.generation_id,
        unit_kind=excluded.unit_kind,
        unit_locator_json=excluded.unit_locator_json,
        content_revision=study_items.content_revision + CASE
          WHEN study_items.content_hash <> excluded.content_hash
            OR study_items.unit_locator_json <> excluded.unit_locator_json
            OR study_items.unit_kind <> excluded.unit_kind THEN 1 ELSE 0 END,
        content_hash=excluded.content_hash,
        lifecycle='active',
        lifecycle_reason=NULL,
        updated_at_utc=excluded.updated_at_utc
    `);
    for (const expression of expressions) {
      for (const direction of ['en', 'ja']) {
        const unitKey = `${expression.expression_key}:${direction}`;
        const unitKind = `textbook_${direction}`;
        const contentHash = direction === 'en' ? expression.en_unit_hash : expression.ja_unit_hash;
        const locatorJson = stableJson(textbookLocator({ track, expression, direction }));
        expectedKeys.add(unitKey);
        const existing = existingItems.get(unitKey);
        upsertItem.run(generationId, generationId, unitKey, unitKind, locatorJson, contentHash, timestamp, timestamp);
        if (!existing) itemActions.inserted += 1;
        else if (existing.content_hash !== contentHash || existing.unit_locator_json !== locatorJson || existing.unit_kind !== unitKind || existing.lifecycle !== 'active') itemActions.updated += 1;
        else itemActions.unchanged += 1;
      }
    }
    for (const [unitKey, item] of existingItems) {
      if (!expectedKeys.has(unitKey) && item.lifecycle !== 'archived') {
        db.prepare(`
          UPDATE study_items SET lifecycle='archived', lifecycle_reason='textbook-expression-retired', updated_at_utc=?
          WHERE id=?
        `).run(timestamp, item.id);
        itemActions.archived += 1;
      }
    }

    db.prepare(`
      UPDATE textbook_track_revisions SET status='published', verified_at_utc=COALESCE(verified_at_utc, ?) WHERE id=?
    `).run(timestamp, track.revision_id);
    db.prepare(`
      UPDATE textbook_tracks SET status='published', generation_id=?, published_at_utc=COALESCE(published_at_utc, ?),
        current_revision_id=?, pending_revision_id=NULL, updated_at_utc=?
      WHERE id=?
    `).run(generationId, timestamp, track.revision_id, timestamp, track.id);

    return {
      track: getTrack(db, track.id),
      generationId,
      unitCount,
      itemActions,
      planRevision: plan ? Number(plan.revision) : 0,
      shortestIntroductionDays: null,
    };
  });
  const result = txn();
  const plan = db.prepare('SELECT daily_new_limit FROM learning_plans WHERE id = 1').get();
  if (plan && Number(plan.daily_new_limit) > 0) {
    result.shortestIntroductionDays = Math.ceil(result.unitCount / Number(plan.daily_new_limit));
  }
  return result;
}

function previewPublish(db, trackId) {
  const track = getTrack(db, trackId);
  if (!track) throw textbookError('TEXTBOOK_TRACK_NOT_FOUND', 404);
  const activeExpressions = track.expressions.filter((expression) => expression.lifecycle === 'active').length;
  const plan = db.prepare('SELECT revision, daily_new_limit, scope_json FROM learning_plans WHERE id = 1').get() || null;
  return {
    trackId: Number(track.id),
    status: track.status,
    revision: track.revision_number ? Number(track.revision_number) : null,
    expressionCount: activeExpressions,
    unitCount: activeExpressions * 2,
    planRevision: plan ? Number(plan.revision) : 0,
    dailyNewLimit: plan ? Number(plan.daily_new_limit) : null,
    shortestIntroductionDays: plan && Number(plan.daily_new_limit) > 0
      ? Math.ceil((activeExpressions * 2) / Number(plan.daily_new_limit))
      : null,
  };
}

function normalizeTargetCardType(value) {
  const cardType = String(value || '').trim();
  if (!['trilingual', 'grammar_ja'].includes(cardType)) {
    throw textbookError('TEXTBOOK_DERIVATION_TARGET_UNSUPPORTED', 400);
  }
  return cardType;
}

function normalizeSelectionLanguage(value, selectionText) {
  const language = String(value || '').trim();
  if (['en', 'ja'].includes(language)) return language;
  return /[\u3040-\u30ff\u3400-\u9fff]/u.test(String(selectionText || '')) ? 'ja' : 'en';
}

function normalizeSelectionText(value) {
  const text = String(value || '').replace(/\s+/gu, ' ').trim();
  if (!text) throw textbookError('TEXTBOOK_DERIVATION_SELECTION_REQUIRED', 400);
  if (text.length > 240) throw textbookError('TEXTBOOK_DERIVATION_SELECTION_TOO_LONG', 400);
  return text;
}

function getCurrentExpressionRevision(db, expressionId) {
  return db.prepare(`
    SELECT er.*, e.expression_key, e.lifecycle,
      tr.id AS track_id, tr.track_number, tr.title AS track_title, tr.status AS track_status,
      c.course_key, c.title AS course_title
    FROM textbook_expression_revisions er
    JOIN textbook_expressions e ON e.id = er.expression_id
    JOIN textbook_track_revisions rev ON rev.id = er.revision_id
    JOIN textbook_tracks tr ON tr.id = rev.track_id AND tr.current_revision_id = rev.id
    JOIN textbook_courses c ON c.id = tr.course_id
    WHERE er.expression_id = ?
    LIMIT 1
  `).get(Number(expressionId || 0)) || null;
}

function previewDerivation(db, expressionId, input = {}) {
  const expression = getCurrentExpressionRevision(db, expressionId);
  if (!expression || expression.lifecycle !== 'active') {
    throw textbookError('TEXTBOOK_EXPRESSION_NOT_FOUND', 404);
  }
  if (expression.track_status !== 'published') {
    throw textbookError('TEXTBOOK_TRACK_NOT_PUBLISHED', 409);
  }
  const selectionText = normalizeSelectionText(input.selectionText);
  const selectionLanguage = normalizeSelectionLanguage(input.selectionLanguage, selectionText);
  const targetCardType = normalizeTargetCardType(input.targetCardType);
  if (targetCardType === 'grammar_ja' && selectionLanguage !== 'ja') {
    throw textbookError('TEXTBOOK_DERIVATION_TARGET_LANGUAGE_MISMATCH', 400);
  }
  const selectionHash = sha256(`${selectionLanguage}:${selectionText}`);
  const existing = db.prepare(`
    SELECT * FROM textbook_card_derivations
    WHERE expression_id = ? AND selection_hash = ? AND target_card_type = ?
    LIMIT 1
  `).get(expression.expression_id, selectionHash, targetCardType) || null;
  const targetPhrase = targetCardType === 'grammar_ja'
    ? selectionText
    : `${selectionText} / ${selectionLanguage === 'ja' ? expression.official_en_text : expression.official_ja_text}`;
  return {
    expression,
    derivation: existing,
    request: {
      expressionId: Number(expression.expression_id),
      sourceExpressionRevisionId: Number(expression.id),
      selectionLanguage,
      selectionText,
      selectionHash,
      targetCardType,
      targetPhrase,
    },
  };
}

function createDerivation(db, expressionId, input = {}) {
  const timestamp = nowIso();
  const preview = previewDerivation(db, expressionId, input);
  const requestContext = {
    schemaVersion: 1,
    courseKey: preview.expression.course_key,
    trackId: Number(preview.expression.track_id),
    trackNumber: Number(preview.expression.track_number),
    expressionKey: preview.expression.expression_key,
    official: {
      en: preview.expression.official_en_text,
      ja: preview.expression.official_ja_text,
    },
    zhCue: preview.expression.zh_cue_text,
  };
  const txn = db.transaction(() => {
    db.prepare(`
      INSERT INTO textbook_card_derivations(
        expression_id, source_expression_revision_id, selection_language,
        selection_text, selection_hash, target_card_type, status,
        request_context_json, created_at_utc, updated_at_utc
      ) VALUES (?, ?, ?, ?, ?, ?, 'pending', ?, ?, ?)
      ON CONFLICT(expression_id, selection_hash, target_card_type) DO UPDATE SET
        source_expression_revision_id=excluded.source_expression_revision_id,
        selection_language=excluded.selection_language,
        selection_text=excluded.selection_text,
        request_context_json=excluded.request_context_json,
        status=CASE
          WHEN textbook_card_derivations.status IN ('completed', 'running') THEN textbook_card_derivations.status
          ELSE 'pending'
        END,
        updated_at_utc=excluded.updated_at_utc
    `).run(
      preview.request.expressionId,
      preview.request.sourceExpressionRevisionId,
      preview.request.selectionLanguage,
      preview.request.selectionText,
      preview.request.selectionHash,
      preview.request.targetCardType,
      json(requestContext),
      timestamp,
      timestamp
    );
    const derivation = db.prepare(`
      SELECT * FROM textbook_card_derivations
      WHERE expression_id = ? AND selection_hash = ? AND target_card_type = ?
      LIMIT 1
    `).get(preview.request.expressionId, preview.request.selectionHash, preview.request.targetCardType);
    return { ...preview, derivation };
  });
  return txn();
}

function attachDerivationJob(db, derivationId, jobId) {
  const timestamp = nowIso();
  const result = db.prepare(`
    UPDATE textbook_card_derivations
    SET target_job_id = ?, status = 'running', updated_at_utc = ?
    WHERE id = ?
  `).run(Number(jobId || 0), timestamp, Number(derivationId || 0));
  if (!result.changes) throw textbookError('TEXTBOOK_DERIVATION_NOT_FOUND', 404);
  return db.prepare('SELECT * FROM textbook_card_derivations WHERE id = ?').get(Number(derivationId || 0));
}

function syncDerivationJobStatus(db, jobId) {
  const numericJobId = Number(jobId || 0);
  if (!numericJobId) return null;
  const row = db.prepare(`
    SELECT d.*, j.status AS job_status, j.result_generation_id
    FROM textbook_card_derivations d
    JOIN generation_jobs j ON j.id = d.target_job_id
    WHERE d.target_job_id = ?
    LIMIT 1
  `).get(numericJobId);
  if (!row) return null;

  let status = row.status;
  let targetGenerationId = row.target_generation_id ? Number(row.target_generation_id) : null;
  if (row.job_status === 'success' && row.result_generation_id) {
    status = 'completed';
    targetGenerationId = Number(row.result_generation_id);
  } else if (row.job_status === 'failed' || row.job_status === 'cancelled') {
    status = 'failed';
    targetGenerationId = null;
  } else if (row.job_status === 'queued' || row.job_status === 'running') {
    status = 'running';
    targetGenerationId = null;
  }

  db.prepare(`
    UPDATE textbook_card_derivations
    SET status = ?, target_generation_id = ?, updated_at_utc = ?
    WHERE id = ?
  `).run(status, targetGenerationId, nowIso(), row.id);
  return db.prepare('SELECT * FROM textbook_card_derivations WHERE id = ?').get(row.id);
}

function verifyRevision(db, revisionId, { expectedTrackStatus } = {}) {
  const timestamp = nowIso();
  const txn = db.transaction(() => {
    const revision = db.prepare(`
      SELECT r.*, t.status AS track_status
      FROM textbook_track_revisions r
      JOIN textbook_tracks t ON t.id = r.track_id
      WHERE r.id = ?
    `).get(revisionId);
    if (!revision) throw textbookError('TEXTBOOK_REVISION_NOT_FOUND', 404);
    if (expectedTrackStatus && revision.track_status !== expectedTrackStatus) {
      throw textbookError('TEXTBOOK_REVISION_CONFLICT', 409);
    }
    if (!['draft', 'verified'].includes(revision.status)) {
      throw textbookError('TEXTBOOK_REVISION_CONFLICT', 409);
    }
    const unavailableAssets = db.prepare(`
      SELECT COUNT(*) AS count
      FROM textbook_track_assets
      WHERE revision_id = ? AND availability <> 'available'
    `).get(revisionId).count;
    if (unavailableAssets > 0) throw textbookError('TEXTBOOK_MEDIA_NOT_FOUND', 409);

    db.prepare(`
      UPDATE textbook_track_revisions
      SET status = 'verified', verified_at_utc = COALESCE(verified_at_utc, ?)
      WHERE id = ?
    `).run(timestamp, revisionId);
    db.prepare(`
      UPDATE textbook_tracks
      SET status = 'verified',
        current_revision_id = ?,
        pending_revision_id = NULL,
        updated_at_utc = ?
      WHERE id = ?
    `).run(revisionId, timestamp, revision.track_id);
    return getTrack(db, revision.track_id);
  });
  return txn();
}

function listExpressionsByRevision(db, revisionId) {
  return db.prepare(`
    SELECT er.*, e.expression_key, e.lifecycle
    FROM textbook_expression_revisions er
    JOIN textbook_expressions e ON e.id = er.expression_id
    WHERE er.revision_id = ?
    ORDER BY er.display_ordinal
  `).all(revisionId);
}

function listAssetsByRevision(db, revisionId) {
  return db.prepare(`
    SELECT * FROM textbook_track_assets
    WHERE revision_id = ?
    ORDER BY kind, ordinal
  `).all(revisionId);
}

function searchExpressions(db, query, limit = 20) {
  return db.prepare(`
    SELECT er.id, e.expression_key, er.display_ordinal,
      er.official_en_text, er.official_ja_text, er.zh_cue_text,
      snippet(textbook_expressions_fts, 0, '<mark>', '</mark>', '...', 20) AS snippet,
      tr.id AS track_id, tr.track_number, tr.title AS track_title,
      c.course_key, c.title AS course_title
    FROM textbook_expressions_fts
    JOIN textbook_expression_revisions er ON er.id = textbook_expressions_fts.rowid
    JOIN textbook_expressions e ON e.id = er.expression_id
    JOIN textbook_track_revisions rev ON rev.id = er.revision_id
    JOIN textbook_tracks tr ON tr.id = rev.track_id
    JOIN textbook_courses c ON c.id = tr.course_id
    WHERE textbook_expressions_fts MATCH @query
    ORDER BY rank
    LIMIT @limit
  `).all({ query, limit });
}

function getAsset(db, id) {
  return db.prepare(`
    SELECT a.*, r.track_id, t.course_id
    FROM textbook_track_assets a
    JOIN textbook_track_revisions r ON r.id = a.revision_id
    JOIN textbook_tracks t ON t.id = r.track_id
    WHERE a.id = ?
  `).get(id);
}

function markAssetAvailability(db, id, availability) {
  return db.prepare(`
    UPDATE textbook_track_assets
    SET availability = ?, verified_at_utc = ?
    WHERE id = ?
  `).run(availability, nowIso(), id);
}

module.exports = {
  importDraft,
  listCourses,
  getCourse,
  getTrack,
  previewPublish,
  publishTrack,
  verifyRevision,
  searchExpressions,
  getAsset,
  markAssetAvailability,
  previewDerivation,
  createDerivation,
  attachDerivationJob,
  syncDerivationJobStatus,
  upsertTextbookAudioFiles,
  listTextbookAudio,
  getTextbookAudioFile,
};
