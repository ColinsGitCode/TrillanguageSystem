'use strict';

const path = require('path');

// Path of the per-card training sidecar JSON. Shared between the generation
// pipeline (which writes it) and the delete-record routes (which clean it up).
function buildTrainingSidecarPath(targetDir, baseName) {
  if (!targetDir || !baseName) return '';
  return path.join(targetDir, `${baseName}.training.v1.json`);
}

module.exports = { buildTrainingSidecarPath };
