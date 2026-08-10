'use strict';

const crypto = require('node:crypto');
const { generateJson } = require('../llm/deepseekService');
const { parseTrilingualMarkdown } = require('../generation/markdownParser');
const { normalizeSurface, normalizeTerm } = require('./localGlossaryNormalizer');

const PROMPT_VERSION = 'local-glossary-zh-v1';
const MAX_TEXT_CODEPOINTS = 300;
const MAX_CONTEXT_CODEPOINTS = 400;
const MAX_READING_CODEPOINTS = 80;
const MAX_GLOSS_CODEPOINTS = 120;
const VALID_LANGUAGES = new Set(['en', 'ja']);
const VALID_CONFIDENCE = new Set(['high', 'medium', 'low']);
const VALID_SOURCE_KINDS = new Set(['manual', 'llm-confirmed', 'imported']);
const VALID_FEEDBACK_OUTCOMES = new Set(['shown', 'rejected', 'switched', 'corrected']);
const VALID_FEEDBACK_SOURCE_KINDS = new Set([
  'current-card', 'textbook', 'manual', 'llm-confirmed', 'imported', 'history-card', 'dictionary',
]);
const VALID_FEEDBACK_SOURCE_DETAILS = new Set([
  '本卡片', '教材确认', '本地词库', '人工确认', '本地导入', '历史卡片', '本地词典',
  '精选本地词典', '中文维基词典 · 直接日中', 'JMdict · 英中桥接', 'ECDICT',
]);
const VALID_FEEDBACK_MATCH_REASONS = new Set(['reading', 'context', 'exact-form', 'normalized-form']);
const MAX_FEEDBACK_TERM_CODEPOINTS = 80;
const MAX_FEEDBACK_COUNT = 50;

function sha256(value) {
  return crypto.createHash('sha256').update(String(value || '')).digest('hex');
}

function httpError(status, code, message, details) {
  const error = new Error(message);
  error.status = status;
  error.code = code;
  if (details) error.details = details;
  return error;
}

function validateLanguage(language) {
  const value = String(language || '').trim();
  if (!VALID_LANGUAGES.has(value)) throw httpError(400, 'LOCAL_GLOSSARY_LANGUAGE_INVALID', 'language must be en or ja');
  return value;
}

function validateText(value, field = 'text', max = MAX_TEXT_CODEPOINTS) {
  const text = normalizeSurface(value);
  const length = Array.from(text).length;
  if (!text || length > max) throw httpError(400, 'LOCAL_GLOSSARY_TEXT_INVALID', `${field} must contain 1-${max} characters`);
  return text;
}

function validateDisplayText(value, field = 'text', max = MAX_GLOSS_CODEPOINTS) {
  const text = String(value || '').normalize('NFKC').replace(/\s+/gu, ' ').trim();
  const length = Array.from(text).length;
  if (!text || length > max) throw httpError(400, 'LOCAL_GLOSSARY_TEXT_INVALID', `${field} must contain 1-${max} characters`);
  return text;
}

function optionalHint(value, max) {
  const text = String(value || '').normalize('NFKC').replace(/\s+/gu, ' ').trim();
  return Array.from(text).slice(0, max).join('');
}

function boundedCount(value) {
  const count = Number(value);
  if (!Number.isFinite(count) || count < 0) return 0;
  return Math.min(Math.floor(count), MAX_FEEDBACK_COUNT);
}

function validateFeedbackSourceKind(value) {
  const sourceKind = String(value || '').trim();
  if (!VALID_FEEDBACK_SOURCE_KINDS.has(sourceKind)) {
    throw httpError(400, 'LOCAL_GLOSSARY_FEEDBACK_SOURCE_INVALID', 'sourceKind is not recognized');
  }
  return sourceKind;
}

function feedbackSourceDetail(value) {
  const sourceDetail = String(value || '').normalize('NFKC').trim();
  return VALID_FEEDBACK_SOURCE_DETAILS.has(sourceDetail) ? sourceDetail : null;
}

function feedbackSenseKey(value) {
  const senseKey = String(value || '').normalize('NFKC').trim() || 'default';
  return /^[\p{L}\p{N}._:-]{1,80}$/u.test(senseKey) ? senseKey : 'default';
}

function feedbackMatchReason(value) {
  const matchReason = String(value || '').trim();
  return VALID_FEEDBACK_MATCH_REASONS.has(matchReason) ? matchReason : null;
}

function normalizeReading(value) {
  return optionalHint(value, MAX_READING_CODEPOINTS).replace(/[ァ-ヶ]/gu, (character) => (
    String.fromCodePoint(character.codePointAt(0) - 0x60)
  ));
}

function plainText(value) {
  return String(value || '')
    .replace(/<rt[\s\S]*?<\/rt>/giu, '')
    .replace(/<rp[\s\S]*?<\/rp>/giu, '')
    .replace(/<[^>]+>/gu, '')
    .replace(/\*\*|__|`/gu, '')
    .normalize('NFKC')
    .replace(/\s+/gu, ' ')
    .trim();
}

function addGlossPair(output, language, sourceText, zhGloss, sourceKind, sourceId, confidence = 'high') {
  const source = plainText(sourceText);
  const gloss = plainText(zhGloss);
  if (!source || !gloss) return;
  output.push({ language, source, zhGloss: gloss, sourceKind, sourceId, confidence });
}

function generationGlossPairs(row) {
  const output = [];
  const parsed = parseTrilingualMarkdown(row.markdown_content || '');
  for (const language of ['en', 'ja']) {
    for (const example of parsed.sections[language].examples || []) {
      addGlossPair(output, language, example.text, example.translation, 'current-card', row.id);
    }
  }
  if (row.zh_translation) {
    addGlossPair(output, 'en', row.en_translation, row.zh_translation, 'current-card', row.id);
    addGlossPair(output, 'ja', row.ja_translation, row.zh_translation, 'current-card', row.id);
    if (row.phrase_language === 'en') addGlossPair(output, 'en', row.phrase, row.zh_translation, 'current-card', row.id);
    if (row.phrase_language === 'ja') addGlossPair(output, 'ja', row.phrase, row.zh_translation, 'current-card', row.id);
  }

  let block = {};
  const flushBlock = () => {
    if (block.zh) {
      addGlossPair(output, 'en', block.en, block.zh, 'current-card', row.id);
      addGlossPair(output, 'ja', block.ja, block.zh, 'current-card', row.id);
    }
    block = {};
  };
  for (const line of String(row.markdown_content || '').split(/\r?\n/u)) {
    if (/^###\s+/u.test(line)) flushBlock();
    const labeled = /^\s*[-*]?\s*\*\*(English|英文|日本語|日语|中文)\*\*\s*[：:]\s*(.+)$/iu.exec(line);
    if (!labeled) continue;
    const label = labeled[1].toLocaleLowerCase();
    if (label === 'english' || label === '英文') block.en = labeled[2];
    else if (label === '日本語' || label === '日语') block.ja = labeled[2];
    else block.zh = labeled[2];
  }
  flushBlock();
  return output;
}

async function findPair(pairs, language, term) {
  const exact = findExactPair(pairs, language, term.aliases[0] || term.normalizedForm);
  if (exact) return exact;
  const querySurfaces = new Set(term.aliases.map((item) => normalizeSurface(item).toLocaleLowerCase(language === 'en' ? 'en-US' : 'ja-JP')));
  for (const pair of pairs) {
    if (pair.language !== language) continue;
    const normalized = await normalizeTerm(pair.source, language);
    const candidates = normalized.aliases.map((item) => normalizeSurface(item).toLocaleLowerCase(language === 'en' ? 'en-US' : 'ja-JP'));
    if (candidates.some((item) => querySurfaces.has(item))) return pair;
  }
  return null;
}

function findExactPair(pairs, language, text) {
  const query = normalizeSurface(text).toLocaleLowerCase(language === 'en' ? 'en-US' : 'ja-JP');
  return pairs.find((pair) => (
    pair.language === language
    && normalizeSurface(pair.source).toLocaleLowerCase(language === 'en' ? 'en-US' : 'ja-JP') === query
  )) || null;
}

function mapGloss(pair) {
  return {
    id: pair.id || null,
    zhGloss: pair.zhGloss,
    sourceKind: pair.sourceKind,
    sourceId: pair.sourceId || null,
    confidence: pair.confidence,
    version: pair.version || null,
    lemma: pair.lemma || null,
    reading: pair.reading || null,
    partOfSpeech: pair.partOfSpeech || null,
    dictionaryVersion: pair.dictionaryVersion || null,
    senseKey: pair.senseKey || null,
    sourceDetail: pair.sourceDetail || null,
    matchReason: pair.matchReason || null,
  };
}

function isDictionaryBridge(entry) {
  return entry.sourceRef?.translationPath === 'jmdict-simplified-eng-to-ecdict-zh';
}

function dictionarySourceDetail(entry) {
  if (entry.sourceId === 'three-lans-curated-starter') return '精选本地词典';
  if (entry.sourceId === 'zhwiktionary-ja-direct') return '中文维基词典 · 直接日中';
  if (isDictionaryBridge(entry)) return 'JMdict · 英中桥接';
  if (entry.sourceId === 'ecdict') return 'ECDICT';
  return entry.sourceId || '本地词典';
}

// Dictionary part-of-speech strings are heterogeneous: ECDICT writes "n." /
// "vt." / "noun phrase", JMdict writes "n, vs, vt" / "adj-i", and the Chinese
// Wiktionary extraction writes traditional "名詞" / "動詞". Tokenising and
// comparing tags beats a single regex, which previously missed "adj-i" and
// every traditional-Chinese tag.
function partOfSpeechTags(partOfSpeech) {
  return String(partOfSpeech || '')
    .toLocaleLowerCase('en-US')
    .split(/[\s,/;、]+/u)
    .map((tag) => tag.replace(/\.+$/u, ''))
    .filter(Boolean);
}

function partOfSpeechMatches(partOfSpeech, hint) {
  const value = String(partOfSpeech || '');
  if (!value || !hint) return false;
  const tags = partOfSpeechTags(value);
  if (hint === 'adjective') {
    return tags.some((tag) => tag === 'adj' || tag === 'adjective' || tag.startsWith('adj-'))
      || /形容詞|形容词/u.test(value);
  }
  if (hint === 'noun') {
    return tags.some((tag) => tag === 'n' || tag === 'noun' || tag === 'pn' || tag.startsWith('n-'))
      || /名詞|名词/u.test(value);
  }
  if (hint === 'verb') {
    return tags.some((tag) => (
      ['v', 'vt', 'vi', 'vs', 'vk', 'vz', 'verb'].includes(tag) || /^v[1-5]/u.test(tag)
    )) || /動詞|动词/u.test(value);
  }
  return false;
}

const EN_SUBJECT_PRONOUNS = new Set(['i', 'we', 'you', 'they', 'he', 'she', 'it']);
const EN_VERB_CUES = new Set([
  'will', 'would', 'can', 'could', 'shall', 'should', 'may', 'might', 'must',
  'do', 'does', 'did', "don't", "doesn't", "didn't", 'let', 'lets', "let's", 'please',
  'to', 'not', 'never', 'also', 'always',
]);
const EN_MOTION_VERBS = new Set([
  'go', 'goes', 'going', 'went', 'gone', 'come', 'comes', 'came', 'walk', 'walked',
  'drive', 'drove', 'travel', 'travelled', 'traveled', 'return', 'returned', 'back', 'get', 'got',
]);
const EN_ADJECTIVE_CUES = new Set([
  'is', 'are', 'was', 'were', 'be', 'been', 'being', 'am',
  'look', 'looks', 'looked', 'seem', 'seems', 'seemed', 'feel', 'feels', 'felt',
  'become', 'becomes', 'became', 'stay', 'stays', 'remain', 'remains',
  'very', 'quite', 'really', 'so', 'too', 'more', 'most', 'less', 'rather', 'pretty',
]);
const EN_DETERMINERS = new Set([
  'a', 'an', 'the', 'this', 'that', 'these', 'those', 'my', 'your', 'his', 'her',
  'its', 'our', 'their', 'some', 'any', 'every', 'no', 'each', 'another', 'one',
]);
const EN_PREPOSITIONS = new Set([
  'in', 'on', 'at', 'of', 'for', 'with', 'from', 'by', 'about', 'into', 'during',
  'after', 'before', 'over', 'under', 'through', 'between', 'against', 'around',
  'near', 'since', 'until', 'without', 'within',
]);
const EN_AUXILIARIES = new Set([
  'am', 'are', 'be', 'been', 'being', 'can', 'could', 'did', 'do', 'does', 'had',
  'has', 'have', 'is', 'may', 'might', 'must', 'shall', 'should', 'was', 'were',
  'will', 'would',
]);
// Bounded list of frequent finite verb forms. Used only to tell "the <noun>
// <verb>" apart from attributive "the <adjective> <noun>"; anything outside the
// list simply falls back to the attributive reading.
const EN_COMMON_VERB_FORMS = new Set([
  ...EN_AUXILIARIES,
  'fell', 'fall', 'falls', 'went', 'goes', 'go', 'came', 'comes', 'come',
  'seems', 'seem', 'looks', 'look', 'costs', 'cost', 'works', 'work',
  'opens', 'open', 'closes', 'close', 'starts', 'start', 'ends', 'end',
  'arrives', 'arrive', 'happened', 'happens', 'happen', 'began', 'begins', 'begin',
  'became', 'becomes', 'become', 'gave', 'gives', 'give', 'took', 'takes', 'take',
  'made', 'makes', 'make', 'said', 'says', 'say', 'told', 'tells', 'tell',
  'stood', 'stands', 'remains', 'remained', 'stayed', 'stays', 'broke', 'breaks',
  'ran', 'runs', 'run', 'sat', 'sits', 'rose', 'rises', 'grew', 'grows',
  'changed', 'changes', 'moved', 'moves', 'stopped', 'stops',
  'continued', 'continues', 'appeared', 'appears', 'contains', 'contained',
  'includes', 'included', 'needs', 'need', 'wants', 'want',
]);

// Picks a dictionary sense, not a syntactic label: in "a spring day" the useful
// sense of "spring" is still the noun 春天, so determiners resolve to noun.
// Returns null whenever no cue is confident, because a wrong hint actively
// reorders the candidate list toward the wrong sense.
function inferEnglishPartOfSpeech(context, surface) {
  const normalizedContext = String(context || '').normalize('NFKC').toLocaleLowerCase('en-US');
  const normalizedSurface = String(surface || '').normalize('NFKC').toLocaleLowerCase('en-US');
  if (!normalizedContext || !normalizedSurface || normalizedSurface.includes(' ')) return null;
  const index = normalizedContext.indexOf(normalizedSurface);
  if (index < 0) return null;
  const before = normalizedContext.slice(0, index);
  const after = normalizedContext.slice(index + normalizedSurface.length);
  const previous = /([a-z][a-z'-]*)\W*$/u.exec(before)?.[1] || '';
  const beforePrevious = /([a-z][a-z'-]*)\W+[a-z][a-z'-]*\W*$/u.exec(before)?.[1] || '';
  const next = /^\W*([a-z][a-z'-]*)/u.exec(after)?.[1] || '';

  if (previous === 'to') {
    // "went to school" is a destination noun; "want to book" is an infinitive.
    return EN_MOTION_VERBS.has(beforePrevious) ? 'noun' : 'verb';
  }
  if (EN_VERB_CUES.has(previous)) return 'verb';
  if (EN_SUBJECT_PRONOUNS.has(previous)) return 'verb';
  if (EN_ADJECTIVE_CUES.has(previous)) return 'adjective';
  if (EN_DETERMINERS.has(previous)) {
    // "the public schedule" is attributive; "the book fell" is a subject noun.
    return next && !EN_COMMON_VERB_FORMS.has(next) ? 'adjective' : 'noun';
  }
  if (EN_PREPOSITIONS.has(previous)) return 'noun';
  if (!previous) {
    // Sentence-initial: "Book a room" is imperative, "Spring is coming" is not.
    if (EN_DETERMINERS.has(next)) return 'verb';
    if (EN_AUXILIARIES.has(next)) return 'noun';
    return null;
  }
  if (next && EN_AUXILIARIES.has(next)) return 'noun';
  return null;
}

// Japanese relies on the particle that follows the term rather than word order.
function inferJapanesePartOfSpeech(context, surface) {
  const normalizedContext = String(context || '').normalize('NFKC');
  const normalizedSurface = String(surface || '').normalize('NFKC');
  if (!normalizedContext || !normalizedSurface) return null;
  const index = normalizedContext.indexOf(normalizedSurface);
  if (index < 0) return null;
  const after = normalizedContext.slice(index + normalizedSurface.length);
  if (!after) return null;
  if (/^(?:する|して|した|します|しない|され|でき)/u.test(after)) return 'verb';
  if (/^な(?:[^\s]|$)/u.test(after)) return 'adjective';
  if (/^(?:です|だ|である|でした)/u.test(after)) return 'noun';
  if (/^[をがはもにへとでのやか]/u.test(after)) return 'noun';
  if (/^(?:から|まで|より)/u.test(after)) return 'noun';
  return null;
}

function inferContextPartOfSpeech(language, context, surface) {
  if (!context) return null;
  return language === 'en'
    ? inferEnglishPartOfSpeech(context, surface)
    : inferJapanesePartOfSpeech(context, surface);
}

function rankDictionaryEntries(entries, options) {
  const readingHint = normalizeReading(options.reading);
  const contextPartOfSpeech = inferContextPartOfSpeech(options.language, options.context, options.text);
  const formOrder = new Map(options.forms.map((form, index) => [form, index]));
  const ranked = entries.map((entry) => {
    const entryReading = normalizeReading(entry.reading);
    const readingMatched = Boolean(readingHint && entryReading && readingHint === entryReading);
    const readingMismatched = Boolean(readingHint && entryReading && readingHint !== entryReading);
    const contextMatched = Boolean(
      contextPartOfSpeech && partOfSpeechMatches(entry.partOfSpeech, contextPartOfSpeech)
    );
    const curated = entry.sourceId === 'three-lans-curated-starter';
    const directJapaneseChinese = entry.sourceId === 'zhwiktionary-ja-direct';
    const bridge = isDictionaryBridge(entry);
    const formRank = formOrder.get(entry.normalizedForm) ?? 99;
    const score = (1000 - formRank * 100)
      + (readingMatched ? 500 : 0)
      - (readingMismatched ? 180 : 0)
      + (contextMatched ? 140 : 0)
      + (curated ? 100 : 0)
      + (directJapaneseChinese ? 80 : 0)
      - (bridge ? 120 : 0);
    let confidence = curated ? 'high' : 'medium';
    // Bridge glosses are pivoted through English and stay low no matter how well
    // the context matched; a confirmed context cue lifts any direct source.
    if (bridge) confidence = 'low';
    else if (contextMatched) confidence = 'high';
    const matchReason = readingMatched
      ? 'reading'
      : contextMatched
        ? 'context'
        : formRank === 0
          ? 'exact-form'
          : 'normalized-form';
    return {
      entry,
      score,
      readingMatched,
      contextMatched,
      confidence,
      matchReason,
    };
  }).sort((left, right) => right.score - left.score || left.entry.id - right.entry.id);

  const distinct = [];
  const seen = new Set();
  for (const candidate of ranked) {
    const key = [
      normalizeReading(candidate.entry.reading),
      candidate.entry.partOfSpeech || '',
      candidate.entry.zhGloss,
    ].join('\u0000');
    if (seen.has(key)) continue;
    seen.add(key);
    distinct.push(candidate);
  }
  const ambiguous = distinct.length > 1;
  return distinct.map((candidate) => {
    let confidence = candidate.confidence;
    if (
      confidence === 'high'
      && ambiguous
      && !candidate.readingMatched
      && !candidate.contextMatched
    ) confidence = 'medium';
    return mapGloss({
      ...candidate.entry,
      sourceKind: 'dictionary',
      sourceId: candidate.entry.id,
      sourceDetail: dictionarySourceDetail(candidate.entry),
      confidence,
      matchReason: candidate.matchReason,
    });
  });
}

function selectDictionaryAlternatives(primary, ranked, limit = 4) {
  const alternatives = ranked.slice(1);
  if (!primary || alternatives.length <= limit) return alternatives.slice(0, limit);

  const selected = [];
  const selectedKeys = new Set();
  const primaryReading = normalizeReading(primary.reading);
  const add = (candidate) => {
    if (!candidate || selected.length >= limit) return;
    const key = [candidate.id || '', candidate.senseKey || '', candidate.zhGloss].join('\u0000');
    if (selectedKeys.has(key)) return;
    selectedKeys.add(key);
    selected.push(candidate);
  };

  // Preserve at least one alternative pronunciation before same-reading senses fill the menu.
  add(alternatives.find((candidate) => (
    normalizeReading(candidate.reading) !== primaryReading
  )));
  alternatives.forEach(add);
  return selected;
}

class LocalGlossaryService {
  constructor({ database, llm = { generateJson }, now = () => new Date().toISOString(), llmEnabled } = {}) {
    this.database = database;
    this.llm = llm;
    this.now = now;
    this.llmEnabled = llmEnabled ?? process.env.LOCAL_GLOSSARY_LLM_ENABLED === '1';
  }

  async lookup(payload = {}) {
    const language = validateLanguage(payload.language);
    const text = validateText(payload.text);
    const term = await normalizeTerm(text, language);
    const generationId = Number(payload.generationId) || null;
    const reading = normalizeReading(payload.reading);
    const context = optionalHint(payload.context, MAX_CONTEXT_CODEPOINTS);

    if (generationId) {
      const generation = this.database.getGenerationById(generationId);
      if (generation) {
        const pair = await findPair(generationGlossPairs(generation), language, term);
        if (pair) return this.buildLookup('exact', text, language, term, mapGloss(pair));
      }
    }

    const textbookRows = this.database.db.prepare(`
      SELECT er.id, er.official_en_text, er.official_ja_text, er.zh_cue_text
      FROM textbook_expression_revisions er
      JOIN textbook_track_revisions rev ON rev.id = er.revision_id
      JOIN textbook_tracks track ON track.id = rev.track_id
      WHERE rev.id = COALESCE(track.pending_revision_id, track.current_revision_id)
      ORDER BY er.id DESC
    `).all();
    const textbookPairs = textbookRows.flatMap((row) => [
      { language: 'en', source: row.official_en_text, zhGloss: row.zh_cue_text, sourceKind: 'textbook', sourceId: row.id, confidence: 'high' },
      { language: 'ja', source: row.official_ja_text, zhGloss: row.zh_cue_text, sourceKind: 'textbook', sourceId: row.id, confidence: 'high' },
    ]);
    const textbook = await findPair(textbookPairs, language, term);
    if (textbook) return this.buildLookup('exact', text, language, term, mapGloss(textbook));

    const manualSenseKeys = reading ? [`reading:${reading}`, 'default'] : ['default'];
    for (const alias of term.aliases) {
      const normalizedAlias = language === 'en' ? alias.toLocaleLowerCase('en-US') : alias;
      for (const senseKey of manualSenseKeys) {
        const entry = this.database.findLocalGlossaryEntry(language, normalizedAlias, senseKey);
        if (entry) {
          return this.buildLookup(alias === term.normalizedForm ? 'exact' : 'candidate', text, language, term, {
            id: entry.id,
            zhGloss: entry.zhGloss,
            sourceKind: entry.sourceKind,
            sourceId: entry.id,
            confidence: entry.confidence,
            version: entry.version,
            senseKey: entry.senseKey,
          });
        }
      }
    }

    const dictionaryForms = term.aliases.map((alias) => (
      language === 'en' ? alias.toLocaleLowerCase('en-US') : alias
    ));
    const dictionaryEntries = this.database.findLocalDictionaryEntries(language, dictionaryForms);
    const rankedDictionaryGlosses = rankDictionaryEntries(dictionaryEntries, {
      language,
      text,
      forms: dictionaryForms,
      reading,
      context,
    });
    if (rankedDictionaryGlosses.length) {
      const [dictionaryGloss] = rankedDictionaryGlosses;
      const alternatives = selectDictionaryAlternatives(dictionaryGloss, rankedDictionaryGlosses);
      return this.buildLookup(
        alternatives.length || dictionaryGloss.matchReason === 'normalized-form' ? 'candidate' : 'exact',
        text,
        language,
        term,
        dictionaryGloss,
        alternatives,
      );
    }

    const generations = this.database.db.prepare(`
      SELECT id, phrase, phrase_language, markdown_content, en_translation, ja_translation, zh_translation
      FROM generations
      WHERE card_type <> 'textbook_track' AND id <> COALESCE(?, -1)
      ORDER BY id DESC
      LIMIT 200
    `).all(generationId);
    for (const generation of generations) {
      const pair = findExactPair(generationGlossPairs(generation), language, text);
      if (pair) {
        return this.buildLookup('candidate', text, language, term, mapGloss({ ...pair, sourceKind: 'history-card', confidence: 'medium' }));
      }
    }

    return this.buildLookup('missing', text, language, term, null);
  }

  buildLookup(status, text, language, term, gloss, alternatives = []) {
    return {
      status,
      query: { text, language, canonicalForm: term.canonicalForm, normalizedForm: term.normalizedForm },
      gloss,
      alternatives,
    };
  }

  async listEntries(options = {}) {
    const language = options.language ? validateLanguage(options.language) : undefined;
    return this.database.listLocalGlossaryEntries({
      language,
      query: normalizeSurface(options.query),
      includeArchived: options.includeArchived === true,
      limit: options.limit,
    });
  }

  catalog() {
    return {
      manual: this.database.getLocalGlossaryEntryStats(),
      dictionaries: this.database.listLocalDictionarySourceStats(),
    };
  }

  // DIC-R2. Deliberately separate from lookup(): lookup stays read-only, and
  // only this explicit client submission writes a usage fact. The selected
  // short term is stored for the problem-term list; surrounding context is not
  // accepted, and all descriptive fields are allowlisted instead of copied.
  async recordFeedback(payload = {}) {
    const language = validateLanguage(payload.language);
    const text = validateText(payload.text, 'text', MAX_FEEDBACK_TERM_CODEPOINTS);
    const outcome = String(payload.outcome || '').trim();
    if (!VALID_FEEDBACK_OUTCOMES.has(outcome)) {
      throw httpError(400, 'LOCAL_GLOSSARY_OUTCOME_INVALID', 'outcome must be shown, rejected, switched or corrected');
    }
    const term = await normalizeTerm(text, language);
    const normalizedForm = language === 'en'
      ? term.normalizedForm.toLocaleLowerCase('en-US')
      : term.normalizedForm;
    const event = this.database.recordLocalGlossaryLookupEvent({
      language,
      normalizedForm,
      senseKey: feedbackSenseKey(payload.senseKey),
      outcome,
      sourceKind: validateFeedbackSourceKind(payload.sourceKind),
      sourceDetail: feedbackSourceDetail(payload.sourceDetail),
      confidence: VALID_CONFIDENCE.has(payload.confidence) ? payload.confidence : 'medium',
      matchReason: feedbackMatchReason(payload.matchReason),
      candidateCount: boundedCount(payload.candidateCount),
      chosenRank: boundedCount(payload.chosenRank),
      createdAtUtc: this.now(),
    });
    return { event };
  }

  feedbackStats(options = {}) {
    const language = options.language ? validateLanguage(options.language) : undefined;
    return {
      outcomes: this.database.getLocalGlossaryOutcomeStats({ language, since: options.since }),
      problemTerms: this.database.listLocalGlossaryProblemTerms({ language, limit: options.limit }),
    };
  }

  async createEntry(payload = {}) {
    const language = validateLanguage(payload.language);
    const canonicalForm = validateText(payload.canonicalForm || payload.text, 'canonicalForm');
    const zhGloss = validateDisplayText(payload.zhGloss, 'zhGloss');
    const term = await normalizeTerm(canonicalForm, language);
    const normalizedForm = language === 'en' ? term.normalizedForm.toLocaleLowerCase('en-US') : term.normalizedForm;
    const senseKey = validateText(payload.senseKey || 'default', 'senseKey', 80);
    const sourceKind = VALID_SOURCE_KINDS.has(payload.sourceKind) ? payload.sourceKind : 'manual';
    const confidence = VALID_CONFIDENCE.has(payload.confidence) ? payload.confidence : 'high';
    const existing = this.database.findLocalGlossaryEntry(language, normalizedForm, senseKey);
    if (existing) throw httpError(409, 'LOCAL_GLOSSARY_ENTRY_CONFLICT', 'An active glossary entry already exists', { entry: existing });
    try {
      return this.database.createLocalGlossaryEntry({
        language,
        canonicalForm: term.canonicalForm,
        normalizedForm,
        senseKey,
        zhGloss,
        sourceKind,
        sourceRefJson: JSON.stringify(payload.sourceRef || {}),
        confidence,
        createdAtUtc: this.now(),
      });
    } catch (error) {
      if (String(error.message).includes('UNIQUE constraint failed')) throw httpError(409, 'LOCAL_GLOSSARY_ENTRY_CONFLICT', 'An active glossary entry already exists');
      throw error;
    }
  }

  async updateEntry(id, payload = {}) {
    const current = this.database.getLocalGlossaryEntry(Number(id));
    if (!current) throw httpError(404, 'LOCAL_GLOSSARY_ENTRY_NOT_FOUND', 'Glossary entry not found');
    const expectedVersion = Number(payload.expectedVersion);
    if (expectedVersion !== current.version) throw httpError(409, 'LOCAL_GLOSSARY_VERSION_CONFLICT', 'Glossary entry has changed');
    const canonicalForm = validateText(payload.canonicalForm || current.canonicalForm, 'canonicalForm');
    const zhGloss = validateDisplayText(payload.zhGloss || current.zhGloss, 'zhGloss');
    const term = await normalizeTerm(canonicalForm, current.language);
    const normalizedForm = current.language === 'en' ? term.normalizedForm.toLocaleLowerCase('en-US') : term.normalizedForm;
    const updated = this.database.updateLocalGlossaryEntry(current.id, expectedVersion, {
      canonicalForm: term.canonicalForm,
      normalizedForm,
      senseKey: validateText(payload.senseKey || current.senseKey, 'senseKey', 80),
      zhGloss,
      sourceRefJson: JSON.stringify(payload.sourceRef || current.sourceRef || {}),
      confidence: VALID_CONFIDENCE.has(payload.confidence) ? payload.confidence : current.confidence,
      updatedAtUtc: this.now(),
    });
    if (!updated) throw httpError(409, 'LOCAL_GLOSSARY_VERSION_CONFLICT', 'Glossary entry has changed');
    return updated;
  }

  archiveEntry(id, payload = {}) {
    const current = this.database.getLocalGlossaryEntry(Number(id));
    if (!current) throw httpError(404, 'LOCAL_GLOSSARY_ENTRY_NOT_FOUND', 'Glossary entry not found');
    const expectedVersion = Number(payload.expectedVersion);
    if (expectedVersion !== current.version) throw httpError(409, 'LOCAL_GLOSSARY_VERSION_CONFLICT', 'Glossary entry has changed');
    const archived = this.database.archiveLocalGlossaryEntry(current.id, expectedVersion, this.now());
    if (!archived) throw httpError(409, 'LOCAL_GLOSSARY_VERSION_CONFLICT', 'Glossary entry has changed');
    return archived;
  }

  restoreEntry(id, payload = {}) {
    const current = this.database.getLocalGlossaryEntry(Number(id));
    if (!current) throw httpError(404, 'LOCAL_GLOSSARY_ENTRY_NOT_FOUND', 'Glossary entry not found');
    const expectedVersion = Number(payload.expectedVersion);
    if (expectedVersion !== current.version) throw httpError(409, 'LOCAL_GLOSSARY_VERSION_CONFLICT', 'Glossary entry has changed');
    if (current.status !== 'archived') return current;
    try {
      const restored = this.database.restoreLocalGlossaryEntry(current.id, expectedVersion, this.now());
      if (!restored) throw httpError(409, 'LOCAL_GLOSSARY_VERSION_CONFLICT', 'Glossary entry has changed');
      return restored;
    } catch (error) {
      if (String(error.message).includes('UNIQUE constraint failed')) {
        throw httpError(409, 'LOCAL_GLOSSARY_ENTRY_CONFLICT', 'An active glossary entry already exists');
      }
      throw error;
    }
  }

  async propose(payload = {}) {
    if (!this.llmEnabled) throw httpError(404, 'LOCAL_GLOSSARY_LLM_DISABLED', 'Local glossary LLM proposals are disabled');
    const language = validateLanguage(payload.language);
    const surface = validateText(payload.text);
    const requestKey = validateText(payload.requestKey, 'requestKey', 160);
    if (Array.from(requestKey).length < 8) throw httpError(400, 'LOCAL_GLOSSARY_REQUEST_KEY_INVALID', 'requestKey is too short');
    const term = await normalizeTerm(surface, language);
    const contextLabel = normalizeSurface(payload.contextLabel).slice(0, 200);
    const contextHash = sha256(contextLabel);
    const proposalKey = sha256(`${requestKey}|${language}|${term.normalizedForm}|${contextHash}|${PROMPT_VERSION}`);
    const existing = this.database.findLocalGlossaryProposalByKey(proposalKey);
    if (existing) return { proposal: existing, idempotent: true };

    const prompt = [
      '你是英日双语学习工具中的简明中文释义助手。',
      `目标语言：${language === 'en' ? '英语' : '日语'}`,
      `待解释文本：${surface}`,
      contextLabel ? `仅供消歧的页面标题：${contextLabel}` : '',
      '只输出 JSON 对象：{"zhGloss":"简洁中文释义","explanation":"最多一句消歧说明"}。',
      'zhGloss 必须是简洁自然的中文，不要复述外语原文，不要添加 Markdown。',
    ].filter(Boolean).join('\n');
    const response = await this.llm.generateJson(prompt, { thinking: 'disabled' });
    let parsed;
    try {
      parsed = JSON.parse(response.text);
    } catch (_error) {
      throw httpError(502, 'LOCAL_GLOSSARY_LLM_INVALID_RESPONSE', 'DeepSeek returned invalid glossary JSON');
    }
    const zhGloss = validateDisplayText(parsed.zhGloss, 'zhGloss');
    if (!/\p{Script=Han}/u.test(zhGloss)) throw httpError(502, 'LOCAL_GLOSSARY_LLM_INVALID_RESPONSE', 'DeepSeek candidate must contain Chinese');
    const explanation = normalizeSurface(parsed.explanation).slice(0, 200);
    const proposal = this.database.createLocalGlossaryProposal({
      proposalKey,
      language,
      surface,
      normalizedForm: language === 'en' ? term.normalizedForm.toLocaleLowerCase('en-US') : term.normalizedForm,
      contextHash,
      zhGloss,
      explanation,
      model: response.model,
      promptVersion: PROMPT_VERSION,
      responseHash: sha256(response.rawOutput),
      usageJson: JSON.stringify(response.usage || {}),
      createdAtUtc: this.now(),
    });
    return { proposal, idempotent: false };
  }

  async acceptProposal(id, payload = {}) {
    const proposal = this.database.getLocalGlossaryProposal(Number(id));
    if (!proposal) throw httpError(404, 'LOCAL_GLOSSARY_PROPOSAL_NOT_FOUND', 'Glossary proposal not found');
    if (proposal.status === 'accepted') return { proposal, entry: this.database.getLocalGlossaryEntry(proposal.acceptedEntryId), idempotent: true };
    if (proposal.status !== 'pending') throw httpError(409, 'LOCAL_GLOSSARY_PROPOSAL_DECIDED', 'Glossary proposal was already rejected');
    const zhGloss = validateDisplayText(payload.zhGloss || proposal.zhGloss, 'zhGloss');
    let entry = this.database.findLocalGlossaryEntry(proposal.language, proposal.normalizedForm);
    if (!entry) {
      entry = await this.createEntry({
        language: proposal.language,
        canonicalForm: proposal.surface,
        zhGloss,
        sourceKind: 'llm-confirmed',
        confidence: 'medium',
        sourceRef: { proposalId: proposal.id, model: proposal.model, promptVersion: proposal.promptVersion },
      });
    }
    const decided = this.database.decideLocalGlossaryProposal(proposal.id, 'accepted', entry.id, this.now());
    if (!decided) throw httpError(409, 'LOCAL_GLOSSARY_PROPOSAL_DECIDED', 'Glossary proposal has changed');
    return { proposal: decided, entry, idempotent: false };
  }

  rejectProposal(id) {
    const proposal = this.database.getLocalGlossaryProposal(Number(id));
    if (!proposal) throw httpError(404, 'LOCAL_GLOSSARY_PROPOSAL_NOT_FOUND', 'Glossary proposal not found');
    if (proposal.status === 'rejected') return { proposal, idempotent: true };
    if (proposal.status !== 'pending') throw httpError(409, 'LOCAL_GLOSSARY_PROPOSAL_DECIDED', 'Glossary proposal was already accepted');
    const decided = this.database.decideLocalGlossaryProposal(proposal.id, 'rejected', null, this.now());
    if (!decided) throw httpError(409, 'LOCAL_GLOSSARY_PROPOSAL_DECIDED', 'Glossary proposal has changed');
    return { proposal: decided, idempotent: false };
  }
}

module.exports = {
  LocalGlossaryService,
  PROMPT_VERSION,
  generationGlossPairs,
  httpError,
  inferContextPartOfSpeech,
  inferEnglishPartOfSpeech,
  inferJapanesePartOfSpeech,
  partOfSpeechMatches,
  rankDictionaryEntries,
};
