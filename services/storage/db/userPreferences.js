'use strict';

function getPreference(db, key, fallback = null) {
  const normalizedKey = String(key || '').trim();
  if (!normalizedKey) return fallback;
  const row = db.prepare('SELECT value FROM user_preferences WHERE key = ?').get(normalizedKey);
  return row ? row.value : fallback;
}

function setPreference(db, key, value) {
  const normalizedKey = String(key || '').trim();
  if (!normalizedKey) throw new Error('preference key is required');
  const normalizedValue = String(value);
  db.prepare(`
    INSERT INTO user_preferences (key, value, updated_at)
    VALUES (@key, @value, CURRENT_TIMESTAMP)
    ON CONFLICT(key) DO UPDATE SET
      value = excluded.value,
      updated_at = CURRENT_TIMESTAMP
  `).run({ key: normalizedKey, value: normalizedValue });
  return normalizedValue;
}

module.exports = {
  getPreference,
  setPreference,
};
