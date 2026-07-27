export const CARD_RENDER_ALLOWED_TAGS = ['audio', 'source', 'ruby', 'rt', 'rp', 'button', 'mark'];
export const CARD_RENDER_ALLOWED_ATTR = [
  'class', 'src', 'data-src', 'data-folder', 'data-card-renderer-version',
  'data-card-type', 'preload', 'controls', 'href', 'title', 'alt', 'aria-label', 'type',
];

export function normalizeLoanwordAnnotations(markdown) {
  if (!markdown || markdown.includes('loanword-block')) return markdown || '';
  return markdown.split(/\r?\n/).map((line) => {
    const match = line.match(/^\s*-\s*外来语标注[:：]\s*(.*)$/i);
    if (!match) return line;
    const items = String(match[1] || '无')
      .split(/[，,、；;]+/)
      .map((item) => item.trim())
      .filter(Boolean)
      .map((item) => {
        const [left, ...rest] = item.split('=');
        const right = rest.join('=').trim();
        return `<span class="loanword-tag">${left.trim()}${right ? ` → ${right}` : ''}</span>`;
      })
      .join(' ');
    return `<div class="loanword-block"><span class="loanword-label">外来语标注</span><span>${items}</span></div>`;
  }).join('\n');
}

export function adaptAudioToButtons(html, folder) {
  return String(html || '').replace(
    /<audio\b([^>]*?)\s+src=(['"])([^'"]+)\2([^>]*)>(?:<\/audio>)?/gi,
    (_match, _pre, _quote, src) => (
      `<button class="audio-btn" type="button" aria-label="播放语音" data-src="${src}" data-folder="${folder}">▶</button>`
    )
  );
}
