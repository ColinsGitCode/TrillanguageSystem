function getPreferredAudioExtension(lang) {
  return String(lang || '').toLowerCase() === 'en' ? 'mp3' : 'wav';
}

function normalizeAudioExtension(extension, lang) {
  const normalized = String(extension || '').trim().toLowerCase().replace(/^\./, '');
  if (normalized) return normalized;
  return getPreferredAudioExtension(lang);
}

function stripKnownAudioExtension(value) {
  return String(value || '').replace(/\.(wav|mp3|m4a)$/i, '');
}

function rewriteLegacyAudioTagExtensions(markdown) {
  return String(markdown || '').replace(
    /(<audio\b[^>]*\bsrc=["'][^"']+_en_\d+)\.wav((?:["'][^>]*>))/gi,
    '$1.mp3$2'
  );
}

module.exports = {
  getPreferredAudioExtension,
  normalizeAudioExtension,
  stripKnownAudioExtension,
  rewriteLegacyAudioTagExtensions,
};
