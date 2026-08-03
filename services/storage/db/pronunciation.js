'use strict';

function mapDocument(row) {
  if (!row) return null;
  return {
    id: row.id,
    targetKind: row.target_kind,
    targetId: row.target_id,
    sourceContentHash: row.source_content_hash,
    projectionVersion: row.projection_version,
    status: row.status,
    analyzerVersion: row.analyzer_version,
    dictionaryVersion: row.dictionary_version,
    documentHash: row.document_hash,
    revision: row.revision,
    createdAtUtc: row.created_at_utc,
    updatedAtUtc: row.updated_at_utc,
  };
}

function mapToken(row) {
  if (!row) return null;
  return {
    id: row.id,
    documentId: row.document_id,
    tokenKey: row.token_key,
    surface: row.surface,
    startCodePoint: row.start_codepoint,
    endCodePoint: row.end_codepoint,
    readingRaw: row.reading_raw,
    readingHiragana: row.reading_hiragana,
    unitKind: row.unit_kind,
    status: row.status,
    source: row.source,
    ruleVersion: row.rule_version,
    evidence: JSON.parse(row.evidence_json || '{}'),
    components: JSON.parse(row.components_json || '[]'),
    createdAtUtc: row.created_at_utc,
    updatedAtUtc: row.updated_at_utc,
  };
}

function getDocument(db, targetKind, targetId, sourceContentHash) {
  const row = db.prepare(`
    SELECT * FROM pronunciation_documents
    WHERE target_kind = ? AND target_id = ?
      AND (? IS NULL OR source_content_hash = ?)
    ORDER BY revision DESC, id DESC LIMIT 1
  `).get(targetKind, Number(targetId), sourceContentHash || null, sourceContentHash || null);
  return mapDocument(row);
}

function listTokens(db, documentId) {
  return db.prepare(`
    SELECT * FROM pronunciation_tokens
    WHERE document_id = ?
    ORDER BY start_codepoint ASC, end_codepoint ASC, id ASC
  `).all(Number(documentId)).map(mapToken);
}

function insertTokens(db, documentId, tokens, now) {
  const insert = db.prepare(`
    INSERT INTO pronunciation_tokens(
      document_id, token_key, surface, start_codepoint, end_codepoint,
      reading_raw, reading_hiragana, unit_kind, status, source, rule_version,
      evidence_json, components_json, created_at_utc, updated_at_utc
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  for (const token of tokens) {
    insert.run(
      documentId,
      token.tokenKey,
      token.surface,
      token.startCodePoint,
      token.endCodePoint,
      token.readingRaw || null,
      token.readingHiragana || null,
      token.unitKind || 'word',
      token.status || 'accepted',
      token.source || 'analyzer',
      token.ruleVersion || 'pronunciation-v1',
      JSON.stringify(token.evidence || {}),
      JSON.stringify(token.components || []),
      now,
      now,
    );
  }
}

function createDocument(db, payload = {}) {
  const now = payload.now || new Date().toISOString();
  const transaction = db.transaction(() => {
    const existing = db.prepare(`
      SELECT * FROM pronunciation_documents
      WHERE target_kind = ? AND target_id = ? AND source_content_hash = ?
    `).get(payload.targetKind, payload.targetId, payload.sourceContentHash);
    if (existing && existing.document_hash === payload.documentHash) {
      return { document: mapDocument(existing), created: false, tokens: listTokens(db, existing.id) };
    }
    if (existing) {
      if (Number(payload.expectedRevision || 0) !== existing.revision) {
        const error = new Error('Pronunciation document revision is stale');
        error.code = 'PRONUNCIATION_REVISION_STALE';
        error.status = 409;
        throw error;
      }
      db.prepare(`
        UPDATE pronunciation_documents
        SET projection_version = ?, status = ?, analyzer_version = ?, dictionary_version = ?,
            document_hash = ?, revision = ?, updated_at_utc = ?
        WHERE id = ?
      `).run(
        payload.projectionVersion || existing.projection_version,
        payload.status || 'ready',
        payload.analyzerVersion || existing.analyzer_version,
        payload.dictionaryVersion || existing.dictionary_version,
        payload.documentHash,
        existing.revision + 1,
        now,
        existing.id,
      );
      db.prepare('DELETE FROM pronunciation_tokens WHERE document_id = ?').run(existing.id);
      insertTokens(db, existing.id, payload.tokens || [], now);
      return {
        document: mapDocument(db.prepare('SELECT * FROM pronunciation_documents WHERE id = ?').get(existing.id)),
        created: false,
        tokens: listTokens(db, existing.id),
      };
    }
    const result = db.prepare(`
      INSERT INTO pronunciation_documents(
        target_kind, target_id, source_content_hash, projection_version, status,
        analyzer_version, dictionary_version, document_hash, revision,
        created_at_utc, updated_at_utc
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      payload.targetKind,
      payload.targetId,
      payload.sourceContentHash,
      payload.projectionVersion || 'pronunciation-plain-text-v1',
      payload.status || 'ready',
      payload.analyzerVersion || 'unknown',
      payload.dictionaryVersion || 'ja-pronunciation-v1',
      payload.documentHash,
      Number(payload.revision || 1),
      now,
      now,
    );
    const id = Number(result.lastInsertRowid);
    insertTokens(db, id, payload.tokens || [], now);
    return { document: mapDocument(db.prepare('SELECT * FROM pronunciation_documents WHERE id = ?').get(id)), created: true, tokens: listTokens(db, id) };
  });
  return transaction();
}

function updateProjection(db, payload = {}) {
  const now = payload.now || new Date().toISOString();
  const transaction = db.transaction(() => {
    const current = db.prepare('SELECT * FROM pronunciation_documents WHERE id = ?').get(payload.documentId);
    if (!current) {
      const error = new Error('Pronunciation document not found');
      error.code = 'PRONUNCIATION_DOCUMENT_NOT_FOUND';
      throw error;
    }
    if (Number(payload.expectedRevision) !== current.revision) {
      const error = new Error('Pronunciation document revision is stale');
      error.code = 'PRONUNCIATION_REVISION_STALE';
      error.status = 409;
      throw error;
    }
    db.prepare('UPDATE pronunciation_documents SET revision = ?, document_hash = ?, status = ?, updated_at_utc = ? WHERE id = ?')
      .run(current.revision + 1, payload.documentHash, payload.status || current.status, now, current.id);
    db.prepare('DELETE FROM pronunciation_tokens WHERE document_id = ?').run(current.id);
    insertTokens(db, current.id, payload.tokens || [], now);
    return { document: mapDocument(db.prepare('SELECT * FROM pronunciation_documents WHERE id = ?').get(current.id)), tokens: listTokens(db, current.id) };
  });
  return transaction();
}

function appendCorrection(db, payload = {}) {
  const body = String(payload.payloadJson || '{}');
  const existing = db.prepare('SELECT * FROM pronunciation_correction_events WHERE event_key = ?').get(payload.eventKey);
  if (existing) {
    if (existing.payload_hash !== payload.payloadHash) {
      const error = new Error('Pronunciation correction event conflicts with existing event');
      error.code = 'PRONUNCIATION_EVENT_CONFLICT';
      error.status = 409;
      throw error;
    }
    return { id: existing.id, eventKey: existing.event_key, idempotent: true };
  }
  const current = db.prepare('SELECT revision FROM pronunciation_documents WHERE id = ?').get(payload.documentId);
  if (!current) {
    const error = new Error('Pronunciation document not found');
    error.code = 'PRONUNCIATION_DOCUMENT_NOT_FOUND';
    throw error;
  }
  if (Number(payload.expectedRevision) !== current.revision) {
    const error = new Error('Pronunciation document revision is stale');
    error.code = 'PRONUNCIATION_REVISION_STALE';
    error.status = 409;
    throw error;
  }
  const result = db.prepare(`
    INSERT INTO pronunciation_correction_events(
      event_key, document_id, token_key, event_type, payload_hash, payload_json,
      expected_revision, resulting_revision, created_at_utc
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    payload.eventKey,
    payload.documentId,
    payload.tokenKey,
    payload.eventType,
    payload.payloadHash,
    body,
    current.revision,
    current.revision + 1,
    payload.now || new Date().toISOString(),
  );
  return { id: Number(result.lastInsertRowid), eventKey: payload.eventKey, idempotent: false };
}

function applyCorrection(db, payload = {}) {
  const now = payload.now || new Date().toISOString();
  const transaction = db.transaction(() => {
    const current = db.prepare('SELECT * FROM pronunciation_documents WHERE id = ?').get(payload.documentId);
    if (!current) {
      const error = new Error('Pronunciation document not found');
      error.code = 'PRONUNCIATION_DOCUMENT_NOT_FOUND';
      throw error;
    }
    const existing = db.prepare('SELECT * FROM pronunciation_correction_events WHERE event_key = ?').get(payload.eventKey);
    if (existing) {
      if (existing.payload_hash !== payload.payloadHash) {
        const error = new Error('Pronunciation correction event conflicts with existing event');
        error.code = 'PRONUNCIATION_EVENT_CONFLICT';
        error.status = 409;
        throw error;
      }
      return { event: { id: existing.id, eventKey: existing.event_key }, document: mapDocument(current), tokens: listTokens(db, current.id), idempotent: true };
    }
    if (Number(payload.expectedRevision) !== current.revision) {
      const error = new Error('Pronunciation document revision is stale');
      error.code = 'PRONUNCIATION_REVISION_STALE';
      error.status = 409;
      throw error;
    }
    const event = db.prepare(`
      INSERT INTO pronunciation_correction_events(
        event_key, document_id, token_key, event_type, payload_hash, payload_json,
        expected_revision, resulting_revision, created_at_utc
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      payload.eventKey,
      current.id,
      payload.tokenKey,
      payload.eventType,
      payload.payloadHash,
      payload.payloadJson,
      current.revision,
      current.revision + 1,
      now,
    );
    db.prepare('UPDATE pronunciation_documents SET revision = ?, document_hash = ?, status = ?, updated_at_utc = ? WHERE id = ?')
      .run(current.revision + 1, payload.documentHash, payload.status || current.status, now, current.id);
    db.prepare('DELETE FROM pronunciation_tokens WHERE document_id = ?').run(current.id);
    insertTokens(db, current.id, payload.tokens || [], now);
    return {
      event: { id: Number(event.lastInsertRowid), eventKey: payload.eventKey },
      document: mapDocument(db.prepare('SELECT * FROM pronunciation_documents WHERE id = ?').get(current.id)),
      tokens: listTokens(db, current.id),
      idempotent: false,
    };
  });
  return transaction();
}

module.exports = {
  getDocument,
  listTokens,
  createDocument,
  updateProjection,
  appendCorrection,
  applyCorrection,
  mapDocument,
  mapToken,
};
