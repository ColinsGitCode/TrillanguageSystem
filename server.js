'use strict';

require('dotenv').config();
const { createApp, startServer } = require('./lib/httpRuntime');

const app = createApp();
const serverInstance = startServer(app);

module.exports = { app, serverInstance };
