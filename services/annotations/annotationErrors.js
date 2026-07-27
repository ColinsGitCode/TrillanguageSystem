'use strict';

function annotationError(code, status = 400, details) {
  const error = new Error(code);
  error.code = code;
  error.status = status;
  if (details !== undefined) error.details = details;
  return error;
}

module.exports = {
  annotationError,
};
