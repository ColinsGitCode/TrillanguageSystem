// The card H1 can contain ruby markup. The modal header renders this title as
// plain text, so tags are stripped and readings dropped: leaving the markup in
// shows the literal `<ruby>…<rt>…` source, and keeping `rt` would splice the
// furigana into the visible title.
export function extractCardTitle(markdown, fallback) {
  const raw = String(markdown || '').match(/^#\s+(.+)$/m)?.[1]?.trim();
  if (!raw) return fallback;
  const plain = raw
    .replace(/<rt\b[^>]*>[\s\S]*?<\/rt>/gi, '')
    .replace(/<rp\b[^>]*>[\s\S]*?<\/rp>/gi, '')
    .replace(/<[^>]+>/g, '')
    .replace(/\s+/g, ' ')
    .trim();
  return plain || fallback;
}
