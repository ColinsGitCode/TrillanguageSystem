'use strict';

function mapEntry(row) {
  if (!row) return null;
  return {
    id: Number(row.id),
    language: row.language,
    surfaceForm: row.surface_form,
    normalizedForm: row.normalized_form,
    lemma: row.lemma,
    reading: row.reading,
    partOfSpeech: row.part_of_speech,
    zhGloss: row.zh_gloss,
    senseKey: row.sense_key,
    sourceId: row.source_id,
    dictionaryVersion: row.dictionary_version,
    sourceRef: row.source_ref_json ? JSON.parse(row.source_ref_json) : {},
    status: row.status,
  };
}

function findEntry(db, language, normalizedForms = []) {
  const forms = [...new Set(normalizedForms.map((value) => String(value || '').trim()).filter(Boolean))];
  if (!forms.length) return null;
  const placeholders = forms.map(() => '?').join(', ');
  const row = db.prepare(`
    SELECT * FROM local_dictionary_entries
    WHERE language = ? AND status = 'active' AND normalized_form IN (${placeholders})
    ORDER BY CASE normalized_form ${forms.map(() => 'WHEN ? THEN ?').join(' ')} ELSE 999 END, id ASC
    LIMIT 1
  `).get(
    language,
    ...forms,
    ...forms.flatMap((form, index) => [form, index]),
  );
  return mapEntry(row);
}

function listEntries(db, options = {}) {
  const clauses = ["status = 'active'"];
  const params = { limit: Math.min(Math.max(Number(options.limit) || 100, 1), 5000) };
  if (options.language) {
    clauses.push('language = @language');
    params.language = options.language;
  }
  if (options.dictionaryVersion) {
    clauses.push('dictionary_version = @dictionaryVersion');
    params.dictionaryVersion = options.dictionaryVersion;
  }
  return db.prepare(`
    SELECT * FROM local_dictionary_entries
    WHERE ${clauses.join(' AND ')}
    ORDER BY language, normalized_form, id
    LIMIT @limit
  `).all(params).map(mapEntry);
}

function upsertEntry(db, payload) {
  db.prepare(`
    INSERT INTO local_dictionary_entries(
      language, surface_form, normalized_form, lemma, reading, part_of_speech,
      zh_gloss, sense_key, source_id, dictionary_version, source_ref_json,
      status, created_at_utc, updated_at_utc
    ) VALUES (
      @language, @surfaceForm, @normalizedForm, @lemma, @reading, @partOfSpeech,
      @zhGloss, @senseKey, @sourceId, @dictionaryVersion, @sourceRefJson,
      'active', @createdAtUtc, @createdAtUtc
    )
    ON CONFLICT(language, normalized_form, sense_key, dictionary_version)
    DO UPDATE SET
      surface_form = excluded.surface_form,
      lemma = excluded.lemma,
      reading = excluded.reading,
      part_of_speech = excluded.part_of_speech,
      zh_gloss = excluded.zh_gloss,
      source_id = excluded.source_id,
      source_ref_json = excluded.source_ref_json,
      status = 'active',
      updated_at_utc = excluded.updated_at_utc
  `).run(payload);
  return findEntry(db, payload.language, [payload.normalizedForm]);
}

function countEntries(db, dictionaryVersion) {
  return Number(db.prepare(
    'SELECT COUNT(*) AS count FROM local_dictionary_entries WHERE dictionary_version = ?'
  ).get(dictionaryVersion).count);
}

module.exports = {
  findEntry,
  countEntries,
  listEntries,
  mapEntry,
  upsertEntry,
};
