'use strict';

const express = require('express');
const generationJobService = require('../services/generation/generationJobService');
const kgSourceSyncService = require('../services/kg/kgSourceSyncService');
const textbookOperationService = require('../services/textbooks/textbookOperationService');
const languageMetadataRuntime = require('../services/languageMetadata/runtime');
const dbService = require('../services/storage/databaseService');
const { executeGenerationJob } = require('../services/application/executeGenerationJob');
const { createGracefulShutdown } = require('./gracefulShutdown');
const { PORT, GENERATION_WORKER_SHUTDOWN_TIMEOUT_MS } = require('./serverConfig');
const {
  createWorkspaceAccessMiddleware,
  resolveWorkspacePolicy,
} = require('./workspaceAccess');
const { createRuntimeRouter } = require('../routes/runtime');
const { createUiPerformanceRouter } = require('../routes/uiPerformance');
const { SandboxQuotaService } = require('../services/sandbox/sandboxQuotaService');
const log = require('./logger').child({ module: 'http' });

let processGuardsInstalled = false;
let signalGuardsInstalled = false;
const RETIRED_REACT_PATHS = new Set([
  '/__rr-poc',
  '/index.html',
  '/dashboard.html',
  '/knowledge-hub.html',
  '/knowledge-ops.html',
]);

const backgroundWorkers = {
  async shutdown({ timeoutMs } = {}) {
    const [generation, knowledgeGraph, textbooks, languageMetadata] = await Promise.all([
      generationJobService.shutdown({ timeoutMs }),
      kgSourceSyncService.shutdown({ timeoutMs }),
      textbookOperationService.shutdown({ timeoutMs }),
      languageMetadataRuntime.shutdown({ timeoutMs }),
    ]);
    const drained = Boolean(
      generation?.drained
      && knowledgeGraph?.drained
      && textbooks?.drained
      && languageMetadata?.drained
    );
    return {
      drained,
      currentJobId: drained ? null : {
        generation: generation?.currentJobId || null,
        knowledgeGraph: knowledgeGraph?.currentJobId || null,
        textbooks: textbooks?.currentJobId || null,
        languageMetadata: languageMetadata?.currentJobId || null,
      },
    };
  },
};

function createApp(options = {}) {
  const app = express();
  const { reactAssetsMiddleware, reactHandler } = options;
  const workspacePolicy = options.workspacePolicy || resolveWorkspacePolicy();
  const sandboxQuotaService = options.sandboxQuotaService
    || new SandboxQuotaService(workspacePolicy);
  app.locals.workspacePolicy = workspacePolicy;
  app.locals.sandboxQuotaService = sandboxQuotaService;

  if (reactAssetsMiddleware) app.use(reactAssetsMiddleware);
  app.use(express.static('public', { index: false }));
  app.use(express.json({ limit: '10mb' }));
  app.use(createRuntimeRouter(workspacePolicy, { quotaService: sandboxQuotaService }));
  app.use(createUiPerformanceRouter(workspacePolicy));
  app.use(createWorkspaceAccessMiddleware(workspacePolicy));
  app.use(sandboxQuotaService.createMiddleware());

  if (process.env.E2E_TEST_MODE === '1') {
    app.use(require('../routes/testReset'));
  }
  app.use(require('../routes/activity'));
  app.use(require('../routes/onboarding'));
  app.use(require('../routes/generationJobs'));
  app.use(require('../routes/generate'));
  app.use(require('../routes/selectionTts'));
  app.use(require('../routes/ocr'));
  app.use(require('../routes/health'));
  app.use(require('../routes/history'));
  app.use(require('../routes/files'));
  app.use(require('../routes/misc'));
  app.use(require('../routes/learning'));
  app.use(require('../routes/textbooks'));
  app.use(require('../routes/kg'));
  app.use(require('../routes/annotations'));
  app.use(require('../routes/manualTags'));
  app.use(require('../routes/localGlossary'));
  app.use(require('../routes/languageMetadata'));
  app.use(require('../routes/cardEngagement'));
  app.use(require('../routes/pronunciation'));
  app.use(require('../routes/pronunciationTelemetry'));
  app.use(require('../routes/cardReader'));

  if (reactHandler) {
    app.all('*', (req, res, next) => {
      const isDocumentRequest = req.method === 'GET' || req.method === 'HEAD';
      const isReactRoute = isDocumentRequest
        && !req.path.startsWith('/api/')
        && !RETIRED_REACT_PATHS.has(req.path)
        && (req.path === '/__manifest' || !req.path.split('/').at(-1)?.includes('.'));
      return isReactRoute ? reactHandler(req, res, next) : next();
    });
  }

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
    worker: backgroundWorkers,
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
    kgSourceSyncService.bootstrap();
    textbookOperationService.bootstrap();
    languageMetadataRuntime.bootstrap();
    log.info({
      port,
      cardsFactory: 'http://localhost:' + port + '/',
      rootOwner: options.reactEnabled ? 'react-router' : 'static-or-api-only',
      workspaceMode: app.locals.workspacePolicy?.mode,
      workspaceAccess: app.locals.workspacePolicy?.mode === 'sandbox'
        && !app.locals.workspacePolicy?.sandboxWriteEnabled ? 'read-only' : 'read-write',
      deploymentExposure: app.locals.workspacePolicy?.exposure,
    }, 'server listening');
  });
  installSignalGuards(serverInstance);
  return serverInstance;
}

module.exports = {
  createApp,
  startServer
};
