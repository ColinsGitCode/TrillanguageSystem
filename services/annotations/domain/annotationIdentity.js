'use strict';

const crypto = require('node:crypto');

function createLegacyAnnotationId(input) {
  const payload = [
    'card-annotation-legacy-v1',
    String(input.highlightId),
    String(input.runOrdinal),
    String(input.quote || ''),
    String(input.prefix || ''),
    String(input.suffix || ''),
  ].join('\u0000');
  return `ca_legacy_${crypto.createHash('sha256').update(payload).digest('hex').slice(0, 32)}`;
}

module.exports = {
  createLegacyAnnotationId,
};
