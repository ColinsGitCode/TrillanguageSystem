'use strict';

class TextbookError extends Error {
  constructor(code, message, status = 400, details = undefined) {
    super(message || code);
    this.name = 'TextbookError';
    this.code = code;
    this.status = status;
    this.statusCode = status;
    if (details) this.details = details;
  }
}

function textbookError(code, status = 400, details = undefined) {
  return new TextbookError(code, code, status, details);
}

module.exports = {
  TextbookError,
  textbookError,
};
