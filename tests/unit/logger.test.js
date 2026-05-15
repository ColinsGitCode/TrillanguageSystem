'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { createLogger, serializeError } = require('../../lib/logger');

// Tiny in-memory writable used to capture what the logger emits.
function capture() {
  const buf = [];
  return {
    stream: { write: (chunk) => buf.push(String(chunk)) },
    records: () => buf.join('').split('\n').filter(Boolean).map((s) => JSON.parse(s)),
    raw: () => buf.join(''),
  };
}

function mkLogger(opts = {}) {
  const out = capture();
  const err = capture();
  const log = createLogger({ level: 'debug', outStream: out.stream, errStream: err.stream, ...opts });
  return { log, out, err };
}

test.describe('logger', () => {
  test.it('emits a JSON record with ts/level/msg', () => {
    const { log, out } = mkLogger();
    log.info('hello');
    const recs = out.records();
    assert.equal(recs.length, 1);
    assert.equal(recs[0].level, 'info');
    assert.equal(recs[0].msg, 'hello');
    assert.match(recs[0].ts, /^\d{4}-\d{2}-\d{2}T/);
  });

  test.it('merges field bag into the record', () => {
    const { log, out } = mkLogger();
    log.info({ port: 3010, route: '/api/x' }, 'listening');
    const r = out.records()[0];
    assert.equal(r.port, 3010);
    assert.equal(r.route, '/api/x');
    assert.equal(r.msg, 'listening');
  });

  test.it('serializes an Error passed via fields.err', () => {
    const { log, err } = mkLogger();
    const e = new Error('boom');
    e.code = 'EXECUTOR_TIMEOUT';
    e.status = 504;
    log.error({ err: e, route: '/x' }, 'unhandled');
    const r = err.records()[0];
    assert.equal(r.err.message, 'boom');
    assert.equal(r.err.code, 'EXECUTOR_TIMEOUT');
    assert.equal(r.err.status, 504);
    assert.ok(r.err.stack && r.err.stack.includes('boom'));
    assert.equal(r.route, '/x');
  });

  test.it('accepts an Error as the first arg directly', () => {
    const { log, err } = mkLogger();
    log.error(new Error('direct'), 'oops');
    const r = err.records()[0];
    assert.equal(r.msg, 'oops');
    assert.equal(r.err.message, 'direct');
  });

  test.it('error level goes to errStream, others to outStream', () => {
    const { log, out, err } = mkLogger();
    log.info('a');
    log.warn('b');
    log.error('c');
    assert.equal(out.records().length, 2);
    assert.equal(err.records().length, 1);
    assert.equal(err.records()[0].level, 'error');
  });

  test.it('child binds fields onto every subsequent record', () => {
    const { log, out } = mkLogger();
    const childLog = log.child({ module: 'gemini', req_id: 'abc' });
    childLog.info('start');
    childLog.info({ attempt: 2 }, 'retry');
    const recs = out.records();
    assert.equal(recs[0].module, 'gemini');
    assert.equal(recs[0].req_id, 'abc');
    assert.equal(recs[1].module, 'gemini');
    assert.equal(recs[1].attempt, 2);
  });

  test.it('respects minLevel — filters out debug when level=info', () => {
    const { log, out } = mkLogger({ level: 'info' });
    log.debug('hidden');
    log.info('shown');
    const recs = out.records();
    assert.equal(recs.length, 1);
    assert.equal(recs[0].msg, 'shown');
  });

  test.it('silent mode produces no output', () => {
    const { log, out, err } = mkLogger({ silent: true });
    log.info('a');
    log.error('b');
    assert.equal(out.raw(), '');
    assert.equal(err.raw(), '');
  });

  test.it('pretty mode emits human-readable lines', () => {
    const { log, out } = mkLogger({ pretty: true });
    log.info({ port: 3010, module: 'http' }, 'listening');
    const text = out.raw();
    assert.match(text, /INFO/);
    assert.match(text, /\[http\]/);
    assert.match(text, /listening/);
    assert.match(text, /port=3010/);
  });
});

test.describe('serializeError', () => {
  test.it('returns null for falsy input', () => {
    assert.equal(serializeError(null), null);
    assert.equal(serializeError(undefined), null);
  });

  test.it('includes code/status/payload when present', () => {
    const e = new Error('x');
    e.code = 'C';
    e.status = 404;
    e.payload = { detail: 'y' };
    const s = serializeError(e);
    assert.equal(s.message, 'x');
    assert.equal(s.code, 'C');
    assert.equal(s.status, 404);
    assert.deepEqual(s.payload, { detail: 'y' });
  });
});
