'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  isSqliteBusyError,
  runWithSqliteBusyRetry,
} = require('../../services/storage/sqliteBusyRetry');

function sqliteError(code, message = 'database is locked') {
  return Object.assign(new Error(message), { code });
}

test.describe('sqliteBusyRetry', () => {
  test.it('recognizes SQLite busy and locked errors', () => {
    assert.equal(isSqliteBusyError(sqliteError('SQLITE_BUSY')), true);
    assert.equal(isSqliteBusyError(sqliteError('SQLITE_LOCKED')), true);
    assert.equal(isSqliteBusyError(new Error('database is busy')), true);
    assert.equal(isSqliteBusyError(new Error('validation failed')), false);
  });

  test.it('retries busy operations with bounded exponential delays', () => {
    let attempts = 0;
    const delays = [];
    const retries = [];
    const result = runWithSqliteBusyRetry(() => {
      attempts += 1;
      if (attempts < 3) throw sqliteError('SQLITE_BUSY');
      return 'claimed';
    }, {
      maxRetries: 3,
      baseDelayMs: 25,
      sleep: (delayMs) => delays.push(delayMs),
      onRetry: ({ attempt }) => retries.push(attempt),
    });

    assert.equal(result, 'claimed');
    assert.equal(attempts, 3);
    assert.deepEqual(delays, [25, 50]);
    assert.deepEqual(retries, [1, 2]);
  });

  test.it('does not retry unrelated failures', () => {
    let attempts = 0;
    assert.throws(() => runWithSqliteBusyRetry(() => {
      attempts += 1;
      throw new Error('bad input');
    }, { sleep: () => assert.fail('sleep must not run') }), /bad input/);
    assert.equal(attempts, 1);
  });

  test.it('throws the last busy error after the retry budget is exhausted', () => {
    let attempts = 0;
    assert.throws(() => runWithSqliteBusyRetry(() => {
      attempts += 1;
      throw sqliteError('SQLITE_BUSY');
    }, { maxRetries: 2, sleep: () => {} }), { code: 'SQLITE_BUSY' });
    assert.equal(attempts, 3);
  });
});
