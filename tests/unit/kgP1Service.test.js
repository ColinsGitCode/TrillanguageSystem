'use strict';

process.env.DB_PATH = ':memory:';
process.env.LOG_SILENT = '1';

const assert = require('node:assert/strict');
const test = require('node:test');
const databaseModule = require('../../services/storage/databaseService');
const { DatabaseService } = databaseModule;
const { KnowledgeGraphService } = require('../../services/kg/application/knowledgeGraphService');

const NOW = '2026-07-16T03:00:00.000Z';

function makeService(options = {}) {
  const database = new DatabaseService(':memory:');
  const service = new KnowledgeGraphService({
    db: database.db,
    clock: () => NOW,
    ...options,
  });
  return { database, service };
}

function insertStudyItem(db) {
  const hash = 'a'.repeat(64);
  const generationId = Number(db.prepare(`
    INSERT INTO generations(
      phrase, phrase_language, card_type, source_mode, llm_provider, llm_model,
      folder_name, base_filename, md_file_path, html_file_path, meta_file_path,
      markdown_content, content_hash, generation_date, request_id
    ) VALUES ('handoff', 'en', 'trilingual', 'input', 'deepseek', 'deepseek-v4-pro',
      '20260716', 'kg-p1', '/tmp/kg-p1.md', '/tmp/kg-p1.html', '/tmp/kg-p1.json',
      '# handoff', ?, '2026-07-16', 'kg-p1-fixture')
  `).run(hash).lastInsertRowid);
  const studyItemId = Number(db.prepare(`
    INSERT INTO study_items(
      generation_id, source_generation_id, unit_key, unit_kind, unit_locator_json,
      content_hash, lifecycle, created_at_utc, updated_at_utc
    ) VALUES (?, ?, 'en', 'trilingual_en', '{}', ?, 'active', ?, ?)
  `).run(generationId, generationId, hash, NOW, NOW).lastInsertRowid);
  return { generationId, studyItemId, hash };
}

test.after(() => databaseModule.close());

test('resolved lookup is idempotent and append-only', async () => {
  const { database, service } = makeService();
  try {
    const command = {
      eventKey: 'lookup:resolved:0001',
      inputText: ' Handoff ',
      language: 'en',
      kindHint: 'lexeme',
      timeZone: 'Asia/Shanghai',
    };
    const first = await service.lookup(command);
    const second = await service.lookup(command);

    assert.equal(first.resolution, 'resolved');
    assert.equal(first.point.canonicalForm, 'handoff');
    assert.equal(first.reused, false);
    assert.equal(second.id, first.id);
    assert.equal(second.reused, true);
    assert.equal(database.db.prepare('SELECT COUNT(*) AS count FROM kg_lookup_events').get().count, 1);
    assert.equal(database.db.prepare('SELECT COUNT(*) AS count FROM learning_review_events').get().count, 0);
    assert.equal(database.db.prepare('SELECT COUNT(*) AS count FROM learning_schedule_states').get().count, 0);
    assert.throws(
      () => database.db.prepare('DELETE FROM kg_lookup_events WHERE id = ?').run(first.id),
      /immutable/u
    );

    await assert.rejects(
      service.lookup({ ...command, inputText: 'transfer' }),
      (error) => error.code === 'KG_EVENT_KEY_CONFLICT' && error.status === 409
    );
  } finally {
    database.close();
  }
});

test('lookup rejects target-language mismatch before writing facts', async () => {
  const { database, service } = makeService();
  try {
    await assert.rejects(
      service.lookup({
        eventKey: 'lookup:mismatch:ja:0001',
        inputText: 'continuous integration',
        language: 'ja',
        kindHint: 'phrase',
      }),
      (error) => error.code === 'KG_INVALID_INPUT' && error.status === 400
    );
    await assert.rejects(
      service.lookup({
        eventKey: 'lookup:mismatch:en:0001',
        inputText: '持续集成',
        language: 'en',
        kindHint: 'phrase',
      }),
      (error) => error.code === 'KG_INVALID_INPUT' && error.status === 400
    );
    assert.equal(database.db.prepare('SELECT COUNT(*) AS count FROM kg_lookup_events').get().count, 0);
    assert.equal(database.db.prepare('SELECT COUNT(*) AS count FROM kg_resolution_cases').get().count, 0);
    assert.equal(database.db.prepare('SELECT COUNT(*) AS count FROM kg_points').get().count, 0);
  } finally {
    database.close();
  }
});

test('ambiguous analysis opens one unresolved case without guessing a point', async () => {
  const analyzeJapanese = async (input) => ({
    status: 'unresolved',
    input,
    normalizedInput: 'はし',
    reason: 'ambiguous-kana-input',
    details: {},
    analyzer: { id: 'fixture', version: '1', ruleVersion: 'fixture-v1' },
    tokens: [],
  });
  const { database, service } = makeService({ analyzeJapanese });
  try {
    const lookup = await service.lookup({
      eventKey: 'lookup:unresolved:0001',
      inputText: 'はし',
      language: 'ja',
      kindHint: 'lexeme',
    });
    assert.equal(lookup.resolution, 'unresolved');
    assert.equal(lookup.point, null);
    assert.equal(lookup.resolutionCase.status, 'open');
    assert.equal(lookup.resolutionCase.caseKind, 'ambiguous-surface');
    assert.equal(database.db.prepare('SELECT COUNT(*) AS count FROM kg_points').get().count, 0);

    const decided = service.resolveCase(lookup.resolutionCase.id, {
      eventKey: 'decision:unresolved:0001',
      action: 'resolve',
      revision: 1,
      point: {
        language: 'ja',
        kind: 'lexeme',
        canonicalForm: '箸',
        canonicalReading: 'はし',
      },
      publicReason: 'The textbook context means chopsticks.',
    });
    assert.equal(decided.resolutionCase.status, 'resolved');
    assert.equal(decided.point.canonicalForm, '箸');
    assert.equal(decided.resolutionCase.revision, 2);

    const repeatedDecision = service.resolveCase(lookup.resolutionCase.id, {
      eventKey: 'decision:unresolved:0001',
      action: 'resolve',
      revision: 1,
      point: {
        language: 'ja',
        kind: 'lexeme',
        canonicalForm: '箸',
        canonicalReading: 'はし',
      },
      publicReason: 'The textbook context means chopsticks.',
    });
    assert.equal(repeatedDecision.reused, true);
    assert.equal(repeatedDecision.point.canonicalForm, '箸');

    assert.throws(
      () => service.resolveCase(lookup.resolutionCase.id, {
        eventKey: 'decision:unresolved:0002',
        action: 'dismiss',
        revision: 1,
      }),
      (error) => error.code === 'KG_RESOLUTION_STALE'
    );
  } finally {
    database.close();
  }
});

test('evidence and lookup facts rebuild point stats and a capped planning signal', async () => {
  const { database, service } = makeService();
  try {
    const source = insertStudyItem(database.db);
    const lookup = await service.lookup({
      eventKey: 'lookup:projection:0001',
      inputText: 'handoff',
      language: 'en',
      kindHint: 'lexeme',
    });
    service.attachEvidence({
      pointKey: lookup.point.pointKey,
      sourceKind: 'study_item',
      sourceRefId: source.studyItemId,
      sourceContentHash: source.hash,
      language: 'en',
      sourceText: 'handoff',
      locator: { unitKey: 'en' },
    });
    await service.lookup({
      eventKey: 'lookup:projection:0002',
      inputText: 'handoff',
      language: 'en',
      kindHint: 'lexeme',
    });
    await service.lookup({
      eventKey: 'lookup:projection:0003',
      inputText: 'handoff',
      language: 'en',
      kindHint: 'lexeme',
      interactionKind: 'duplicate_generation_attempt',
    });

    const detail = service.getPoint(lookup.point.id);
    assert.equal(detail.stats.studyItemCount, 1);
    assert.equal(detail.stats.explicitLookupCount7d, 2);
    assert.equal(detail.stats.duplicateAttemptCount30d, 1);
    assert.equal(detail.evidence.length, 1);

    const signal = database.db.prepare('SELECT * FROM kg_planning_signals WHERE study_item_id = ?').get(source.studyItemId);
    assert.equal(signal.score, 19);
    assert.equal(signal.signal_version, 'kg-lookup-signal-v1');
    assert.deepEqual(service.search({ query: 'hand', language: 'en' }).map((point) => point.id), [lookup.point.id]);
  } finally {
    database.close();
  }
});

test('HTTP-path lookup rebuilds only the affected point projection', async () => {
  let current = '2026-07-16T03:00:00.000Z';
  const { database, service } = makeService({ clock: () => current });
  try {
    const first = await service.lookup({
      eventKey: 'lookup:incremental:0001', inputText: 'handoff', language: 'en', kindHint: 'lexeme',
    });
    const other = await service.lookup({
      eventKey: 'lookup:incremental:0002', inputText: 'transfer', language: 'en', kindHint: 'lexeme',
    });
    const otherBefore = database.db.prepare('SELECT computed_at_utc FROM kg_point_stats WHERE point_id = ?').get(other.point.id);
    current = '2026-07-16T03:05:00.000Z';
    await service.lookup({
      eventKey: 'lookup:incremental:0003', inputText: 'handoff', language: 'en', kindHint: 'lexeme',
    });
    const firstAfter = database.db.prepare('SELECT computed_at_utc FROM kg_point_stats WHERE point_id = ?').get(first.point.id);
    const otherAfter = database.db.prepare('SELECT computed_at_utc FROM kg_point_stats WHERE point_id = ?').get(other.point.id);
    assert.equal(firstAfter.computed_at_utc, current);
    assert.equal(otherAfter.computed_at_utc, otherBefore.computed_at_utc);
  } finally {
    database.close();
  }
});
