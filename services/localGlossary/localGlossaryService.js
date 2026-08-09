'use strict';

const crypto = require('node:crypto');
const { generateJson } = require('../llm/deepseekService');
const { parseTrilingualMarkdown } = require('../generation/markdownParser');
const { normalizeSurface, normalizeTerm } = require('./localGlossaryNormalizer');

const PROMPT_VERSION = 'local-glossary-zh-v1';
const MAX_TEXT_CODEPOINTS = 300;
const MAX_GLOSS_CODEPOINTS = 120;
const VALID_LANGUAGES = new Set(['en', 'ja']);
const VALID_CONFIDENCE = new Set(['high', 'medium', 'low']);
const VALID_SOURCE_KINDS = new Set(['manual', 'llm-confirmed', 'imported']);

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
  };
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

    for (const alias of term.aliases) {
      const normalizedAlias = language === 'en' ? alias.toLocaleLowerCase('en-US') : alias;
      const entry = this.database.findLocalGlossaryEntry(language, normalizedAlias);
      if (entry) {
        return this.buildLookup(alias === term.normalizedForm ? 'exact' : 'candidate', text, language, term, {
          id: entry.id,
          zhGloss: entry.zhGloss,
          sourceKind: entry.sourceKind,
          sourceId: entry.id,
          confidence: entry.confidence,
          version: entry.version,
        });
      }
    }

    const dictionaryForms = term.aliases.map((alias) => (
      language === 'en' ? alias.toLocaleLowerCase('en-US') : alias
    ));
    const dictionaryEntry = this.database.findLocalDictionaryEntry(language, dictionaryForms);
    if (dictionaryEntry) {
      return this.buildLookup(
        dictionaryEntry.normalizedForm === dictionaryForms[0] ? 'exact' : 'candidate',
        text,
        language,
        term,
        mapGloss({
          ...dictionaryEntry,
          sourceKind: 'dictionary',
          sourceId: dictionaryEntry.id,
          confidence: dictionaryEntry.language === 'ja' ? 'medium' : 'high',
        }),
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

  buildLookup(status, text, language, term, gloss) {
    return {
      status,
      query: { text, language, canonicalForm: term.canonicalForm, normalizedForm: term.normalizedForm },
      gloss,
      alternatives: [],
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
};
