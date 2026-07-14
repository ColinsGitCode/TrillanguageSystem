'use strict';

class LearningError extends Error {
  constructor(message, { code = 'LEARNING_INVALID_REQUEST', status = 400, details } = {}) {
    super(message);
    this.name = 'LearningError';
    this.code = code;
    this.status = status;
    if (details !== undefined) this.details = details;
  }
}

function learningError(code, message, status = 400, details) {
  return new LearningError(message, { code, status, details });
}

module.exports = {
  LearningError,
  learningError,
};
