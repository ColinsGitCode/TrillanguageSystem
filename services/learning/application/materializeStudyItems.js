'use strict';

const crypto = require('node:crypto');
const { LEARNING_P0_TABLES, assertLearningP0Postconditions } = require('../../storage/db/migrationRunner');

const EXTRACTOR_VERSION = 'learning-unit-v1';
const ADMISSION_STATE_VERSION = 'learning-admission-v1';

function stableJson(value) {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableJson(value[key])}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

function sha256(value) {
  return crypto.createHash('sha256').update(value).digest('hex');
}

function twoDigits(value) {
  return String(value).padStart(2, '0');
}

function expandStudyUnits(card) {
  if (card.recommendation.status === 'whole-card-only') {
    return [{
      unitKey: 'whole',
      unitKind: 'whole_card',
      locator: { schemaVersion: 1, extractorVersion: EXTRACTOR_VERSION, section: 'whole-card' },
    }];
  }
  if (card.recommendation.status !== 'eligible') return [];
  if (card.cardType === 'trilingual') {
    return ['en', 'ja'].map((language) => ({
      unitKey: language,
      unitKind: `trilingual_${language}`,
      locator: { schemaVersion: 1, extractorVersion: EXTRACTOR_VERSION, section: 'trilingual', language },
    }));
  }
  if (card.cardType === 'grammar_ja') {
    return [{
      unitKey: 'grammar',
      unitKind: 'grammar_ja',
      locator: { schemaVersion: 1, extractorVersion: EXTRACTOR_VERSION, section: 'grammar' },
    }];
  }
  if (card.cardType === 'scenario_phrase') {
    return Array.from({ length: 12 }, (_, index) => {
      const ordinal = index + 1;
      const sourceHeading = twoDigits(ordinal);
      return {
        unitKey: `scenario:${sourceHeading}`,
        unitKind: 'scenario_bilingual',
        locator: {
          schemaVersion: 1,
          extractorVersion: EXTRACTOR_VERSION,
          section: 'scenario-expression',
          ordinal,
          sourceHeading,
        },
      };
    });
  }
  throw new Error(`Unsupported eligible card type: ${card.cardType}`);
}

function validateEligibilityReport(report) {
  if (!report?.run?.stateHash || !Array.isArray(report.cards)) {
    throw new TypeError('Eligibility report must include run.stateHash and cards');
  }
  if (report.summary?.statusCounts?.unresolved !== 0) {
    throw new Error('Eligibility report contains unresolved cards');
  }
  const ids = new Set();
  for (const card of report.cards) {
    if (!Number.isInteger(Number(card.generationId)) || Number(card.generationId) <= 0) {
      throw new TypeError('Eligibility report contains an invalid generationId');
    }
    if (ids.has(Number(card.generationId))) throw new Error(`Duplicate generation in report: ${card.generationId}`);
    ids.add(Number(card.generationId));
    if (!/^[a-f0-9]{64}$/u.test(card.contentHash || '')) {
      throw new Error(`Invalid content hash for generation ${card.generationId}`);
    }
    if (!['eligible', 'whole-card-only', 'quarantined', 'unresolved'].includes(card.recommendation?.status)) {
      throw new Error(`Invalid recommendation for generation ${card.generationId}`);
    }
  }
}

function buildMaterializationPlan(report) {
  validateEligibilityReport(report);
  const admissions = [];
  const items = [];
  for (const card of report.cards) {
    const generationId = Number(card.generationId);
    const materializable = ['eligible', 'whole-card-only'].includes(card.recommendation.status);
    admissions.push({
      generationId,
      status: card.recommendation.status,
      contentHash: card.contentHash,
      reasons: card.recommendation.reasons || [],
      decisionVersion: String(report.run.decisionsVersion || 'unknown'),
      stateVersion: ADMISSION_STATE_VERSION,
      dpStateHash: report.run.stateHash,
      disposition: materializable ? 'create-items' : 'exclude',
      identityAnchorGenerationId: generationId,
    });
    for (const unit of expandStudyUnits(card)) {
      items.push({
        generationId,
        sourceGenerationId: generationId,
        unitKey: unit.unitKey,
        unitKind: unit.unitKind,
        locatorJson: stableJson(unit.locator),
        contentHash: card.contentHash,
      });
    }
  }
  const byKind = {};
  for (const item of items) byKind[item.unitKind] = (byKind[item.unitKind] || 0) + 1;
  const identityDigest = sha256(stableJson(items.map((item) => ({
    sourceGenerationId: item.sourceGenerationId,
    unitKey: item.unitKey,
    unitKind: item.unitKind,
    locatorJson: item.locatorJson,
  }))));
  return { admissions, items, byKind, identityDigest };
}

function compareAdmission(existing, expected) {
  if (!existing) return 'insert';
  const same = existing.status === expected.status
    && existing.content_hash === expected.contentHash
    && existing.reasons_json === stableJson(expected.reasons)
    && existing.decision_version === expected.decisionVersion
    && existing.state_version === expected.stateVersion
    && existing.dp_state_hash === expected.dpStateHash
    && existing.materialization_disposition === expected.disposition
    && Number(existing.identity_anchor_generation_id) === expected.identityAnchorGenerationId
    && existing.admission_source === 'dp7';
  return same ? 'unchanged' : 'update';
}

function compareItem(existing, expected) {
  if (!existing) return 'insert';
  const same = Number(existing.generation_id) === expected.generationId
    && existing.unit_kind === expected.unitKind
    && existing.unit_locator_json === expected.locatorJson
    && existing.content_hash === expected.contentHash
    && existing.lifecycle === 'active';
  return same ? 'unchanged' : 'update';
}

function materializeLearningP0(db, { report, apply = false, now = () => new Date().toISOString() }) {
  assertLearningP0Postconditions(db);
  const plan = buildMaterializationPlan(report);
  const generations = new Map(db.prepare(
    "SELECT id, card_type, content_hash FROM generations WHERE card_type <> 'textbook_track' ORDER BY id"
  ).all().map((row) => [Number(row.id), row]));
  if (generations.size !== report.cards.length) {
    throw new Error(`Eligibility report card count ${report.cards.length} does not match database ${generations.size}`);
  }
  for (const card of report.cards) {
    const generation = generations.get(Number(card.generationId));
    if (!generation) throw new Error(`Generation ${card.generationId} is missing`);
    if (generation.content_hash !== card.contentHash) {
      throw new Error(`Generation ${card.generationId} content hash changed after eligibility report`);
    }
    if (generation.card_type !== card.cardType) {
      throw new Error(`Generation ${card.generationId} card type changed after eligibility report`);
    }
  }

  const existingAdmissions = new Map(db.prepare(
    'SELECT * FROM learning_source_admissions'
  ).all().map((row) => [Number(row.generation_id), row]));
  const existingItems = new Map(db.prepare(
    `
      SELECT item.*
      FROM study_items item
      JOIN generations generation ON generation.id = item.source_generation_id
      WHERE generation.card_type <> 'textbook_track'
    `
  ).all().map((row) => [`${row.source_generation_id}:${row.unit_key}`, row]));
  const admissionActions = { insert: 0, update: 0, unchanged: 0 };
  const itemActions = { insert: 0, update: 0, unchanged: 0, suspend: 0 };
  for (const admission of plan.admissions) {
    admissionActions[compareAdmission(existingAdmissions.get(admission.generationId), admission)] += 1;
  }
  const expectedItemKeys = new Set();
  for (const item of plan.items) {
    const key = `${item.sourceGenerationId}:${item.unitKey}`;
    expectedItemKeys.add(key);
    itemActions[compareItem(existingItems.get(key), item)] += 1;
  }
  for (const [key, item] of existingItems) {
    if (!expectedItemKeys.has(key) && item.lifecycle === 'active') itemActions.suspend += 1;
  }

  if (apply) {
    const timestamp = now();
    const insertAdmission = db.prepare(`
      INSERT INTO learning_source_admissions(
        generation_id, status, content_hash, reasons_json, decision_version, state_version,
        dp_state_hash, materialization_disposition, identity_anchor_generation_id,
        admission_source, evaluated_at_utc, created_at_utc, updated_at_utc
      ) VALUES (
        @generationId, @status, @contentHash, @reasonsJson, @decisionVersion, @stateVersion,
        @dpStateHash, @disposition, @identityAnchorGenerationId,
        'dp7', @timestamp, @timestamp, @timestamp
      )
    `);
    const updateAdmission = db.prepare(`
      UPDATE learning_source_admissions SET
        status=@status, content_hash=@contentHash, reasons_json=@reasonsJson,
        decision_version=@decisionVersion, state_version=@stateVersion, dp_state_hash=@dpStateHash,
        materialization_disposition=@disposition,
        identity_anchor_generation_id=@identityAnchorGenerationId,
        admission_source='dp7', evaluated_at_utc=@timestamp, updated_at_utc=@timestamp
      WHERE generation_id=@generationId
    `);
    const insertItem = db.prepare(`
      INSERT INTO study_items(
        generation_id, source_generation_id, unit_key, unit_kind, unit_locator_json,
        content_hash, content_revision, lifecycle, created_at_utc, updated_at_utc
      ) VALUES (
        @generationId, @sourceGenerationId, @unitKey, @unitKind, @locatorJson,
        @contentHash, 1, 'active', @timestamp, @timestamp
      )
    `);
    const updateItem = db.prepare(`
      UPDATE study_items SET
        generation_id=@generationId, unit_kind=@unitKind, unit_locator_json=@locatorJson,
        content_revision=content_revision + CASE
          WHEN content_hash <> @contentHash OR unit_locator_json <> @locatorJson OR unit_kind <> @unitKind THEN 1
          ELSE 0 END,
        content_hash=@contentHash, lifecycle='active', lifecycle_reason=NULL, updated_at_utc=@timestamp
      WHERE source_generation_id=@sourceGenerationId AND unit_key=@unitKey
    `);
    const suspendItem = db.prepare(`
      UPDATE study_items SET lifecycle='suspended', lifecycle_reason='source-ineligible', updated_at_utc=?
      WHERE id=?
    `);
    const transaction = db.transaction(() => {
      for (const admission of plan.admissions) {
        const action = compareAdmission(existingAdmissions.get(admission.generationId), admission);
        if (action === 'unchanged') continue;
        const payload = { ...admission, reasonsJson: stableJson(admission.reasons), timestamp };
        if (action === 'insert') insertAdmission.run(payload);
        else updateAdmission.run(payload);
      }
      for (const item of plan.items) {
        const key = `${item.sourceGenerationId}:${item.unitKey}`;
        const action = compareItem(existingItems.get(key), item);
        if (action === 'unchanged') continue;
        const payload = { ...item, timestamp };
        if (action === 'insert') insertItem.run(payload);
        else updateItem.run(payload);
      }
      for (const [key, item] of existingItems) {
        if (!expectedItemKeys.has(key) && item.lifecycle === 'active') suspendItem.run(timestamp, item.id);
      }
    });
    transaction();
  }

  return {
    apply,
    dpStateHash: report.run.stateHash,
    expectedAdmissions: plan.admissions.length,
    expectedStudyItems: plan.items.length,
    byKind: plan.byKind,
    identityDigest: plan.identityDigest,
    admissionActions,
    itemActions,
    learningTables: LEARNING_P0_TABLES,
  };
}

module.exports = {
  ADMISSION_STATE_VERSION,
  EXTRACTOR_VERSION,
  buildMaterializationPlan,
  expandStudyUnits,
  materializeLearningP0,
  stableJson,
  validateEligibilityReport,
};
