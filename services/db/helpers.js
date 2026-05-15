'use strict';

// Tiny shared helpers for the databaseService domain modules. Keep this
// dependency-free — every module under services/db/* requires it.

function safeJsonParse(text, fallback) {
  if (text == null || text === '') return fallback;
  try {
    return JSON.parse(text);
  } catch (err) {
    return fallback;
  }
}

module.exports = { safeJsonParse };
