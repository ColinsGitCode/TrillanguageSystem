'use strict';

const RUBY_RE = /<ruby(?:\s[^>]*)?>([\s\S]*?)<rt(?:\s[^>]*)?>([\s\S]*?)<\/rt>(?:[\s\S]*?<\/ruby>)/giu;
const TAG_RE = /<[^>]+>/gu;

function stripTags(value) {
  return String(value || '').replace(TAG_RE, '').replace(/&(?:amp|lt|gt|quot|#39);/gu, (entity) => ({
    '&amp;': '&', '&lt;': '<', '&gt;': '>', '&quot;': '"', '&#39;': "'",
  }[entity] || entity));
}

function parseRuby(markdown) {
  const results = [];
  const source = String(markdown || '');
  let match;
  while ((match = RUBY_RE.exec(source)) !== null) {
    const base = stripTags(match[1]).trim();
    const reading = stripTags(match[2]).trim();
    if (!base || !reading) continue;
    results.push({ base, reading, offset: match.index, end: RUBY_RE.lastIndex });
  }
  RUBY_RE.lastIndex = 0;
  return results;
}

function adjacentRubyGroups(markdown) {
  const source = String(markdown || '');
  const tags = parseRuby(source);
  const groups = [];
  let current = [];
  for (const tag of tags) {
    const between = source.slice(current.at(-1)?.end ?? tag.offset, tag.offset);
    if (current.length && between !== '') {
      groups.push(current);
      current = [];
    }
    current.push(tag);
  }
  if (current.length) groups.push(current);
  return groups.filter((group) => group.length >= 2);
}

module.exports = { parseRuby, adjacentRubyGroups, stripTags };
