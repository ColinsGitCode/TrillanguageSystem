import 'dotenv/config';
import express from 'express';
import { createRequestHandler } from '@react-router/express';
import runtime from './lib/httpRuntime.js';

const production = process.env.NODE_ENV === 'production';
let reactAssetsMiddleware;
let reactHandler;

if (production) {
  const build = await import('./build/server/index.js');
  reactAssetsMiddleware = express.static('build/client', { index: false });
  reactHandler = createRequestHandler({ build, mode: 'production' });
} else {
  const { createServer: createViteServer } = await import('vite');
  const vite = await createViteServer({
    server: { middlewareMode: true },
    appType: 'custom'
  });
  reactAssetsMiddleware = vite.middlewares;
  reactHandler = createRequestHandler({
    build: () => vite.ssrLoadModule('virtual:react-router/server-build'),
    mode: 'development'
  });
}

const app = runtime.createApp({ reactAssetsMiddleware, reactHandler });
const serverInstance = runtime.startServer(app, { reactEnabled: true });

export { app, serverInstance };
