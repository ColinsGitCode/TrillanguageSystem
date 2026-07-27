export function escapeTextbookText(value) {
  return String(value || '')
    .replace(/&/gu, '&amp;')
    .replace(/</gu, '&lt;')
    .replace(/>/gu, '&gt;')
    .replace(/"/gu, '&quot;')
    .replace(/'/gu, '&#39;');
}

export function buildTextbookTrackDocument(track) {
  const expressions = (track?.expressions || [])
    .filter((expression) => expression.lifecycle === 'active')
    .map((expression) => `
      <section data-textbook-expression-id="${Number(expression.expression_id)}">
        <div data-textbook-language="en">${escapeTextbookText(expression.official_en_text)}</div>
        <div data-textbook-language="ja">${String(expression.ja_ruby_html || '')}</div>
        <div data-textbook-language="zh">${escapeTextbookText(expression.zh_cue_text)}</div>
      </section>`)
    .join('');
  return `<div data-textbook-track-id="${Number(track?.id)}" data-textbook-highlight-version="1">${expressions}</div>`;
}
