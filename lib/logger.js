'use strict';

// Minimal structured logger — zero dependencies, JSON output for production
// ingestion, optional pretty mode for dev. Designed to replace ad-hoc
// `console.*` calls so log records carry stable fields (level, module,
// err.code, route, etc.) instead of free-text strings.
//
// API mirrors pino/bunyan conventions:
//   log.info('starting')
//   log.info({ port: 3010 }, 'listening')
//   log.error({ err }, 'failed')   // err is an Error, gets serialized
//   log.error(err, 'failed')        // pass Error directly
//   const child = log.child({ module: 'foo', req_id: '...' })
//
// Configuration via env at load time:
//   LOG_LEVEL=error|warn|info|debug   (default: info)
//   LOG_PRETTY=1                       (default: off; auto-on for dev)
//   LOG_SILENT=1                       (suppress all output)

const LEVELS = { error: 50, warn: 40, info: 30, debug: 20 };

function parseLevel(value, fallback) {
  const key = String(value || '').trim().toLowerCase();
  return LEVELS[key] || fallback;
}

function serializeError(err) {
  if (!err) return null;
  const out = {
    message: String(err.message || ''),
    name: err.name || 'Error',
  };
  if (err.code) out.code = err.code;
  if (err.status) out.status = err.status;
  if (err.payload) out.payload = err.payload;
  if (err.stack) out.stack = err.stack;
  return out;
}

// Coerce variadic args into { fields, msg }. Supports:
//   (msg), (fields, msg), (err, msg), ({ err, ...fields }, msg)
function normalize(args) {
  if (args.length === 0) return { fields: {}, msg: '' };
  if (args.length === 1) {
    const a = args[0];
    if (a instanceof Error) return { fields: { err: serializeError(a) }, msg: a.message };
    if (typeof a === 'string') return { fields: {}, msg: a };
    return { fields: { ...a }, msg: '' };
  }
  const [first, second] = args;
  const msg = typeof second === 'string' ? second : String(second);
  if (first instanceof Error) return { fields: { err: serializeError(first) }, msg };
  if (first && typeof first === 'object') {
    const fields = { ...first };
    if (fields.err instanceof Error) fields.err = serializeError(fields.err);
    return { fields, msg };
  }
  return { fields: {}, msg };
}

function createLogger(options = {}) {
  const minLevel = parseLevel(options.level || process.env.LOG_LEVEL, LEVELS.info);
  const pretty = options.pretty != null
    ? Boolean(options.pretty)
    : /^(1|true|yes)$/i.test(String(process.env.LOG_PRETTY || ''))
        || process.env.NODE_ENV === 'development';
  const silent = options.silent != null
    ? Boolean(options.silent)
    : /^(1|true|yes)$/i.test(String(process.env.LOG_SILENT || ''));
  const outStream = options.outStream || process.stdout;
  const errStream = options.errStream || process.stderr;

  function emit(record) {
    if (silent) return;
    const stream = record.level === 'error' ? errStream : outStream;
    if (pretty) {
      const { ts, level, msg, module: mod, ...rest } = record;
      const time = String(ts).slice(11, 19);
      const lvl = level.toUpperCase().padEnd(5);
      const tag = mod ? ` [${mod}]` : '';
      const extras = Object.entries(rest)
        .map(([k, v]) => `${k}=${typeof v === 'string' ? v : JSON.stringify(v)}`)
        .join(' ');
      stream.write(`${time} ${lvl}${tag} ${msg}${extras ? ' ' + extras : ''}\n`);
    } else {
      stream.write(JSON.stringify(record) + '\n');
    }
  }

  function buildBound(bindings) {
    function logAt(levelName) {
      const levelValue = LEVELS[levelName];
      return (...args) => {
        if (levelValue < minLevel) return;
        const { fields, msg } = normalize(args);
        emit({
          ts: new Date().toISOString(),
          level: levelName,
          ...bindings,
          ...fields,
          msg,
        });
      };
    }
    return {
      error: logAt('error'),
      warn: logAt('warn'),
      info: logAt('info'),
      debug: logAt('debug'),
      child: (extra) => buildBound({ ...bindings, ...(extra || {}) }),
    };
  }

  return buildBound({});
}

// Default singleton — bind a `module` field via `.child({ module: '...' })`.
const defaultLogger = createLogger();

module.exports = defaultLogger;
module.exports.createLogger = createLogger;
module.exports.serializeError = serializeError;
