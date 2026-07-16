'use strict';

class KnowledgeGraphError extends Error {
  constructor(code, message, status = 400, details) {
    super(message);
    this.name = 'KnowledgeGraphError';
    this.code = code;
    this.status = status;
    this.details = details;
  }
}

function invalidInput(message, details) {
  return new KnowledgeGraphError('KG_INVALID_INPUT', message, 400, details);
}

module.exports = {
  KnowledgeGraphError,
  invalidInput,
};
