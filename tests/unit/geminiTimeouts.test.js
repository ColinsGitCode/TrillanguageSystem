'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  EXECUTION_BUDGET_MS,
  MAX_EXECUTION_BUDGET_MS,
  HOP_BUFFER_MS,
  clampExecutionBudget,
  gatewayTimeoutFor,
  clientTimeoutFor,
} = require('../../services/llm/geminiTimeouts');

test.describe('geminiTimeouts', () => {
  test.it('exposes sane defaults with executor < max', () => {
    assert.ok(EXECUTION_BUDGET_MS > 0);
    assert.ok(HOP_BUFFER_MS > 0);
    assert.ok(MAX_EXECUTION_BUDGET_MS >= EXECUTION_BUDGET_MS);
  });

  test.it('clampExecutionBudget passes through values under the ceiling', () => {
    assert.equal(clampExecutionBudget(EXECUTION_BUDGET_MS + 1000), EXECUTION_BUDGET_MS + 1000);
  });

  test.it('clampExecutionBudget caps at the hard ceiling', () => {
    assert.equal(clampExecutionBudget(MAX_EXECUTION_BUDGET_MS * 10), MAX_EXECUTION_BUDGET_MS);
  });

  test.it('clampExecutionBudget falls back to the default for invalid input', () => {
    for (const bad of [0, -5, NaN, 'abc', undefined, null]) {
      assert.equal(clampExecutionBudget(bad), EXECUTION_BUDGET_MS, `input: ${bad}`);
    }
  });

  test.it('each hop adds exactly one buffer outward', () => {
    assert.equal(gatewayTimeoutFor(EXECUTION_BUDGET_MS), EXECUTION_BUDGET_MS + HOP_BUFFER_MS);
    assert.equal(clientTimeoutFor(EXECUTION_BUDGET_MS), EXECUTION_BUDGET_MS + 2 * HOP_BUFFER_MS);
  });

  test.it('hop timeouts respect the executor ceiling', () => {
    const huge = MAX_EXECUTION_BUDGET_MS * 5;
    assert.equal(gatewayTimeoutFor(huge), MAX_EXECUTION_BUDGET_MS + HOP_BUFFER_MS);
    assert.equal(clientTimeoutFor(huge), MAX_EXECUTION_BUDGET_MS + 2 * HOP_BUFFER_MS);
  });

  test.it('invariant: client > gateway > executor for any budget', () => {
    for (const budget of [1, 1000, EXECUTION_BUDGET_MS, 200000, MAX_EXECUTION_BUDGET_MS, 9_999_999]) {
      const exec = clampExecutionBudget(budget);
      const gateway = gatewayTimeoutFor(budget);
      const client = clientTimeoutFor(budget);
      assert.ok(client > gateway, `client(${client}) > gateway(${gateway}) for budget ${budget}`);
      assert.ok(gateway > exec, `gateway(${gateway}) > exec(${exec}) for budget ${budget}`);
    }
  });
});
