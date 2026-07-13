'use strict';

function isSqliteBusyError(error) {
  const code = String(error?.code || '').toUpperCase();
  const message = String(error?.message || '');
  return code === 'SQLITE_BUSY'
    || code === 'SQLITE_LOCKED'
    || /database (?:is )?(?:busy|locked)/i.test(message);
}

function sleepSync(delayMs) {
  if (delayMs <= 0) return;
  const signal = new Int32Array(new SharedArrayBuffer(4));
  Atomics.wait(signal, 0, 0, delayMs);
}

function runWithSqliteBusyRetry(operation, options = {}) {
  if (typeof operation !== 'function') throw new TypeError('SQLite operation must be a function');
  const maxRetries = Math.max(0, Number(options.maxRetries ?? 3));
  const baseDelayMs = Math.max(0, Number(options.baseDelayMs ?? 25));
  const sleep = typeof options.sleep === 'function' ? options.sleep : sleepSync;
  const onRetry = typeof options.onRetry === 'function' ? options.onRetry : null;

  for (let attempt = 0; ; attempt += 1) {
    try {
      return operation();
    } catch (error) {
      if (!isSqliteBusyError(error) || attempt >= maxRetries) throw error;
      const delayMs = baseDelayMs * (2 ** attempt);
      onRetry?.({ attempt: attempt + 1, delayMs, error });
      sleep(delayMs);
    }
  }
}

module.exports = {
  isSqliteBusyError,
  runWithSqliteBusyRetry,
};
