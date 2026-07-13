'use strict';

function waitForServerClose(server) {
  if (!server?.listening) return Promise.resolve(true);
  return new Promise((resolve) => {
    server.close(() => resolve(true));
  });
}

function withTimeout(promise, timeoutMs) {
  let timeoutId;
  return Promise.race([
    promise,
    new Promise((resolve) => {
      timeoutId = setTimeout(() => resolve(false), timeoutMs);
    })
  ]).finally(() => {
    if (timeoutId) clearTimeout(timeoutId);
  });
}

function createGracefulShutdown(options = {}) {
  const {
    server,
    worker,
    database,
    timeoutMs = 30_000,
    logger,
    exit = (code) => process.exit(code),
  } = options;
  let shutdownPromise = null;

  return function shutdown(signal = 'manual') {
    if (shutdownPromise) return shutdownPromise;

    shutdownPromise = (async () => {
      try {
        logger?.info?.({ signal }, 'graceful shutdown started');
        const httpClosePromise = withTimeout(waitForServerClose(server), timeoutMs);
        const [workerResult, httpClosed] = await Promise.all([
          worker.shutdown({ timeoutMs }),
          httpClosePromise,
        ]);
        const drained = Boolean(workerResult?.drained);

        if (!httpClosed) {
          server?.closeAllConnections?.();
        }

        if (drained && httpClosed) {
          database?.close?.();
        }

        const exitCode = drained && httpClosed ? 0 : 1;
        const details = {
          signal,
          exitCode,
          httpClosed,
          workerDrained: drained,
          currentJobId: workerResult?.currentJobId || null,
        };
        if (exitCode === 0) {
          logger?.info?.(details, 'graceful shutdown completed');
        } else {
          logger?.error?.(details, 'graceful shutdown timed out');
        }
        exit(exitCode);
        return details;
      } catch (error) {
        server?.closeAllConnections?.();
        const details = {
          signal,
          exitCode: 1,
          httpClosed: false,
          workerDrained: false,
          currentJobId: null,
          error: String(error?.message || error),
        };
        logger?.error?.({ err: error, ...details }, 'graceful shutdown failed');
        exit(1);
        return details;
      }
    })();

    return shutdownPromise;
  };
}

module.exports = {
  createGracefulShutdown,
  waitForServerClose,
  withTimeout,
};
