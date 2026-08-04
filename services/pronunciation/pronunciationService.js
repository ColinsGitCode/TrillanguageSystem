'use strict';

const crypto = require('node:crypto');
const { analyzeJapaneseTokens } = require('../generation/japaneseFurigana');
const { parseRuby } = require('./rubyParser');
const { createDictionaryReader } = require('./pronunciationPorts');

const ANALYZER_VERSION = 'kuromoji-kuroshiro-v1';
const PROJECTION_VERSION = 'pronunciation-plain-text-v1';
const KANA_RE = /[ぁ-ゖァ-ヺー]/u;
const JAPANESE_RE = /[\u3040-\u30ff\u3400-\u9fff々〆ヵヶ]/u;
const HAN_ONLY_RE = /^[\u3400-\u9fff々〆ヵヶ]+$/u;

function sha256(value) {
  return crypto.createHash('sha256').update(String(value || '')).digest('hex');
}

function sourceHash(value) {
  return sha256(value);
}

function toHiragana(value) {
  return Array.from(String(value || '')).map((char) => {
    const code = char.codePointAt(0);
    if (code >= 0x30a1 && code <= 0x30f6) return String.fromCodePoint(code - 0x60);
    return char;
  }).join('');
}

function decodeEntities(value) {
  return String(value || '').replace(/&(?:amp|lt|gt|quot|#39);/gu, (entity) => ({
    '&amp;': '&', '&lt;': '<', '&gt;': '>', '&quot;': '"', '&#39;': "'",
  }[entity] || entity));
}

function stripMarkdownToJapaneseText(markdown) {
  let source = String(markdown || '').replace(/```[\s\S]*?```/gu, ' ');
  source = source.replace(/<ruby(?:\s[^>]*)?>([\s\S]*?)<rt(?:\s[^>]*)?>[\s\S]*?<\/rt>[\s\S]*?<\/ruby>/giu, '$1');
  source = source.replace(/<[^>]+>/gu, ' ');
  source = source.replace(/^\s{0,3}#{1,6}\s+/gmu, '');
  source = source.replace(/^\s*[-*+]\s+/gmu, '');
  source = source.replace(/^\s*>\s?/gmu, '');
  source = source.replace(/\*{1,3}|_{1,3}|`/gu, '');
  return decodeEntities(source).replace(/\s+/gu, ' ').trim();
}

function stripJapaneseLine(line) {
  let source = String(line || '').trim();
  source = source.replace(/^[-*+]\s+/u, '');
  source = source.replace(/^\*\*[^*]+\*\*\s*[:：]\s*/u, '');
  return stripMarkdownToJapaneseText(source);
}

function headingText(line) {
  return String(line || '')
    .replace(/<[^>]+>/gu, '')
    .replace(/\s+/gu, '');
}

function isJapaneseSectionHeading(line) {
  const heading = headingText(line);
  return /^##2\.(?:日本語|日语)/u.test(heading) || /^##(?:日本語|日语)/u.test(heading);
}

function isNextSectionHeading(line) {
  return /^##\s+/u.test(String(line || '')) && !/^###\s+/u.test(String(line || ''));
}

function isScenarioJapaneseLine(line) {
  return /^\s*-\s*\*\*日本語\*\*\s*[:：]/u.test(String(line || ''));
}

function hasJapaneseSignal(value) {
  return KANA_RE.test(String(value || ''));
}

function isUnresolvedHanResidue(analyzed, surface) {
  const reading = analyzed?.reading && analyzed.reading !== '*'
    ? String(analyzed.reading).trim()
    : '';
  return !reading && analyzed?.basic_form === '*' && HAN_ONLY_RE.test(String(surface || ''));
}

function extractJapaneseMarkup(markdown) {
  const source = String(markdown || '').replace(/\r\n?/gu, '\n');
  const lines = source.split('\n');
  const segments = [];
  let inJapaneseSection = false;
  let offset = 0;
  for (const line of lines) {
    const lineStart = offset;
    offset += line.length + 1;
    if (isJapaneseSectionHeading(line)) {
      inJapaneseSection = true;
      continue;
    }
    if (inJapaneseSection && isNextSectionHeading(line)) {
      inJapaneseSection = false;
    }
    if (isScenarioJapaneseLine(line)) {
      const match = String(line).match(/^\s*-\s*\*\*日本語\*\*\s*[:：]\s*(.*)$/u);
      if (match?.[1]) segments.push({ raw: match[1], lineStart });
      continue;
    }
    if (!inJapaneseSection || !line.trim()) continue;
    // Nested list items under Japanese examples are the Chinese cue, not input
    // for the Japanese analyzer. Keep the unindented Japanese source line.
    if (/^\s+[-*+]\s+/u.test(line)) continue;
    if (/^\s*[-*+]\s*\*\*(?:中文|翻译|解释|说明|使用提示|原始场景)\b/iu.test(line)) continue;
    const raw = stripJapaneseLine(line);
    if (!raw || (!hasJapaneseSignal(raw) && !/[\u3400-\u9fff々〆ヵヶ]/u.test(raw))) continue;
    segments.push({ raw: line, lineStart });
  }
  return segments;
}

function codePointLength(value) {
  return Array.from(String(value || '')).length;
}

function codePointToUtf16Index(value, codePointOffset) {
  let index = 0;
  let count = 0;
  for (const char of Array.from(String(value || ''))) {
    if (count >= codePointOffset) break;
    index += char.length;
    count += 1;
  }
  return index;
}

function locateJapaneseSegments(markdown, plainText) {
  const markupSegments = extractJapaneseMarkup(markdown);
  if (!markupSegments.length) {
    return [{ text: plainText, startCodePoint: 0, endCodePoint: codePointLength(plainText) }];
  }
  const segments = [];
  let searchCursor = 0;
  for (const segment of markupSegments) {
    const text = stripJapaneseLine(segment.raw);
    if (!text) continue;
    const utf16Index = plainText.indexOf(text, searchCursor);
    if (utf16Index < 0) continue;
    const startCodePoint = codePointLength(plainText.slice(0, utf16Index));
    const endCodePoint = startCodePoint + codePointLength(text);
    segments.push({ text, startCodePoint, endCodePoint });
    searchCursor = utf16Index + text.length;
  }
  return segments.length
    ? segments
    : [{ text: plainText, startCodePoint: 0, endCodePoint: codePointLength(plainText) }];
}

function japaneseMarkupForLegacyReader(markdown) {
  return extractJapaneseMarkup(markdown).map((segment) => segment.raw).join('\n');
}

function findAll(text, surface) {
  const hits = [];
  let cursor = 0;
  while (cursor < text.length) {
    const index = text.indexOf(surface, cursor);
    if (index < 0) break;
    hits.push({ startCodePoint: Array.from(text.slice(0, index)).length, endCodePoint: Array.from(text.slice(0, index + surface.length)).length });
    cursor = index + surface.length;
  }
  return hits;
}

function overlaps(span, other) {
  return span.startCodePoint < other.endCodePoint && other.startCodePoint < span.endCodePoint;
}

function parseLegacyRubyTokens(markdown) {
  const plainText = stripMarkdownToJapaneseText(markdown);
  const sourceTokens = parseRuby(markdown);
  const tokens = [];
  let cursor = 0;
  for (const source of sourceTokens) {
    const index = plainText.indexOf(source.base, cursor);
    if (index < 0) continue;
    const startCodePoint = Array.from(plainText.slice(0, index)).length;
    const endCodePoint = startCodePoint + Array.from(source.base).length;
    tokens.push({
      surface: source.base,
      startCodePoint,
      endCodePoint,
      readingRaw: source.reading,
      readingHiragana: toHiragana(source.reading),
      unitKind: Array.from(source.base).length === 1 ? 'kanji' : 'word',
      status: 'accepted',
      source: 'legacy-ruby',
      ruleVersion: 'legacy-ruby-v1',
      evidence: { sourceOffset: source.offset },
      components: [],
    });
    cursor = index + source.base.length;
  }
  return { plainText, tokens };
}

function shiftToken(token, startCodePoint) {
  return {
    ...token,
    startCodePoint: token.startCodePoint + startCodePoint,
    endCodePoint: token.endCodePoint + startCodePoint,
  };
}

function mapLegacyTokensToPlainText(tokens, plainText, segments) {
  const mapped = [];
  let searchCursor = segments.length
    ? codePointToUtf16Index(plainText, segments[0].startCodePoint)
    : 0;
  for (const token of tokens) {
    const index = plainText.indexOf(token.surface, searchCursor);
    if (index < 0) continue;
    const startCodePoint = codePointLength(plainText.slice(0, index));
    const endCodePoint = startCodePoint + codePointLength(token.surface);
    const segment = segments.find((item) => startCodePoint >= item.startCodePoint && endCodePoint <= item.endCodePoint);
    if (!segment) continue;
    mapped.push({ ...token, startCodePoint, endCodePoint });
    searchCursor = index + token.surface.length;
  }
  return mapped;
}

function chooseDictionaryTokens(text, entries) {
  const selected = [];
  for (const entry of [...entries].sort((a, b) => String(b.surface).length - String(a.surface).length)) {
    for (const span of findAll(text, entry.surface)) {
      if (selected.some((existing) => overlaps(existing, span))) continue;
      selected.push({
        ...span,
        surface: entry.surface,
        readingRaw: entry.reading,
        readingHiragana: toHiragana(entry.reading),
        unitKind: entry.unitKind || 'word',
        status: 'accepted',
        source: 'dictionary',
        ruleVersion: 'ja-pronunciation-v1',
        evidence: { reason: entry.reason || 'dictionary' },
        components: [],
      });
    }
  }
  return selected;
}

async function buildTokens(text, { dictionaryReader = createDictionaryReader(), legacyMarkdown = null, japaneseSegments = null } = {}) {
  const plainText = String(text || '').trim();
  const segments = japaneseSegments?.length
    ? japaneseSegments
    : [{ text: plainText, startCodePoint: 0, endCodePoint: codePointLength(plainText) }];
  const tokens = [];
  const skippedTokens = [];
  for (const segment of segments) {
    tokens.push(...chooseDictionaryTokens(segment.text, dictionaryReader.entries())
      .map((token) => shiftToken(token, segment.startCodePoint)));
    const analyzerTokens = await analyzeJapaneseTokens(segment.text);
    let searchCursor = 0;
    for (const analyzed of analyzerTokens) {
      const surface = String(analyzed.surface_form || '');
      if (!surface || !JAPANESE_RE.test(surface)) continue;
      const index = segment.text.indexOf(surface, searchCursor);
      if (index < 0) continue;
      const span = {
        startCodePoint: segment.startCodePoint + codePointLength(segment.text.slice(0, index)),
        endCodePoint: segment.startCodePoint + codePointLength(segment.text.slice(0, index + surface.length)),
      };
      searchCursor = index + surface.length;
      if (isUnresolvedHanResidue(analyzed, surface)) {
        skippedTokens.push({
          ...span,
          surface,
          reason: 'han-only-without-reading',
          analyzerVersion: ANALYZER_VERSION,
        });
        continue;
      }
      if (tokens.some((existing) => overlaps(existing, span))) continue;
      const readingRaw = analyzed.reading && analyzed.reading !== '*' ? analyzed.reading : null;
      tokens.push({
        ...span,
        surface,
        readingRaw,
        readingHiragana: readingRaw ? toHiragana(readingRaw) : null,
        unitKind: Array.from(surface).length === 1 ? 'kanji' : 'word',
        status: readingRaw ? 'accepted' : 'unresolved',
        source: 'analyzer',
        ruleVersion: ANALYZER_VERSION,
        evidence: {
          basicForm: analyzed.basic_form || null,
          pos: analyzed.pos || null,
          posDetail: analyzed.pos_detail_1 || null,
        },
        components: [],
      });
    }
  }
  if (legacyMarkdown && /<ruby[\s>]/iu.test(legacyMarkdown)) {
    const legacy = parseLegacyRubyTokens(legacyMarkdown);
    tokens.push(...mapLegacyTokensToPlainText(legacy.tokens, plainText, segments));
  }
  const accepted = tokens
    .filter((token, index, all) => !all.some((other, otherIndex) => (
      otherIndex < index && other.status === 'accepted' && overlaps(other, token)
    )));
  return {
    plainText,
    tokens: addTokenKeys(accepted),
    skippedTokens,
    status: accepted.some((token) => token.status === 'unresolved') ? 'partial' : 'ready',
  };
}

function addTokenKeys(tokens) {
  return [...tokens]
    .sort((a, b) => a.startCodePoint - b.startCodePoint || b.endCodePoint - a.endCodePoint)
    .map((token, index) => ({ ...token, tokenKey: `token:${index + 1}` }));
}

function documentHash(plainText, tokens) {
  return sha256(JSON.stringify({ projectionVersion: PROJECTION_VERSION, plainText, tokens: tokens.map((token) => ({
    tokenKey: token.tokenKey, surface: token.surface, startCodePoint: token.startCodePoint,
    endCodePoint: token.endCodePoint, readingRaw: token.readingRaw, readingHiragana: token.readingHiragana,
    unitKind: token.unitKind, status: token.status, source: token.source, ruleVersion: token.ruleVersion,
  })) }));
}

function createPronunciationService({
  dbService,
  dictionaryReader = createDictionaryReader(),
  now = () => new Date().toISOString(),
  legacyReaderEnabled = true,
} = {}) {
  if (!dbService) throw new TypeError('PronunciationService requires dbService');
  async function ensureGeneration(generationId, options = {}) {
    const record = dbService.getGenerationById(Number(generationId));
    if (!record) {
      const error = new Error('Generation not found');
      error.code = 'PRONUNCIATION_TARGET_NOT_FOUND';
      error.status = 404;
      throw error;
    }
    const plainText = stripMarkdownToJapaneseText(record.markdown_content);
    const japaneseSegments = locateJapaneseSegments(record.markdown_content, plainText);
    const existing = dbService.getPronunciationDocument('generation', record.id, record.content_hash);
    if (existing && !options.force) {
      return { document: existing, tokens: dbService.listPronunciationTokens(existing.id), plainText };
    }
    const built = await buildTokens(plainText, {
      dictionaryReader,
      japaneseSegments,
      legacyMarkdown: legacyReaderEnabled ? japaneseMarkupForLegacyReader(record.markdown_content) : null,
    });
    const payload = {
      targetKind: 'generation', targetId: record.id, sourceContentHash: record.content_hash,
      status: built.status, analyzerVersion: ANALYZER_VERSION, dictionaryVersion: dictionaryReader.version(),
      projectionVersion: PROJECTION_VERSION, documentHash: documentHash(built.plainText, built.tokens),
      tokens: built.tokens, now: now(),
    };
    if (existing) return dbService.updatePronunciationProjection({ ...payload, documentId: existing.id, expectedRevision: existing.revision });
    return dbService.createPronunciationDocument(payload);
  }

  async function getGeneration(generationId, options = {}) {
    return ensureGeneration(generationId, options);
  }

  async function ensureTextbookExpression(expressionId, options = {}) {
    const record = dbService.getTextbookExpression(Number(expressionId));
    if (!record) {
      const error = new Error('Textbook expression not found');
      error.code = 'PRONUNCIATION_TARGET_NOT_FOUND';
      error.status = 404;
      throw error;
    }
    const plainText = stripMarkdownToJapaneseText(record.ja_ruby_html || record.official_ja_text || '');
    const sourceContentHash = record.ja_unit_hash && /^[a-f0-9]{64}$/u.test(record.ja_unit_hash)
      ? record.ja_unit_hash
      : sourceHash(record.official_ja_text || '');
    const existing = dbService.getPronunciationDocument('textbook_expression', record.expression_id, sourceContentHash);
    if (existing && !options.force) {
      return { document: existing, tokens: dbService.listPronunciationTokens(existing.id), plainText };
    }
    const built = await buildTokens(record.official_ja_text || plainText, {
      dictionaryReader,
      legacyMarkdown: legacyReaderEnabled ? record.ja_ruby_html || null : null,
    });
    const tokens = built.tokens.map((token) => ({
      ...token,
      source: token.source === 'legacy-ruby' ? 'textbook' : token.source,
      ruleVersion: token.source === 'legacy-ruby' ? 'textbook-ruby-v1' : token.ruleVersion,
      status: token.readingHiragana ? 'accepted' : token.status,
      evidence: { ...(token.evidence || {}), source: 'textbook-expression' },
    }));
    const payload = {
      targetKind: 'textbook_expression', targetId: record.expression_id, sourceContentHash,
      status: built.status, analyzerVersion: ANALYZER_VERSION, dictionaryVersion: dictionaryReader.version(),
      projectionVersion: PROJECTION_VERSION, documentHash: documentHash(built.plainText, tokens),
      tokens, now: now(),
    };
    if (existing) return dbService.updatePronunciationProjection({ ...payload, documentId: existing.id, expectedRevision: existing.revision });
    return dbService.createPronunciationDocument(payload);
  }

  async function correct(payload = {}) {
    const targetKind = payload.targetKind || 'generation';
    const document = dbService.getPronunciationDocument(targetKind, payload.targetId, payload.sourceContentHash || null);
    if (!document) {
      const error = new Error('Pronunciation document not found');
      error.code = 'PRONUNCIATION_DOCUMENT_NOT_FOUND';
      error.status = 404;
      throw error;
    }
    const tokens = dbService.listPronunciationTokens(document.id);
    const nextTokens = tokens.map((token) => token.tokenKey === payload.tokenKey ? {
      ...token,
      readingHiragana: payload.readingHiragana ?? token.readingHiragana,
      readingRaw: payload.readingRaw ?? token.readingRaw,
      status: payload.status || token.status,
      source: 'manual',
      ruleVersion: 'manual-v1',
    } : token);
    const body = { tokenKey: payload.tokenKey, readingRaw: payload.readingRaw || null, readingHiragana: payload.readingHiragana || null, status: payload.status || 'accepted' };
    const payloadJson = JSON.stringify(body);
    const record = targetKind === 'textbook_expression'
      ? dbService.getTextbookExpression(Number(payload.targetId))
      : dbService.getGenerationById(Number(payload.targetId));
    const plainText = payload.plainText || stripMarkdownToJapaneseText(
      targetKind === 'textbook_expression'
        ? record?.ja_ruby_html || record?.official_ja_text || ''
        : record?.markdown_content || ''
    );
    return dbService.applyPronunciationCorrection({
      documentId: document.id,
      tokenKey: payload.tokenKey,
      eventKey: String(payload.eventKey || ''),
      eventType: payload.eventType || 'reading',
      payloadJson,
      payloadHash: sha256(payloadJson),
      expectedRevision: payload.expectedRevision,
      documentHash: documentHash(plainText, nextTokens),
      tokens: nextTokens,
      now: now(),
    });
  }

  return {
    ensureGeneration,
    getGeneration,
    ensureTextbookExpression,
    correct,
    buildTokens: (text, options) => buildTokens(text, { dictionaryReader, ...options }),
    stripMarkdownToJapaneseText,
    locateJapaneseSegments,
    japaneseMarkupForLegacyReader,
    toHiragana,
    documentHash,
  };
}

module.exports = {
  ANALYZER_VERSION,
  PROJECTION_VERSION,
  createPronunciationService,
  buildTokens,
  sourceHash,
  stripMarkdownToJapaneseText,
  locateJapaneseSegments,
  japaneseMarkupForLegacyReader,
  toHiragana,
  isUnresolvedHanResidue,
  documentHash,
};
