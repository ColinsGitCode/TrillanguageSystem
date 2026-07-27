'use strict';

class SelectionTtsError extends Error {
  constructor(message, options = {}) {
    super(message);
    this.name = 'SelectionTtsError';
    this.code = options.code || 'SELECTION_TTS_FAILED';
    this.status = options.status || 500;
    this.details = options.details;
  }
}

function selectionTtsError(code, message, status, details) {
  return new SelectionTtsError(message, { code, status, details });
}

module.exports = { SelectionTtsError, selectionTtsError };
