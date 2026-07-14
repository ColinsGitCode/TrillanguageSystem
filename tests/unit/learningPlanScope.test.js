'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const { buildQueueCandidates } = require('../../services/learning/application/learningService');
const { itemMatchesScope, normalizeScope } = require('../../services/learning/domain/planScope');
const { createDefaultPlanningSignalProvider } = require('../../services/learning/planning/defaultPlanningSignalProvider');
const {
  CompositePlanningSignalProvider,
  PlanningSignalProvider,
} = require('../../services/learning/planning/planningSignalProvider');

const fullScope = normalizeScope({
  version: 1,
  languages: ['ja', 'en'],
  cardTypes: ['scenario_phrase', 'trilingual', 'grammar_ja'],
  dateRange: null,
  tags: [],
});

test.describe('Learning plan scope and queue policy', () => {
  test.it('requires both target languages for a scenario unit', () => {
    const scenario = { unit_kind: 'scenario_bilingual', generation_date: '2026-07-14' };
    assert.equal(itemMatchesScope(scenario, fullScope), true);
    const japaneseOnly = normalizeScope({
      version: 1,
      languages: ['ja'],
      cardTypes: ['scenario_phrase'],
      dateRange: null,
      tags: [],
    });
    assert.equal(itemMatchesScope(scenario, japaneseOnly), false);
  });

  test.it('normalizes duplicate values and rejects invalid limits at the boundary', () => {
    const scope = normalizeScope({
      languages: ['ja', 'en', 'ja'],
      cardTypes: ['trilingual', 'trilingual'],
      dateRange: { from: '2026-07-01', to: '2026-07-31' },
      tags: [{ namespace: 'topic', value: ' Travel ' }, { namespace: 'topic', value: 'travel' }],
    });
    assert.deepEqual(scope.languages, ['en', 'ja']);
    assert.deepEqual(scope.tags, [{ namespace: 'topic', value: 'travel' }]);
    assert.throws(() => normalizeScope({ languages: ['zh'], cardTypes: ['trilingual'] }), /unsupported/u);
  });

  test.it('orders overdue failures before overdue, due failures, due, then capped new items', () => {
    const base = {
      generation_id: 1,
      generation_date: '2026-07-14',
      unit_kind: 'trilingual_en',
      fsrs_state: 'review',
      last_reviewed_at_utc: '2026-07-01T00:00:00.000Z',
      stability: 1,
      difficulty: 5,
      elapsed_days: 1,
      scheduled_days: 1,
      reps: 1,
      lapses: 0,
      step: 0,
      schedule_version: 1,
    };
    const rows = [
      { ...base, study_item_id: 4, due_at_utc: '2026-07-14T04:00:00.000Z', last_rating: 3 },
      { ...base, study_item_id: 3, due_at_utc: '2026-07-14T03:00:00.000Z', last_rating: 1 },
      { ...base, study_item_id: 2, due_at_utc: '2026-07-13T04:00:00.000Z', last_rating: 3 },
      { ...base, study_item_id: 1, due_at_utc: '2026-07-13T03:00:00.000Z', last_rating: 2 },
      { ...base, study_item_id: 5, schedule_version: null, due_at_utc: null, last_rating: null },
      { ...base, study_item_id: 6, schedule_version: null, due_at_utc: null, last_rating: null },
    ];
    const result = buildQueueCandidates(
      rows,
      new Map([[1, new Set()]]),
      fullScope,
      { startUtc: '2026-07-13T16:00:00.000Z', endUtc: '2026-07-14T16:00:00.000Z' },
      '2026-07-14T01:00:00.000Z',
      1
    );
    assert.deepEqual(result.entries.map((entry) => [entry.studyItemId, entry.bucket]), [
      [1, 1], [2, 2], [3, 3], [4, 4], [5, 6],
    ]);
    assert.deepEqual(result.summary, { due: 4, new: 1, newAvailable: 2, deferredToday: 2 });
  });

  test.it('does not append new items when due work already reaches the daily action goal', () => {
    const rows = [
      {
        study_item_id: 1, generation_id: 1, generation_date: '2026-07-14', unit_kind: 'trilingual_en',
        fsrs_state: 'review', due_at_utc: '2026-07-14T00:00:00.000Z', schedule_version: 1, last_rating: 3,
      },
      {
        study_item_id: 2, generation_id: 1, generation_date: '2026-07-14', unit_kind: 'trilingual_en',
        schedule_version: null, due_at_utc: null, last_rating: null,
      },
    ];
    const result = buildQueueCandidates(
      rows,
      new Map([[1, new Set()]]),
      fullScope,
      { startUtc: '2026-07-13T16:00:00.000Z', endUtc: '2026-07-14T16:00:00.000Z' },
      '2026-07-14T01:00:00.000Z',
      5,
      1,
      0
    );
    assert.deepEqual(result.entries.map((entry) => entry.studyItemId), [1]);
    assert.equal(result.summary.newAvailable, 1);
    assert.equal(result.summary.new, 0);
  });

  test.it('applies semantic scores only after selecting the stable base queue set', () => {
    const rows = [
      { study_item_id: 1, generation_id: 1, generation_date: '2026-07-14', folder_name: '20260714', card_type: 'trilingual', unit_kind: 'trilingual_en', source_title: 'short', schedule_version: null },
      { study_item_id: 2, generation_id: 2, generation_date: '2026-07-14', folder_name: '20260714', card_type: 'trilingual', unit_kind: 'trilingual_en', source_title: 'x'.repeat(90), schedule_version: null },
      { study_item_id: 3, generation_id: 3, generation_date: '2026-07-14', folder_name: '20260714', card_type: 'trilingual', unit_kind: 'trilingual_en', source_title: 'y'.repeat(90), schedule_version: null },
    ];
    const result = buildQueueCandidates(
      rows,
      new Map(rows.map((row) => [row.generation_id, new Set()])),
      fullScope,
      { startUtc: '2026-07-13T16:00:00.000Z', endUtc: '2026-07-14T16:00:00.000Z' },
      '2026-07-14T01:00:00.000Z',
      2,
      20,
      0,
      createDefaultPlanningSignalProvider(),
      new Map()
    );
    assert.deepEqual(result.entries.map((entry) => entry.studyItemId), [2, 1]);
    assert.deepEqual(new Set(result.entries.map((entry) => entry.studyItemId)), new Set([1, 2]));
    assert.equal(result.entries[0].providerScore, 8);
    assert.equal(result.planning.diagnostics['graph-contract'].empty, 2);
  });

  test.it('keeps the exact base set and order when every provider fails', () => {
    class FailingProvider extends PlanningSignalProvider {
      constructor() { super({ id: 'failing-graph', version: '1', kind: 'graph' }); }
      evaluate() { throw new Error('graph unavailable'); }
    }
    const provider = new CompositePlanningSignalProvider({ providers: [new FailingProvider()] });
    const rows = [1, 2, 3].map((id) => ({
      study_item_id: id,
      generation_id: id,
      generation_date: '2026-07-14',
      card_type: 'trilingual',
      unit_kind: 'trilingual_en',
      source_title: `item ${id}`,
      schedule_version: null,
    }));
    const baseArgs = [
      rows,
      new Map(rows.map((row) => [row.generation_id, new Set()])),
      fullScope,
      { startUtc: '2026-07-13T16:00:00.000Z', endUtc: '2026-07-14T16:00:00.000Z' },
      '2026-07-14T01:00:00.000Z',
      2,
      20,
      0,
    ];
    const base = buildQueueCandidates(...baseArgs);
    const degraded = buildQueueCandidates(...baseArgs, provider);
    assert.deepEqual(degraded.entries, base.entries);
    assert.equal(degraded.planning.diagnostics['failing-graph'].failed, 2);
  });
});
