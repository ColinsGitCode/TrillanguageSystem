'use strict';

const { safeJsonParse } = require('./helpers');

function mapEntry(row) {
  if (!row) return null;
  return {
    id: Number(row.id),
    language: row.language,
    canonicalForm: row.canonical_form,
    normalizedForm: row.normalized_form,
    senseKey: row.sense_key,
    zhGloss: row.zh_gloss,
    sourceKind: row.source_kind,
    sourceRef: safeJsonParse(row.source_ref_json, {}),
    confidence: row.confidence,
    status: row.status,
    version: Number(row.version),
    createdAtUtc: row.created_at_utc,
    updatedAtUtc: row.updated_at_utc,
  };
}

function mapProposal(row) {
  if (!row) return null;
  return {
    id: Number(row.id),
    proposalKey: row.proposal_key,
    language: row.language,
    surface: row.surface,
    normalizedForm: row.normalized_form,
    contextHash: row.context_hash,
    zhGloss: row.zh_gloss,
    explanation: row.explanation || '',
    model: row.model,
    promptVersion: row.prompt_version,
    responseHash: row.response_hash,
    usage: safeJsonParse(row.usage_json, {}),
    status: row.status,
    acceptedEntryId: row.accepted_entry_id == null ? null : Number(row.accepted_entry_id),
    createdAtUtc: row.created_at_utc,
    updatedAtUtc: row.updated_at_utc,
  };
}

function getEntry(db, id) {
  return mapEntry(db.prepare('SELECT * FROM local_glossary_entries WHERE id = ?').get(id));
}

function findActiveEntry(db, language, normalizedForm, senseKey = 'default') {
  return mapEntry(db.prepare(`
    SELECT * FROM local_glossary_entries
    WHERE language = ? AND normalized_form = ? AND sense_key = ? AND status = 'active'
    LIMIT 1
  `).get(language, normalizedForm, senseKey));
}

function listEntries(db, options = {}) {
  const params = { limit: Math.min(Math.max(Number(options.limit) || 50, 1), 200) };
  const clauses = [];
  if (options.language) {
    clauses.push('language = @language');
    params.language = options.language;
  }
  if (!options.includeArchived) clauses.push("status = 'active'");
  if (options.query) {
    clauses.push('(normalized_form LIKE @query OR canonical_form LIKE @query OR zh_gloss LIKE @query)');
    params.query = `%${options.query}%`;
  }
  const where = clauses.length ? `WHERE ${clauses.join(' AND ')}` : '';
  return db.prepare(`
    SELECT * FROM local_glossary_entries
    ${where}
    ORDER BY status = 'active' DESC, updated_at_utc DESC, id DESC
    LIMIT @limit
  `).all(params).map(mapEntry);
}

function createEntry(db, payload) {
  const result = db.prepare(`
    INSERT INTO local_glossary_entries(
      language, canonical_form, normalized_form, sense_key, zh_gloss,
      source_kind, source_ref_json, confidence, status, version,
      created_at_utc, updated_at_utc
    ) VALUES (
      @language, @canonicalForm, @normalizedForm, @senseKey, @zhGloss,
      @sourceKind, @sourceRefJson, @confidence, 'active', 1,
      @createdAtUtc, @createdAtUtc
    )
  `).run(payload);
  return getEntry(db, result.lastInsertRowid);
}

function updateEntry(db, id, expectedVersion, payload) {
  const result = db.prepare(`
    UPDATE local_glossary_entries
    SET canonical_form = @canonicalForm,
      normalized_form = @normalizedForm,
      sense_key = @senseKey,
      zh_gloss = @zhGloss,
      source_ref_json = @sourceRefJson,
      confidence = @confidence,
      version = version + 1,
      updated_at_utc = @updatedAtUtc
    WHERE id = @id AND status = 'active' AND version = @expectedVersion
  `).run({ id, expectedVersion, ...payload });
  return result.changes ? getEntry(db, id) : null;
}

function archiveEntry(db, id, expectedVersion, updatedAtUtc) {
  const result = db.prepare(`
    UPDATE local_glossary_entries
    SET status = 'archived', version = version + 1, updated_at_utc = ?
    WHERE id = ? AND status = 'active' AND version = ?
  `).run(updatedAtUtc, id, expectedVersion);
  return result.changes ? getEntry(db, id) : null;
}

function restoreEntry(db, id, expectedVersion, updatedAtUtc) {
  const result = db.prepare(`
    UPDATE local_glossary_entries
    SET status = 'active', version = version + 1, updated_at_utc = ?
    WHERE id = ? AND status = 'archived' AND version = ?
  `).run(updatedAtUtc, id, expectedVersion);
  return result.changes ? getEntry(db, id) : null;
}

function getEntryStats(db) {
  const rows = db.prepare(`
    SELECT language, status, COUNT(*) AS entryCount
    FROM local_glossary_entries
    GROUP BY language, status
  `).all();
  return rows.map((row) => ({ ...row, entryCount: Number(row.entryCount) }));
}

function getProposal(db, id) {
  return mapProposal(db.prepare('SELECT * FROM local_glossary_proposals WHERE id = ?').get(id));
}

function findProposalByKey(db, proposalKey) {
  return mapProposal(db.prepare('SELECT * FROM local_glossary_proposals WHERE proposal_key = ?').get(proposalKey));
}

function createProposal(db, payload) {
  const result = db.prepare(`
    INSERT INTO local_glossary_proposals(
      proposal_key, language, surface, normalized_form, context_hash,
      zh_gloss, explanation, model, prompt_version, response_hash,
      usage_json, status, created_at_utc, updated_at_utc
    ) VALUES (
      @proposalKey, @language, @surface, @normalizedForm, @contextHash,
      @zhGloss, @explanation, @model, @promptVersion, @responseHash,
      @usageJson, 'pending', @createdAtUtc, @createdAtUtc
    )
  `).run(payload);
  return getProposal(db, result.lastInsertRowid);
}

function decideProposal(db, id, status, acceptedEntryId, updatedAtUtc) {
  const result = db.prepare(`
    UPDATE local_glossary_proposals
    SET status = ?, accepted_entry_id = ?, updated_at_utc = ?
    WHERE id = ? AND status = 'pending'
  `).run(status, acceptedEntryId || null, updatedAtUtc, id);
  return result.changes ? getProposal(db, id) : null;
}

module.exports = {
  archiveEntry,
  createEntry,
  createProposal,
  decideProposal,
  findActiveEntry,
  findProposalByKey,
  getEntry,
  getEntryStats,
  getProposal,
  listEntries,
  mapEntry,
  mapProposal,
  restoreEntry,
  updateEntry,
};
