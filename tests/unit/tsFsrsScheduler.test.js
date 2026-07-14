'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const { SchedulerPort } = require('../../services/learning/scheduling/schedulerPort');
const {
  ADAPTER_VERSION,
  ALGORITHM_VERSION,
  PARAMETER_INPUT,
  TsFsrsScheduler,
} = require('../../services/learning/scheduling/tsFsrsScheduler');

const fixture = JSON.parse(fs.readFileSync(
  path.join(__dirname, '../fixtures/learning/fsrs-new-card.json'),
  'utf8'
));

test.describe('TsFsrsScheduler LA-P0 adapter', () => {
  test.it('implements SchedulerPort and locks the accepted algorithm contract', () => {
    const scheduler = new TsFsrsScheduler();
    assert.ok(scheduler instanceof SchedulerPort);
    const description = scheduler.describe();
    assert.equal(description.algorithmVersion, ALGORITHM_VERSION);
    assert.equal(description.adapterVersion, ADAPTER_VERSION);
    assert.equal(description.parameters.request_retention, PARAMETER_INPUT.request_retention);
    assert.equal(description.parameters.maximum_interval, PARAMETER_INPUT.maximum_interval);
    assert.equal(description.parameters.enable_fuzz, false);
    assert.match(description.parametersHash, /^[a-f0-9]{64}$/u);
  });

  for (const item of fixture.cases) {
    test.it(`matches the new-card golden fixture for rating ${item.rating}`, () => {
      const scheduler = new TsFsrsScheduler();
      const result = scheduler.schedule({
        rating: item.rating,
        reviewedAtUtc: fixture.reviewedAtUtc,
      });
      assert.deepEqual(result.afterState, item.afterState);
      assert.equal(result.publicExplanation.nextDueAtUtc, item.afterState.dueAtUtc);
    });
  }

  test.it('rejects ratings and timestamps outside the domain contract', () => {
    const scheduler = new TsFsrsScheduler();
    assert.throws(() => scheduler.schedule({ rating: 0, reviewedAtUtc: fixture.reviewedAtUtc }), /1 to 4/u);
    assert.throws(() => scheduler.schedule({ rating: 3, reviewedAtUtc: 'invalid' }), /valid date/u);
  });

  test.it('is available through both CommonJS and ESM package exports', async () => {
    assert.equal(typeof require('ts-fsrs').fsrs, 'function');
    const esm = await import('ts-fsrs');
    assert.equal(typeof esm.fsrs, 'function');
  });
});
