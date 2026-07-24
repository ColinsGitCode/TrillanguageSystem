'use strict';

process.env.DB_PATH = ':memory:';
process.env.LOG_SILENT = '1';

const assert = require('node:assert/strict');
const test = require('node:test');
const databaseModule = require('../../services/storage/databaseService');
const { DatabaseService } = databaseModule;
const {
  buildMaterializationPlan,
  expandStudyUnits,
  materializeLearningP0,
} = require('../../services/learning/application/materializeStudyItems');

const HASHES = ['a', 'b', 'c', 'd', 'e'].map((char) => char.repeat(64));

function insertGeneration(db, { id, cardType, hash }) {
  db.prepare(`
    INSERT INTO generations(
      id, phrase, phrase_language, card_type, source_mode, llm_provider, llm_model,
      folder_name, base_filename, md_file_path, html_file_path, markdown_content,
      content_hash, generation_date, request_id
    ) VALUES (
      @id, @phrase, 'ja', @cardType, 'input', 'deepseek', 'deepseek-v4-pro',
      '20260714', @phrase, @mdPath, @htmlPath, '# fixture', @hash, '2026-07-14', @requestId
    )
  `).run({
    id,
    phrase: `fixture-${id}`,
    cardType,
    mdPath: `/tmp/fixture-${id}.md`,
    htmlPath: `/tmp/fixture-${id}.html`,
    hash,
    requestId: `fixture-${id}`,
  });
}

function buildReport() {
  const definitions = [
    ['trilingual', 'eligible'],
    ['grammar_ja', 'eligible'],
    ['scenario_phrase', 'eligible'],
    ['trilingual', 'whole-card-only'],
    ['trilingual', 'quarantined'],
  ];
  return {
    run: {
      stateHash: 'f'.repeat(64),
      decisionsVersion: 'card-data-preparation-v1',
    },
    summary: {
      statusCounts: { eligible: 3, 'whole-card-only': 1, quarantined: 1, unresolved: 0 },
    },
    cards: definitions.map(([cardType, status], index) => ({
      generationId: index + 1,
      cardType,
      contentHash: HASHES[index],
      scenarioExpressionCount: cardType === 'scenario_phrase' ? 20 : null,
      recommendation: { status, reasons: [`fixture-${status}`] },
    })),
  };
}

test.after(() => databaseModule.close());

test.describe('LA-P0 admission and Study Item materializer', () => {
  test.it('expands stable units for all accepted card granularities', () => {
    const plan = buildMaterializationPlan(buildReport());
    assert.equal(plan.admissions.length, 5);
    assert.equal(plan.items.length, 24);
    assert.deepEqual(plan.byKind, {
      trilingual_en: 1,
      trilingual_ja: 1,
      grammar_ja: 1,
      scenario_bilingual: 20,
      whole_card: 1,
    });
    assert.match(plan.identityDigest, /^[a-f0-9]{64}$/u);
    assert.deepEqual(
      plan.items.filter((item) => item.unitKind === 'scenario_bilingual').map((item) => item.unitKey),
      Array.from({ length: 20 }, (_, index) => `scenario:${String(index + 1).padStart(2, '0')}`)
    );
  });

  test.it('keeps legacy scenario reports at 12 units when no count was recorded', () => {
    const units = expandStudyUnits({
      cardType: 'scenario_phrase',
      recommendation: { status: 'eligible' },
    });
    assert.equal(units.length, 12);
    assert.equal(units.at(-1).unitKey, 'scenario:12');
  });

  test.it('dry-runs, applies atomically, and becomes a zero-change rerun', () => {
    const service = new DatabaseService(':memory:');
    const report = buildReport();
    try {
      report.cards.forEach((card) => insertGeneration(service.db, {
        id: card.generationId,
        cardType: card.cardType,
        hash: card.contentHash,
      }));
      const dryRun = materializeLearningP0(service.db, { report });
      assert.equal(dryRun.apply, false);
      assert.deepEqual(dryRun.admissionActions, { insert: 5, update: 0, unchanged: 0 });
      assert.deepEqual(dryRun.itemActions, { insert: 24, update: 0, unchanged: 0, suspend: 0 });
      assert.equal(service.db.prepare('SELECT COUNT(*) AS count FROM study_items').get().count, 0);

      const applied = materializeLearningP0(service.db, {
        report,
        apply: true,
        now: () => '2026-07-14T00:00:00.000Z',
      });
      assert.equal(applied.expectedStudyItems, 24);
      assert.equal(service.db.prepare('SELECT COUNT(*) AS count FROM study_items').get().count, 24);
      assert.equal(service.db.prepare('SELECT COUNT(*) AS count FROM learning_source_admissions').get().count, 5);
      assert.equal(service.db.prepare(
        "SELECT COUNT(*) AS count FROM learning_source_admissions WHERE materialization_disposition = 'exclude'"
      ).get().count, 1);

      const rerun = materializeLearningP0(service.db, { report });
      assert.deepEqual(rerun.admissionActions, { insert: 0, update: 0, unchanged: 5 });
      assert.deepEqual(rerun.itemActions, { insert: 0, update: 0, unchanged: 24, suspend: 0 });
      assert.equal(rerun.identityDigest, dryRun.identityDigest);
    } finally {
      service.close();
    }
  });

  test.it('rejects a stale eligibility report before writing', () => {
    const service = new DatabaseService(':memory:');
    const report = buildReport();
    try {
      report.cards.forEach((card) => insertGeneration(service.db, {
        id: card.generationId,
        cardType: card.cardType,
        hash: card.contentHash,
      }));
      report.cards[0].contentHash = '0'.repeat(64);
      assert.throws(
        () => materializeLearningP0(service.db, { report, apply: true }),
        /content hash changed/u
      );
      assert.equal(service.db.prepare('SELECT COUNT(*) AS count FROM learning_source_admissions').get().count, 0);
    } finally {
      service.close();
    }
  });
});
