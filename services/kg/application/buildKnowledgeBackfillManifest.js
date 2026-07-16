'use strict';

const {
  buildKnowledgePointIdentity,
  buildSurfaceIdentity,
  sha256,
  stableJson,
} = require('../domain/knowledgeIdentity');
const { analyzeJapaneseForm, analyzerDescriptor } = require('../domain/japaneseFormAnalysis');
const { buildEvidenceLinkCandidate } = require('../domain/knowledgeEvidence');
const { extractStudyUnitMarkdown, labeledValue } = require('../../learning/domain/studyItemContent');

const MANIFEST_VERSION = 'kg-p1-backfill-dry-run-v1';
const EXTRACTOR_VERSION = 'kg-source-extractor-v1';

function parseJson(value, fallback = {}) {
  try {
    return value ? JSON.parse(value) : fallback;
  } catch (_error) {
    return fallback;
  }
}

function classifyText(text, language, preferredKind) {
  if (preferredKind) return preferredKind;
  if (language === 'en') return /\s/u.test(text.trim()) ? 'phrase' : 'lexeme';
  if (language === 'ja') return /[。！？]|\s/u.test(text) || text.length > 18 ? 'phrase' : 'lexeme';
  return 'phrase';
}

function studyItemSources(db) {
  const rows = db.prepare(`
    SELECT item.*, generation.phrase, generation.card_type, generation.markdown_content,
      generation.en_translation, generation.ja_translation, generation.zh_translation,
      admission.status AS admission_status
    FROM study_items item
    JOIN generations generation ON generation.id = item.generation_id
    JOIN learning_source_admissions admission ON admission.generation_id = item.source_generation_id
    WHERE item.lifecycle = 'active'
      AND admission.status IN ('eligible', 'whole-card-only')
      AND admission.materialization_disposition IN ('create-items', 'adopt-existing')
    ORDER BY item.id
  `).all();
  const sources = [];
  const unresolved = [];
  for (const row of rows) {
    const locator = parseJson(row.unit_locator_json);
    const base = {
      sourceKind: 'study_item',
      sourceRefId: Number(row.id),
      sourceRevision: Number(row.content_revision),
      sourceContentHash: row.content_hash,
      locator: { unitKey: row.unit_key, unitKind: row.unit_kind, ...locator },
    };
    if (row.unit_kind === 'whole_card') {
      unresolved.push({ ...base, reason: 'whole-card-extractor-unavailable' });
      continue;
    }
    if (row.unit_kind === 'textbook_en' || row.unit_kind === 'textbook_ja') {
      const expression = db.prepare(`
        SELECT official_en_text, official_ja_text
        FROM textbook_expression_revisions WHERE id = ?
      `).get(Number(locator.expressionRevisionId || 0));
      if (!expression) {
        unresolved.push({ ...base, reason: 'textbook-expression-revision-missing' });
        continue;
      }
      const language = row.unit_kind === 'textbook_en' ? 'en' : 'ja';
      sources.push({
        ...base,
        language,
        text: language === 'en' ? expression.official_en_text : expression.official_ja_text,
        preferredKind: 'phrase',
      });
      continue;
    }
    if (row.unit_kind === 'trilingual_en') {
      sources.push({ ...base, language: 'en', text: row.en_translation, preferredKind: null });
      continue;
    }
    if (row.unit_kind === 'trilingual_ja') {
      sources.push({ ...base, language: 'ja', text: row.ja_translation, preferredKind: null });
      continue;
    }
    if (row.unit_kind === 'grammar_ja') {
      sources.push({ ...base, language: 'ja', text: row.phrase || row.ja_translation, preferredKind: 'grammar_pattern' });
      continue;
    }
    if (row.unit_kind === 'scenario_bilingual') {
      const markdown = extractStudyUnitMarkdown(row.markdown_content, row.unit_kind, locator);
      sources.push({ ...base, language: 'en', text: labeledValue(markdown, '英文'), preferredKind: 'phrase' });
      sources.push({ ...base, language: 'ja', text: labeledValue(markdown, '日本語'), preferredKind: 'phrase' });
      continue;
    }
    unresolved.push({ ...base, reason: `unsupported-unit-kind:${row.unit_kind}` });
  }
  return { sources, unresolved, rowCount: rows.length };
}

function publishedTextbookSources(db) {
  return db.prepare(`
    SELECT expression.id AS expression_id, revision.revision_number,
      expression_revision.official_en_text, expression_revision.official_ja_text,
      expression_revision.en_unit_hash, expression_revision.ja_unit_hash,
      track.id AS track_id, expression.expression_key
    FROM textbook_tracks track
    JOIN textbook_track_revisions revision ON revision.id = track.current_revision_id
    JOIN textbook_expressions expression ON expression.track_id = track.id AND expression.lifecycle = 'active'
    JOIN textbook_expression_revisions expression_revision
      ON expression_revision.expression_id = expression.id AND expression_revision.revision_id = revision.id
    WHERE track.status = 'published' AND revision.status = 'published'
    ORDER BY track.id, expression_revision.display_ordinal
  `).all().flatMap((row) => ['en', 'ja'].map((language) => ({
    sourceKind: 'textbook_expression',
    sourceRefId: Number(row.expression_id),
    sourceRevision: Number(row.revision_number),
    sourceContentHash: language === 'en' ? row.en_unit_hash : row.ja_unit_hash,
    locator: { trackId: Number(row.track_id), expressionKey: row.expression_key, language },
    language,
    text: language === 'en' ? row.official_en_text : row.official_ja_text,
    preferredKind: 'phrase',
  })));
}

async function analyzeSource(source, analyzeJapanese) {
  const text = String(source.text || '').trim();
  if (!text) return { status: 'unresolved', source, reason: 'source-text-empty' };
  const kind = classifyText(text, source.language, source.preferredKind);
  if (source.language === 'ja' && kind === 'lexeme') {
    const analysis = await analyzeJapanese(text);
    if (analysis.status !== 'resolved') {
      return { status: 'unresolved', source, kind, reason: analysis.reason, analysis };
    }
    const evidence = buildEvidenceLinkCandidate({
      pointKey: analysis.pointIdentity.pointKey,
      ...source,
      sourceText: text,
    });
    return {
      status: 'resolved', source, kind,
      point: analysis.pointIdentity,
      surface: analysis.surfaceIdentity,
      relation: analysis.relation,
      evidence,
      analyzer: analysis.analyzer,
    };
  }
  const point = buildKnowledgePointIdentity({
    kpKind: kind,
    language: source.language,
    canonicalForm: text,
  });
  const surface = buildSurfaceIdentity({ language: source.language, surfaceText: text });
  const evidence = buildEvidenceLinkCandidate({
    pointKey: point.pointKey,
    ...source,
    sourceText: text,
  });
  return {
    status: 'resolved', source, kind, point, surface,
    relation: { linkKind: 'canonical', formKind: 'dictionary' },
    evidence,
    analyzer: null,
  };
}

async function buildKnowledgeBackfillManifest({ db, now = new Date().toISOString(), analyzeJapanese = analyzeJapaneseForm } = {}) {
  if (!db) throw new TypeError('buildKnowledgeBackfillManifest requires db');
  const studyItems = studyItemSources(db);
  const textbookSources = publishedTextbookSources(db);
  const sources = [...studyItems.sources, ...textbookSources];
  const analyzed = [];
  for (const source of sources) analyzed.push(await analyzeSource(source, analyzeJapanese));
  const resolved = analyzed.filter((candidate) => candidate.status === 'resolved');
  const unresolved = [
    ...studyItems.unresolved.map((entry) => ({ status: 'unresolved', source: entry, reason: entry.reason })),
    ...analyzed.filter((candidate) => candidate.status === 'unresolved'),
  ];
  const pointGroups = new Map();
  for (const candidate of resolved) {
    const group = pointGroups.get(candidate.point.pointKey) || {
      point: candidate.point,
      surfaceKeys: new Set(),
      evidenceKeys: new Set(),
    };
    group.surfaceKeys.add(candidate.surface.surfaceKey);
    group.evidenceKeys.add(candidate.evidence.evidence.evidenceKey);
    pointGroups.set(candidate.point.pointKey, group);
  }
  const summary = {
    activeEligibleStudyItems: studyItems.rowCount,
    extractedStudyItemSources: studyItems.sources.length,
    publishedTextbookSources: textbookSources.length,
    resolvedCandidates: resolved.length,
    unresolvedCandidates: unresolved.length,
    suggestedPoints: pointGroups.size,
    suggestedSurfaces: new Set(resolved.map((candidate) => candidate.surface.surfaceKey)).size,
    suggestedEvidence: new Set(resolved.map((candidate) => candidate.evidence.evidence.evidenceKey)).size,
    sourceKindCounts: sources.reduce((counts, source) => {
      counts[source.sourceKind] = (counts[source.sourceKind] || 0) + 1;
      return counts;
    }, {}),
  };
  const manifestBody = {
    schemaVersion: MANIFEST_VERSION,
    mode: 'read-only-dry-run',
    extractorVersion: EXTRACTOR_VERSION,
    analyzer: analyzerDescriptor(),
    createdAtUtc: now,
    summary,
    candidates: resolved,
    unresolved,
    pointGroups: [...pointGroups.values()].map((group) => ({
      point: group.point,
      surfaceKeys: [...group.surfaceKeys].sort(),
      evidenceKeys: [...group.evidenceKeys].sort(),
    })),
  };
  return {
    ...manifestBody,
    manifestHash: sha256(stableJson(manifestBody)),
  };
}

module.exports = {
  EXTRACTOR_VERSION,
  MANIFEST_VERSION,
  buildKnowledgeBackfillManifest,
  classifyText,
  publishedTextbookSources,
  studyItemSources,
};
