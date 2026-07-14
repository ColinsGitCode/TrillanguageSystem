'use strict';

const express = require('express');
const generationJobService = require('../services/generation/generationJobService');
const dbService = require('../services/storage/databaseService');
const { executeGenerationJob } = require('../services/application/executeGenerationJob');
const { createGracefulShutdown } = require('./gracefulShutdown');
const { PORT, GENERATION_WORKER_SHUTDOWN_TIMEOUT_MS } = require('./serverConfig');
const log = require('./logger').child({ module: 'http' });

let processGuardsInstalled = false;
let signalGuardsInstalled = false;

function createApp(options = {}) {
  const app = express();
  const { reactAssetsMiddleware, reactHandler } = options;

  if (reactAssetsMiddleware) app.use(reactAssetsMiddleware);
  app.use(express.static('public', { index: false }));
  app.use(express.json({ limit: '10mb' }));

  if (process.env.E2E_TEST_MODE === '1') {
    app.use(require('../routes/testReset'));
  }
  app.use(require('../routes/generationJobs'));
  app.use(require('../routes/generate'));
  app.use(require('../routes/ocr'));
  app.use(require('../routes/health'));
  app.use(require('../routes/history'));
  app.use(require('../routes/files'));
  app.use(require('../routes/misc'));
  app.use(require('../routes/learning'));

  if (reactHandler) app.all('/', reactHandler);

  app.use((err, req, res, next) => {
    if (res.headersSent) return next(err);
    log.error({ err, method: req.method, route: req.originalUrl }, 'unhandled route error');
    const status = Number(err && (err.status || err.statusCode)) || 500;
    return res.status(status).json({
      error: (err && err.message) || 'Internal server error',
      code: (err && err.code) || undefined,
      details: (err && err.details) || undefined
    });
  });

  return app;
}

function installProcessGuards() {
  if (processGuardsInstalled) return;
  processGuardsInstalled = true;
  process.on('unhandledRejection', (reason) => {
    log.error({ err: reason instanceof Error ? reason : { message: String(reason) } }, 'unhandled promise rejection');
  });
  process.on('uncaughtException', (err) => {
    log.error({ err }, 'uncaught exception - exiting');
    process.exit(1);
  });
}

function installSignalGuards(serverInstance) {
  if (signalGuardsInstalled) return;
  signalGuardsInstalled = true;
  const shutdown = createGracefulShutdown({
    server: serverInstance,
    worker: generationJobService,
    database: dbService,
    timeoutMs: GENERATION_WORKER_SHUTDOWN_TIMEOUT_MS,
    logger: log,
  });
  process.once('SIGTERM', () => void shutdown('SIGTERM'));
  process.once('SIGINT', () => void shutdown('SIGINT'));
}

function startServer(app, options = {}) {
  installProcessGuards();
  const port = Number(options.port || PORT);
  const serverInstance = app.listen(port, () => {
    generationJobService.configureExecutor(executeGenerationJob);
    generationJobService.bootstrap();
    log.info({
      port,
      cardsFactory: 'http://localhost:' + port + '/',
      rootOwner: options.reactEnabled ? 'react-router' : 'static-or-api-only'
    }, 'server listening');
  });
  installSignalGuards(serverInstance);
  return serverInstance;
}

module.exports = {
  createApp,
  startServer
};
