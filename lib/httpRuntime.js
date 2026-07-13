'use strict';

const express = require('express');
const generationJobService = require('../services/generation/generationJobService');
const {
  PORT,
  DEFAULT_DEEPSEEK_MODEL,
  normalizeCardType,
  normalizeSourceMode
} = require('./serverConfig');
const log = require('./logger').child({ module: 'http' });

let processGuardsInstalled = false;

function createGenerationJobHttpExecutor(port) {
  return async function executeGenerationJobViaHttp(job) {
    const payload = {
      phrase: job.phraseNormalized,
      llm_provider: 'deepseek',
      card_type: normalizeCardType(job.jobType),
      source_mode: normalizeSourceMode(job.sourceMode),
      target_folder: job.targetFolder || '',
      llm_model: DEFAULT_DEEPSEEK_MODEL
    };

    const response = await fetch('http://127.0.0.1:' + port + '/api/generate', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Generation-Job-Worker': '1'
      },
      body: JSON.stringify(payload)
    });

    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
      const error = new Error(data?.error || 'generation job http ' + response.status);
      error.status = response.status;
      error.payload = data;
      throw error;
    }
    return data;
  };
}

function createApp(options = {}) {
  const app = express();
  const { reactAssetsMiddleware, reactHandler } = options;

  if (reactAssetsMiddleware) app.use(reactAssetsMiddleware);
  if (reactHandler) app.all(['/__rr-poc', '/__rr-poc/*'], reactHandler);

  app.use(express.static('public'));
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

  app.use((err, req, res, next) => {
    if (res.headersSent) return next(err);
    log.error({ err, method: req.method, route: req.originalUrl }, 'unhandled route error');
    const status = Number(err && (err.status || err.statusCode)) || 500;
    return res.status(status).json({
      error: (err && err.message) || 'Internal server error',
      code: (err && err.code) || undefined
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

function startServer(app, options = {}) {
  installProcessGuards();
  const port = Number(options.port || PORT);
  const serverInstance = app.listen(port, () => {
    generationJobService.configureExecutor(createGenerationJobHttpExecutor(port));
    generationJobService.bootstrap();
    log.info({
      port,
      cardsFactory: 'http://localhost:' + port + '/',
      reactProbe: options.reactEnabled ? 'http://localhost:' + port + '/__rr-poc' : undefined
    }, 'server listening');
  });
  return serverInstance;
}

module.exports = {
  createApp,
  createGenerationJobHttpExecutor,
  startServer
};
