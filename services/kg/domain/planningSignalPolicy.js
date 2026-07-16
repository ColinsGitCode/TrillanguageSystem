'use strict';

const SIGNAL_VERSION = 'kg-lookup-signal-v1';

function scoreLookupDifficulty({ explicitLookupCount7d = 0, duplicateAttemptCount30d = 0 } = {}) {
  const explicit = Math.min(Math.max(Number(explicitLookupCount7d) || 0, 0), 3) * 8;
  const duplicate = Math.min(Math.max(Number(duplicateAttemptCount30d) || 0, 0), 2) * 3;
  return Math.min(30, explicit + duplicate);
}

module.exports = {
  SIGNAL_VERSION,
  scoreLookupDifficulty,
};
