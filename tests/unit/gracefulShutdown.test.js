'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { createGracefulShutdown } = require('../../lib/gracefulShutdown');

function fakeServer({ closes = true } = {}) {
  return {
    listening: true,
    closeCalls: 0,
    forcedCalls: 0,
    close(callback) {
      this.closeCalls += 1;
      if (closes) setImmediate(callback);
    },
    closeAllConnections() {
      this.forcedCalls += 1;
    },
  };
}

test.describe('gracefulShutdown', () => {
  test.it('stops HTTP, drains the worker, closes SQLite, and exits cleanly', async () => {
    const server = fakeServer();
    const workerCalls = [];
    const database = { closeCalls: 0, close() { this.closeCalls += 1; } };
    const exits = [];
    const shutdown = createGracefulShutdown({
      server,
      worker: { async shutdown(options) { workerCalls.push(options); return { drained: true }; } },
      database,
      timeoutMs: 100,
      exit: (code) => exits.push(code),
    });

    const first = shutdown('SIGTERM');
    const second = shutdown('SIGINT');
    assert.equal(first, second, 'shutdown must be idempotent');
    const result = await first;

    assert.equal(result.exitCode, 0);
    assert.equal(server.closeCalls, 1);
    assert.deepEqual(workerCalls, [{ timeoutMs: 100 }]);
    assert.equal(database.closeCalls, 1);
    assert.deepEqual(exits, [0]);
  });

  test.it('does not close SQLite while a worker job remains active', async () => {
    const server = fakeServer();
    const database = { closeCalls: 0, close() { this.closeCalls += 1; } };
    const exits = [];
    const shutdown = createGracefulShutdown({
      server,
      worker: { async shutdown() { return { drained: false, currentJobId: 9 }; } },
      database,
      timeoutMs: 100,
      exit: (code) => exits.push(code),
    });

    const result = await shutdown('SIGTERM');
    assert.equal(result.exitCode, 1);
    assert.equal(result.currentJobId, 9);
    assert.equal(database.closeCalls, 0);
    assert.deepEqual(exits, [1]);
  });

  test.it('forces lingering HTTP connections after the shutdown timeout', async () => {
    const server = fakeServer({ closes: false });
    const exits = [];
    let databaseCloseCalls = 0;
    const shutdown = createGracefulShutdown({
      server,
      worker: { async shutdown() { return { drained: true }; } },
      database: { close() { databaseCloseCalls += 1; } },
      timeoutMs: 5,
      exit: (code) => exits.push(code),
    });

    const result = await shutdown('SIGTERM');
    assert.equal(result.httpClosed, false);
    assert.equal(server.forcedCalls, 1);
    assert.equal(databaseCloseCalls, 0);
    assert.deepEqual(exits, [1]);
  });

  test.it('forces a nonzero exit when worker drain itself throws', async () => {
    const server = fakeServer();
    const exits = [];
    const shutdown = createGracefulShutdown({
      server,
      worker: { async shutdown() { throw new Error('worker unavailable'); } },
      database: { close() { assert.fail('database must not close'); } },
      timeoutMs: 100,
      exit: (code) => exits.push(code),
    });

    const result = await shutdown('SIGTERM');
    assert.equal(result.exitCode, 1);
    assert.match(result.error, /worker unavailable/);
    assert.equal(server.forcedCalls, 1);
    assert.deepEqual(exits, [1]);
  });
});
