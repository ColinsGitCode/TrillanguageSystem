'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const { createDefaultPlanningSignalProvider } = require('../../services/learning/planning/defaultPlanningSignalProvider');
const { GraphPlanningSignalProvider } = require('../../services/learning/planning/graphPlanningSignalProvider');
const {
  CompositePlanningSignalProvider,
  PlanningSignalProvider,
} = require('../../services/learning/planning/planningSignalProvider');

class FixtureProvider extends PlanningSignalProvider {
  constructor(evaluate, options = {}) {
    super({ id: 'fixture', version: '1', maxDurationMs: 10, ...options });
    this.fixtureEvaluate = evaluate;
  }

  evaluate(item, context) {
    return this.fixtureEvaluate(item, context);
  }
}

test.describe('PlanningSignalProvider contract', () => {
  test.it('rejects invalid budgets and duplicate provider ids at composition time', () => {
    assert.throws(
      () => new FixtureProvider(() => null, { maxDurationMs: 0 }),
      /maxDurationMs must be positive/u
    );
    const first = new FixtureProvider(() => null);
    const second = new FixtureProvider(() => null);
    assert.throws(
      () => new CompositePlanningSignalProvider({ providers: [first, second] }),
      /provider ids must be unique/u
    );
  });

  test.it('normalizes public signals and bounds aggregate scores', () => {
    const provider = new CompositePlanningSignalProvider({
      providers: [new FixtureProvider(() => ({
        score: 200,
        groups: ['topic:travel', 'topic:travel'],
        reasons: [{ code: 'travel-context', label: '旅行主题' }, { code: '', label: 'private' }],
        evidence: [{ source: 'rule', ruleVersion: 'tags-v2', ruleKey: 'topic-travel' }],
      }))],
    });
    const result = provider.evaluate({ studyItemId: 1 }, {});
    assert.equal(result.score, 100);
    assert.deepEqual(result.signals[0], {
      providerId: 'fixture',
      providerVersion: '1',
      providerKind: 'heuristic',
      score: 100,
      groups: ['topic:travel'],
      reasons: [{ code: 'travel-context', label: '旅行主题' }],
      evidence: [{ source: 'rule', ruleVersion: 'tags-v2', ruleKey: 'topic-travel' }],
    });
    assert.equal(result.diagnostics.fixture.applied, 1);
  });

  test.it('degrades failures, asynchronous providers and over-budget results to no signal', () => {
    const failing = new FixtureProvider(() => { throw new Error('offline'); }, { id: 'failing' });
    const asynchronous = new FixtureProvider(() => Promise.resolve({ score: 10 }), { id: 'async' });
    const slow = new FixtureProvider(() => ({ score: 40 }), { id: 'slow', maxDurationMs: 5 });
    const ticks = [0, 1, 2, 20];
    const provider = new CompositePlanningSignalProvider({
      providers: [failing, asynchronous, slow],
      clock: () => ticks.shift(),
    });
    const result = provider.evaluate({ studyItemId: 1 }, {});
    assert.equal(result.score, null);
    assert.equal(result.diagnostics.failing.failed, 1);
    assert.equal(result.diagnostics.async.failed, 1);
    assert.equal(result.diagnostics.slow.timedOut, 1);
  });

  test.it('keeps the graph contract optional when no graph reader exists', () => {
    const provider = new CompositePlanningSignalProvider({
      providers: [new GraphPlanningSignalProvider()],
    });
    const result = provider.evaluate({ studyItemId: 1 }, {});
    assert.equal(result.score, null);
    assert.equal(result.diagnostics['graph-contract'].empty, 1);
  });

  test.it('uses tags and review evidence without requiring a graph signal', () => {
    const provider = createDefaultPlanningSignalProvider();
    const result = provider.evaluate({
      studyItemId: 7,
      unitKind: 'trilingual_ja',
      cardType: 'trilingual',
      generationDate: '2026-07-14',
      folderName: '20260714',
      sourceTitle: 'fixture',
      tags: [{
        namespace: 'topic',
        value: 'travel',
        normalizedValue: 'travel',
        source: 'rule',
        ruleVersion: 'tags-v2',
        ruleKey: 'topic-travel',
      }],
      reviewEvidence: { lapses: 2, difficulty: 8.2 },
    }, {});
    assert.equal(result.score, 30);
    assert.equal(result.diagnostics['heuristic-v1'].applied, 1);
    assert.equal(result.diagnostics['graph-contract'].empty, 1);
    assert.ok(result.signals[0].groups.includes('topic:travel'));
    assert.deepEqual(result.signals[0].evidence, [
      { source: 'rule', ruleVersion: 'tags-v2', ruleKey: 'topic-travel' },
    ]);
  });

  test.it('injects the graph reader into the default composite explanation', () => {
    const provider = createDefaultPlanningSignalProvider({
      graphSignalReader: {
        readPlanningSignal: () => ({
          score: 19,
          groups: ['lookup-difficulty'],
          reasons: [{ code: 'recent-lookup', label: '近期重复检索' }],
          evidence: [{
            source: 'kg-lookup-signal-v1',
            ruleVersion: 'kg-lookup-signal-v1',
            ruleKey: 'point:17',
          }],
        }),
      },
    });
    const result = provider.evaluate({
      studyItemId: 7,
      unitKind: 'trilingual_ja',
      cardType: 'trilingual',
      sourceTitle: 'fixture',
      tags: [],
      reviewEvidence: {},
    }, {});
    assert.equal(result.score, 19);
    assert.equal(result.diagnostics['graph-contract'].applied, 1);
    assert.equal(result.signals[1].providerId, 'graph-contract');
    assert.deepEqual(result.signals[1].reasons, [{ code: 'recent-lookup', label: '近期重复检索' }]);
    assert.deepEqual(result.signals[1].evidence, [{
      source: 'kg-lookup-signal-v1',
      ruleVersion: 'kg-lookup-signal-v1',
      ruleKey: 'point:17',
    }]);
  });

  test.it('degrades throwing, invalid and over-budget graph readers independently', () => {
    const throwing = new CompositePlanningSignalProvider({
      providers: [new GraphPlanningSignalProvider({
        signalReader: { readPlanningSignal() { throw new Error('locked'); } },
      })],
    });
    const thrown = throwing.evaluate({ studyItemId: 1 });
    assert.equal(thrown.score, null);
    assert.equal(thrown.diagnostics['graph-contract'].failed, 1);

    const invalid = new CompositePlanningSignalProvider({
      providers: [new GraphPlanningSignalProvider({
        signalReader: { readPlanningSignal: () => ({ score: Number.NaN }) },
      })],
    });
    const malformed = invalid.evaluate({ studyItemId: 1 });
    assert.equal(malformed.score, null);
    assert.equal(malformed.diagnostics['graph-contract'].failed, 1);

    const ticks = [0, 11];
    const slow = new CompositePlanningSignalProvider({
      providers: [new GraphPlanningSignalProvider({
        signalReader: { readPlanningSignal: () => ({ score: 10 }) },
      })],
      clock: () => ticks.shift(),
    });
    const timedOut = slow.evaluate({ studyItemId: 1 });
    assert.equal(timedOut.score, null);
    assert.equal(timedOut.diagnostics['graph-contract'].timedOut, 1);
  });
});
