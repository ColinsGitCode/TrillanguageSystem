// server.js — Express bootstrap. The full generation pipeline lives in
// services/generation/cardGenerationService.js; per-route logic lives in routes/*.
// What stays here: middleware, the generation_jobs worker executor wiring,
// route mounting, the error middleware, and listen().
const express = require('express');
require('dotenv').config();

const generationJobService = require('./services/generation/generationJobService');

const app = express();
const {
    PORT,
    DEFAULT_GEMINI_MODEL,
} = require('./lib/serverConfig');
const log = require('./lib/logger').child({ module: 'http' });

app.use(express.static('public'));
// Do NOT mount RECORDS_PATH as static. In the docker layout DB_PATH lives
// inside RECORDS_PATH, so an `/data/<dbfile>` would have served the entire
// SQLite database (verified: 200 OK on /data/trilingual_records.db and
// /data/trilingual_records.db-wal). All audio + file reads go through
// /api/folders/:folder/files/:file, which validates the path properly.
app.use(express.json({ limit: '10mb' }));

// Generation jobs use the HTTP /api/generate endpoint as their executor, so
// the worker re-enters the same code path users hit. The worker's request
// carries X-Generation-Job-Worker:1 so the throttle skips it.
const { normalizeCardType, normalizeSourceMode } = require('./lib/serverConfig');
async function executeGenerationJobViaHttp(job) {
  const payload = {
    phrase: job.phraseNormalized,
    llm_provider: 'gemini',
    card_type: normalizeCardType(job.jobType),
    source_mode: normalizeSourceMode(job.sourceMode),
    target_folder: job.targetFolder || '',
    llm_model: DEFAULT_GEMINI_MODEL
  };

  const response = await fetch(`http://127.0.0.1:${PORT}/api/generate`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Generation-Job-Worker': '1'
    },
    body: JSON.stringify(payload)
  });

  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    const message = data?.error || `generation job http ${response.status}`;
    const error = new Error(message);
    error.status = response.status;
    error.payload = data;
    throw error;
  }
  return data;
}

// API Endpoints
if (process.env.E2E_TEST_MODE === '1') {
    // Test-only: lets each Playwright spec wipe DB + records dir without
    // restarting the server. NEVER mount in production.
    app.use(require('./routes/testReset'));
}
app.use(require('./routes/generationJobs'));
app.use(require('./routes/generate'));
app.use(require('./routes/ocr'));
app.use(require('./routes/health'));
app.use(require('./routes/history'));
app.use(require('./routes/dashboard'));
app.use(require('./routes/knowledge'));
app.use(require('./routes/srs'));
app.use(require('./routes/files'));
app.use(require('./routes/misc'));

// Central error handler — must be registered after all routes. Catches
// synchronous throws in handlers and anything passed to next(err) so a single
// bad request can't crash the process or leak a stack trace to the client.
app.use((err, req, res, next) => {
    if (res.headersSent) return next(err);
    log.error({ err, method: req.method, route: req.originalUrl }, 'unhandled route error');
    const status = Number(err && (err.status || err.statusCode)) || 500;
    res.status(status).json({
        error: (err && err.message) || 'Internal server error',
        code: (err && err.code) || undefined
    });
});

// Last-resort process guards: log instead of crashing on a stray rejection,
// but treat an uncaught exception as fatal (the process is in an unknown
// state) and let the supervisor restart it.
process.on('unhandledRejection', (reason) => {
    log.error({ err: reason instanceof Error ? reason : { message: String(reason) } }, 'unhandled promise rejection');
});
process.on('uncaughtException', (err) => {
    log.error({ err }, 'uncaught exception — exiting');
    process.exit(1);
});

const serverInstance = app.listen(PORT, () => {
    generationJobService.configureExecutor(executeGenerationJobViaHttp);
    generationJobService.bootstrap();
    log.info({ port: PORT, dashboard: `http://localhost:${PORT}/dashboard.html` }, 'server listening');
});

module.exports = { app, serverInstance };
