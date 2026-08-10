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

function chooseDictionaryTokens(text, entries, dictionaryVersion) {
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
        ruleVersion: dictionaryVersion,
        evidence: {
          reason: entry.reason || 'dictionary',
          ...(entry.foreignOrigin ? { foreignOrigin: entry.foreignOrigin } : {}),
        },
        components: [],
      });
    }
  }
  return selected;
}

// A する-verb built on a noun ("更新する") is analysed as two tokens: the noun
// tagged サ変接続 and a separate する inflection. Reporting the noun's dictionary
// form as "更新" told the reader nothing, and the compound only showed up on a
// bare "し". These helpers report the compound once, on the noun.
//
// The サ変接続 tag alone is not sufficient: "表示を" carries it while being used
// as a plain noun, so the following token must really be する.
function isSuruInflection(analyzed) {
  return Boolean(analyzed)
    && analyzed.pos === '動詞'
    && analyzed.basic_form === 'する';
}

function suruCompoundBasicForm(analyzerTokens, index, surface) {
  const analyzed = analyzerTokens[index];
  if (!analyzed || analyzed.pos !== '名詞' || analyzed.pos_detail_1 !== 'サ変接続') return null;
  if (!isSuruInflection(analyzerTokens[index + 1])) return null;
  return `${surface}する`;
}

// The する fragment itself is now redundant: suppressing its dictionary form
// keeps the compound reported once instead of on both halves.
function isMergedSuruInflection(analyzerTokens, index) {
  const previous = analyzerTokens[index - 1];
  return isSuruInflection(analyzerTokens[index])
    && Boolean(previous)
    && previous.pos === '名詞'
    && previous.pos_detail_1 === 'サ変接続';
}

async function buildTokens(text, { dictionaryReader = createDictionaryReader(), legacyMarkdown = null, japaneseSegments = null } = {}) {
  const plainText = String(text || '').trim();
  const segments = japaneseSegments?.length
    ? japaneseSegments
    : [{ text: plainText, startCodePoint: 0, endCodePoint: codePointLength(plainText) }];
  const tokens = [];
  const skippedTokens = [];
  for (const segment of segments) {
    tokens.push(...chooseDictionaryTokens(segment.text, dictionaryReader.entries(), dictionaryReader.version())
      .map((token) => shiftToken(token, segment.startCodePoint)));
    const analyzerTokens = await analyzeJapaneseTokens(segment.text);
    let searchCursor = 0;
    for (const [analyzedIndex, analyzed] of analyzerTokens.entries()) {
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
      const overlapping = tokens.find((existing) => overlaps(existing, span));
      if (overlapping) {
        // A dictionary token already owns this span (katakana loanwords such as
        // リフレッシュ). The compound still has to be recorded here, otherwise
        // suppressing the する half would leave リフレッシュする reported nowhere.
        const claimedCompound = suruCompoundBasicForm(analyzerTokens, analyzedIndex, surface);
        if (claimedCompound && !overlapping.evidence?.basicForm) {
          overlapping.evidence = { ...(overlapping.evidence || {}), basicForm: claimedCompound };
        }
        continue;
      }
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
          basicForm: suruCompoundBasicForm(analyzerTokens, analyzedIndex, surface)
            || analyzed.basic_form
            || null,
          pos: analyzed.pos || null,
          posDetail: analyzed.pos_detail_1 || null,
          ...(isMergedSuruInflection(analyzerTokens, analyzedIndex)
            ? { suruCompoundOf: analyzerTokens[analyzedIndex - 1].surface_form }
            : {}),
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

function localizePronunciationProjection(markdown, sourcePlainText, tokens, preferredText = '') {
  const targetPlainText = stripMarkdownToJapaneseText(markdown);
  const source = String(sourcePlainText || '');
  const preferred = stripMarkdownToJapaneseText(preferredText);
  let sourceUtf16Start = source.indexOf(targetPlainText);
  let targetUtf16Start = 0;
  let matchText = targetPlainText;
  if (sourceUtf16Start < 0 && preferred) {
    sourceUtf16Start = source.indexOf(preferred);
    targetUtf16Start = targetPlainText.indexOf(preferred);
    matchText = preferred;
  }
  if (sourceUtf16Start < 0 || targetUtf16Start < 0 || !matchText) {
    return { plainText: targetPlainText, tokens: [] };
  }
  const sourceStart = codePointLength(source.slice(0, sourceUtf16Start));
  const targetStart = codePointLength(targetPlainText.slice(0, targetUtf16Start));
  const sourceEnd = sourceStart + codePointLength(matchText);
  return {
    plainText: targetPlainText,
    tokens: tokens
      .filter((token) => token.startCodePoint >= sourceStart && token.endCodePoint <= sourceEnd)
      .map((token) => ({
        ...token,
        startCodePoint: targetStart + token.startCodePoint - sourceStart,
        endCodePoint: targetStart + token.endCodePoint - sourceStart,
      })),
  };
}

function createPronunciationService({
  dbService,
  dictionaryReader = createDictionaryReader(),
  now = () => new Date().toISOString(),
  legacyReaderEnabled = true,
} = {}) {
  if (!dbService) throw new TypeError('PronunciationService requires dbService');
  const acceptedOrigins = new Map(dictionaryReader.entries()
    .filter((entry) => entry.foreignOrigin?.term)
    .map((entry) => [entry.surface, entry.foreignOrigin]));

  function enrichVisibleTokens(tokens) {
    return tokens.map((token) => {
      const foreignOrigin = acceptedOrigins.get(token.surface);
      if (!foreignOrigin || token.evidence?.foreignOrigin) return token;
      return {
        ...token,
        evidence: { ...(token.evidence || {}), foreignOrigin },
      };
    });
  }
  function targetNotFound(message) {
    const error = new Error(message);
    error.code = 'PRONUNCIATION_TARGET_NOT_FOUND';
    error.status = 404;
    return error;
  }

  function ephemeralDocument(payload) {
    return {
      id: null,
      persisted: false,
      targetKind: payload.targetKind,
      targetId: payload.targetId,
      sourceContentHash: payload.sourceContentHash,
      projectionVersion: payload.projectionVersion,
      status: payload.status,
      analyzerVersion: payload.analyzerVersion,
      dictionaryVersion: payload.dictionaryVersion,
      documentHash: payload.documentHash,
      revision: 0,
      createdAtUtc: null,
      updatedAtUtc: null,
    };
  }

  function generationRecord(generationId) {
    const record = dbService.getGenerationById(Number(generationId));
    if (!record) throw targetNotFound('Generation not found');
    return record;
  }

  async function buildGenerationProjection(generationId, sourceRecord = null) {
    const record = sourceRecord || generationRecord(generationId);
    const plainText = stripMarkdownToJapaneseText(record.markdown_content);
    const japaneseSegments = locateJapaneseSegments(record.markdown_content, plainText);
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
    return { record, plainText, payload };
  }

  async function readGeneration(generationId, options = {}) {
    const record = generationRecord(generationId);
    const existing = dbService.getPronunciationDocument('generation', record.id, record.content_hash);
    if (existing && !options.refresh) {
      return {
        document: existing,
        tokens: enrichVisibleTokens(dbService.listPronunciationTokens(existing.id)),
        plainText: stripMarkdownToJapaneseText(record.markdown_content),
      };
    }
    const { plainText, payload } = await buildGenerationProjection(generationId, record);
    return { document: ephemeralDocument(payload), tokens: payload.tokens, plainText };
  }

  async function ensureGeneration(generationId, options = {}) {
    const record = generationRecord(generationId);
    const existing = dbService.getPronunciationDocument('generation', record.id, record.content_hash);
    if (existing && !options.force) {
      return {
        document: existing,
        tokens: enrichVisibleTokens(dbService.listPronunciationTokens(existing.id)),
        plainText: stripMarkdownToJapaneseText(record.markdown_content),
      };
    }
    const { payload } = await buildGenerationProjection(generationId, record);
    if (existing) return dbService.updatePronunciationProjection({ ...payload, documentId: existing.id, expectedRevision: existing.revision });
    return dbService.createPronunciationDocument(payload);
  }

  async function getGeneration(generationId, options = {}) {
    return readGeneration(generationId, options);
  }

  function textbookExpressionRecord(expressionId) {
    const record = dbService.getTextbookExpression(Number(expressionId));
    if (!record) throw targetNotFound('Textbook expression not found');
    return record;
  }

  function textbookExpressionSourceHash(record) {
    return record.ja_unit_hash && /^[a-f0-9]{64}$/u.test(record.ja_unit_hash)
      ? record.ja_unit_hash
      : sourceHash(record.official_ja_text || '');
  }

  async function buildTextbookExpressionProjection(expressionId, sourceRecord = null) {
    const record = sourceRecord || textbookExpressionRecord(expressionId);
    const plainText = stripMarkdownToJapaneseText(record.ja_ruby_html || record.official_ja_text || '');
    const sourceContentHash = textbookExpressionSourceHash(record);
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
    return { record, plainText, sourceContentHash, payload };
  }

  async function readTextbookExpression(expressionId, options = {}) {
    const record = textbookExpressionRecord(expressionId);
    const sourceContentHash = textbookExpressionSourceHash(record);
    const existing = dbService.getPronunciationDocument('textbook_expression', record.expression_id, sourceContentHash);
    if (existing && !options.refresh) {
      return {
        document: existing,
        tokens: enrichVisibleTokens(dbService.listPronunciationTokens(existing.id)),
        plainText: stripMarkdownToJapaneseText(record.ja_ruby_html || record.official_ja_text || ''),
      };
    }
    const { plainText, payload } = await buildTextbookExpressionProjection(expressionId, record);
    return { document: ephemeralDocument(payload), tokens: payload.tokens, plainText };
  }

  async function ensureTextbookExpression(expressionId, options = {}) {
    const record = textbookExpressionRecord(expressionId);
    const sourceContentHash = textbookExpressionSourceHash(record);
    const existing = dbService.getPronunciationDocument('textbook_expression', record.expression_id, sourceContentHash);
    if (existing && !options.force) {
      return {
        document: existing,
        tokens: enrichVisibleTokens(dbService.listPronunciationTokens(existing.id)),
        plainText: stripMarkdownToJapaneseText(record.ja_ruby_html || record.official_ja_text || ''),
      };
    }
    const { payload } = await buildTextbookExpressionProjection(expressionId, record);
    if (existing) return dbService.updatePronunciationProjection({ ...payload, documentId: existing.id, expectedRevision: existing.revision });
    return dbService.createPronunciationDocument(payload);
  }

  function correctionError(code, message, status = 422) {
    const error = new Error(message);
    error.code = code;
    error.status = status;
    return error;
  }

  function codePointSlice(value, start, end) {
    return Array.from(String(value || '')).slice(start, end).join('');
  }

  function acceptedReading(payload) {
    const readingHiragana = String(payload.readingHiragana || '').trim();
    if (!readingHiragana) {
      throw correctionError('PRONUNCIATION_READING_REQUIRED', 'readingHiragana is required for this correction');
    }
    return {
      readingRaw: String(payload.readingRaw || readingHiragana).trim(),
      readingHiragana,
    };
  }

  function manualToken(token, overrides = {}) {
    return {
      ...token,
      ...overrides,
      source: 'manual',
      ruleVersion: 'manual-v1',
      evidence: { ...(token.evidence || {}), correction: true },
    };
  }

  function buildCorrection(tokens, payload, plainText) {
    const eventType = String(payload.eventType || '');
    const supported = new Set(['reading', 'boundary', 'resolve', 'reject', 'split', 'merge']);
    if (!supported.has(eventType)) {
      throw correctionError('PRONUNCIATION_EVENT_TYPE_INVALID', 'Unsupported pronunciation correction event type', 400);
    }
    const tokenIndex = tokens.findIndex((token) => token.tokenKey === payload.tokenKey);
    if (tokenIndex < 0) {
      throw correctionError('PRONUNCIATION_TOKEN_NOT_FOUND', 'Pronunciation token not found', 404);
    }
    const token = tokens[tokenIndex];

    if (eventType === 'reading' || eventType === 'resolve') {
      const reading = acceptedReading(payload);
      const body = { tokenKey: token.tokenKey, ...reading, status: 'accepted' };
      return {
        body,
        tokens: tokens.map((item, index) => index === tokenIndex
          ? manualToken(item, { ...reading, status: 'accepted' })
          : item),
      };
    }

    if (eventType === 'reject') {
      const body = { tokenKey: token.tokenKey, status: 'rejected' };
      return {
        body,
        tokens: tokens.map((item, index) => index === tokenIndex
          ? manualToken(item, { status: 'rejected' })
          : item),
      };
    }

    if (eventType === 'boundary') {
      const startCodePoint = Number(payload.startCodePoint);
      const endCodePoint = Number(payload.endCodePoint);
      const length = Array.from(plainText).length;
      if (!Number.isInteger(startCodePoint) || !Number.isInteger(endCodePoint)
        || startCodePoint < 0 || endCodePoint <= startCodePoint || endCodePoint > length) {
        throw correctionError('PRONUNCIATION_BOUNDARY_INVALID', 'Boundary must be a valid non-empty range in the pronunciation source');
      }
      const surface = codePointSlice(plainText, startCodePoint, endCodePoint);
      if (tokens.some((item, index) => index !== tokenIndex
        && startCodePoint < item.endCodePoint && item.startCodePoint < endCodePoint)) {
        throw correctionError('PRONUNCIATION_BOUNDARY_INVALID', 'Boundary overlaps another pronunciation token');
      }
      const body = { tokenKey: token.tokenKey, startCodePoint, endCodePoint, surface };
      return {
        body,
        tokens: tokens.map((item, index) => index === tokenIndex
          ? manualToken(item, { startCodePoint, endCodePoint, surface })
          : item),
      };
    }

    if (eventType === 'split') {
      const parts = Array.isArray(payload.parts) ? payload.parts : [];
      if (parts.length < 2) {
        throw correctionError('PRONUNCIATION_SPLIT_INVALID', 'Split requires at least two parts');
      }
      const normalizedParts = parts.map((part, index) => {
        const startCodePoint = Number(part.startCodePoint);
        const endCodePoint = Number(part.endCodePoint);
        const surface = codePointSlice(plainText, startCodePoint, endCodePoint);
        if (!Number.isInteger(startCodePoint) || !Number.isInteger(endCodePoint)
          || endCodePoint <= startCodePoint || surface !== String(part.surface || surface)) {
          throw correctionError('PRONUNCIATION_SPLIT_INVALID', 'Each split part must match its source range');
        }
        return {
          tokenKey: String(part.tokenKey || `${token.tokenKey}:split:${index + 1}`),
          surface,
          startCodePoint,
          endCodePoint,
          readingRaw: String(part.readingRaw || part.readingHiragana || '').trim() || null,
          readingHiragana: String(part.readingHiragana || '').trim() || null,
        };
      });
      if (normalizedParts[0].startCodePoint !== token.startCodePoint
        || normalizedParts.at(-1).endCodePoint !== token.endCodePoint
        || normalizedParts.some((part, index) => index > 0 && normalizedParts[index - 1].endCodePoint !== part.startCodePoint)
        || new Set(normalizedParts.map((part) => part.tokenKey)).size !== normalizedParts.length) {
        throw correctionError('PRONUNCIATION_SPLIT_INVALID', 'Split parts must uniquely and contiguously cover the original token');
      }
      const existingKeys = new Set(tokens.filter((_, index) => index !== tokenIndex).map((item) => item.tokenKey));
      if (normalizedParts.some((part) => existingKeys.has(part.tokenKey))) {
        throw correctionError('PRONUNCIATION_SPLIT_INVALID', 'Split token keys must not conflict with existing tokens');
      }
      const replacements = normalizedParts.map((part) => manualToken(token, {
        ...part,
        id: undefined,
        documentId: undefined,
        status: part.readingHiragana ? 'accepted' : 'unresolved',
        unitKind: 'component',
        components: [{ tokenKey: token.tokenKey, surface: token.surface }],
      }));
      const nextTokens = [...tokens.slice(0, tokenIndex), ...replacements, ...tokens.slice(tokenIndex + 1)];
      return { body: { tokenKey: token.tokenKey, parts: normalizedParts }, tokens: nextTokens };
    }

    const tokenKeys = Array.isArray(payload.tokenKeys) ? payload.tokenKeys.map(String) : [];
    if (tokenKeys.length < 2 || !tokenKeys.includes(token.tokenKey) || new Set(tokenKeys).size !== tokenKeys.length) {
      throw correctionError('PRONUNCIATION_MERGE_INVALID', 'Merge requires at least two unique token keys including tokenKey');
    }
    const selected = tokenKeys.map((key) => tokens.find((item) => item.tokenKey === key));
    if (selected.some((item) => !item)) {
      throw correctionError('PRONUNCIATION_TOKEN_NOT_FOUND', 'A pronunciation token selected for merge was not found', 404);
    }
    selected.sort((left, right) => left.startCodePoint - right.startCodePoint);
    if (selected.some((item, index) => index > 0 && selected[index - 1].endCodePoint !== item.startCodePoint)) {
      throw correctionError('PRONUNCIATION_MERGE_INVALID', 'Merged tokens must be contiguous');
    }
    const startCodePoint = selected[0].startCodePoint;
    const endCodePoint = selected.at(-1).endCodePoint;
    const surface = codePointSlice(plainText, startCodePoint, endCodePoint);
    const readingHiragana = String(payload.readingHiragana || '').trim() || selected.map((item) => item.readingHiragana || '').join('') || null;
    const readingRaw = String(payload.readingRaw || '').trim() || selected.map((item) => item.readingRaw || '').join('') || readingHiragana;
    const merged = manualToken(token, {
      tokenKey: String(payload.mergedTokenKey || token.tokenKey),
      surface,
      startCodePoint,
      endCodePoint,
      readingRaw,
      readingHiragana,
      status: readingHiragana ? 'accepted' : 'unresolved',
      unitKind: 'word',
      components: selected.map((item) => ({ tokenKey: item.tokenKey, surface: item.surface })),
    });
    const selectedKeys = new Set(tokenKeys);
    if (tokens.some((item) => !selectedKeys.has(item.tokenKey) && item.tokenKey === merged.tokenKey)) {
      throw correctionError('PRONUNCIATION_MERGE_INVALID', 'Merged token key conflicts with an existing token');
    }
    const nextTokens = tokens.filter((item) => !selectedKeys.has(item.tokenKey));
    nextTokens.push(merged);
    return {
      body: { tokenKey: token.tokenKey, tokenKeys: selected.map((item) => item.tokenKey), mergedTokenKey: merged.tokenKey, surface, readingRaw, readingHiragana },
      tokens: nextTokens,
    };
  }

  function correctionRequestBody(payload) {
    const eventType = String(payload.eventType || '');
    const body = { eventType, tokenKey: String(payload.tokenKey || '') };
    if (payload.readingRaw !== undefined) body.readingRaw = String(payload.readingRaw || '');
    if (payload.readingHiragana !== undefined) body.readingHiragana = String(payload.readingHiragana || '');
    if (payload.status !== undefined) body.status = String(payload.status || '');
    if (payload.startCodePoint !== undefined) body.startCodePoint = Number(payload.startCodePoint);
    if (payload.endCodePoint !== undefined) body.endCodePoint = Number(payload.endCodePoint);
    if (Array.isArray(payload.parts)) body.parts = payload.parts;
    if (Array.isArray(payload.tokenKeys)) body.tokenKeys = payload.tokenKeys.map(String);
    if (payload.mergedTokenKey !== undefined) body.mergedTokenKey = String(payload.mergedTokenKey || '');
    return body;
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
    const payloadJson = JSON.stringify(correctionRequestBody(payload));
    const payloadHash = sha256(payloadJson);
    const existingEvent = dbService.getPronunciationCorrectionEvent(String(payload.eventKey || ''));
    if (existingEvent) {
      if (existingEvent.payloadHash !== payloadHash) {
        throw correctionError('PRONUNCIATION_EVENT_CONFLICT', 'Pronunciation correction event conflicts with existing event', 409);
      }
      return dbService.applyPronunciationCorrection({
        documentId: document.id,
        tokenKey: payload.tokenKey,
        eventKey: String(payload.eventKey || ''),
        eventType: payload.eventType,
        payloadJson,
        payloadHash,
        expectedRevision: payload.expectedRevision,
        documentHash: document.documentHash,
        tokens: dbService.listPronunciationTokens(document.id),
        now: now(),
      });
    }
    const record = targetKind === 'textbook_expression'
      ? dbService.getTextbookExpression(Number(payload.targetId))
      : dbService.getGenerationById(Number(payload.targetId));
    const plainText = payload.plainText || stripMarkdownToJapaneseText(
      targetKind === 'textbook_expression'
        ? record?.ja_ruby_html || record?.official_ja_text || ''
        : record?.markdown_content || ''
    );
    const tokens = dbService.listPronunciationTokens(document.id);
    const correction = buildCorrection(tokens, payload, plainText);
    return dbService.applyPronunciationCorrection({
      documentId: document.id,
      tokenKey: payload.tokenKey,
      eventKey: String(payload.eventKey || ''),
      eventType: payload.eventType || 'reading',
      payloadJson,
      payloadHash,
      expectedRevision: payload.expectedRevision,
      documentHash: documentHash(plainText, correction.tokens),
      tokens: correction.tokens,
      status: correction.tokens.some((token) => token.status === 'unresolved') ? 'partial' : 'ready',
      now: now(),
    });
  }

  return {
    ensureGeneration,
    readGeneration,
    getGeneration,
    ensureTextbookExpression,
    readTextbookExpression,
    correct,
    buildTokens: (text, options) => buildTokens(text, { dictionaryReader, ...options }),
    stripMarkdownToJapaneseText,
    locateJapaneseSegments,
    japaneseMarkupForLegacyReader,
    toHiragana,
    documentHash,
    localizeProjection: localizePronunciationProjection,
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
  localizePronunciationProjection,
};
