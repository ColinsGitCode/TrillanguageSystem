const fs = require('fs');
const path = require('path');
const { runGeminiProxy } = require('./geminiProxyService');
const { parseTrilingualMarkdown } = require('./markdownParser');
const { TokenCounter } = require('./observabilityService');

const TRAINING_SCHEMA_VERSION = 'training_pack_v1';
const TRAINING_PROMPT_VERSION = 'training_pack_prompt_v1';
const TRAINING_REPAIR_PROMPT_VERSION = 'training_pack_repair_prompt_v1';
const TRAINING_MODEL_DEFAULT = process.env.TRAINING_TEACHER_MODEL || process.env.GEMINI_PROXY_MODEL || 'gemini-3-pro-preview';

const PROMPT_TEMPLATE_PATH = path.join(__dirname, '..', 'prompts', 'card_training_pack_v1.md');
const REPAIR_TEMPLATE_PATH = path.join(__dirname, '..', 'prompts', 'card_training_pack_repair_v1.md');

const EN_STOPWORDS = new Set([
  'a', 'an', 'the', 'this', 'that', 'these', 'those',
  'i', 'you', 'he', 'she', 'it', 'we', 'they',
  'is', 'am', 'are', 'was', 'were', 'be', 'been', 'being',
  'do', 'does', 'did', 'done', 'have', 'has', 'had',
  'and', 'or', 'but', 'if', 'then', 'so', 'as',
  'at', 'by', 'for', 'from', 'in', 'of', 'on', 'to', 'with', 'without',
  'my', 'your', 'his', 'her', 'its', 'our', 'their',
  'me', 'him', 'them', 'us',
  'not', 'no', 'yes', 'very', 'just', 'only', 'also', 'too'
]);

function readTemplate(filePath, fallback = '') {
  try {
    return fs.readFileSync(filePath, 'utf-8');
  } catch (err) {
    return fallback;
  }
}

function normalizeCardType(cardType) {
  return String(cardType || 'trilingual').trim().toLowerCase() === 'grammar_ja'
    ? 'grammar_ja'
    : 'trilingual';
}

function toNumberOr(value, fallback) {
  const num = Number(value);
  return Number.isFinite(num) ? num : fallback;
}

function parseBoolean(value, fallback) {
  if (value === undefined || value === null || value === '') return fallback;
  const normalized = String(value).trim().toLowerCase();
  if (['true', '1', 'yes'].includes(normalized)) return true;
  if (['false', '0', 'no'].includes(normalized)) return false;
  return fallback;
}

function buildRuntimeOptions(input = {}) {
  const runtimeMode = String(input.runtimeMode || 'default').trim().toLowerCase();
  const isBackfill = runtimeMode === 'backfill';
  const requestTimeoutDefault = isBackfill ? 45000 : 120000;
  const repairTimeoutDefault = isBackfill ? 25000 : requestTimeoutDefault;
  const executionTimeoutDefault = isBackfill ? 35000 : 0;
  const repairExecutionTimeoutDefault = isBackfill ? 18000 : executionTimeoutDefault;
  const retriesDefault = isBackfill ? 1 : 1;
  const repairRetriesDefault = isBackfill ? 0 : 1;
  const retryDelayDefault = isBackfill ? 600 : 1200;
  const breakerRetryDelayDefault = isBackfill ? 8000 : 6000;
  const disableRepairOnTimeoutDefault = isBackfill;

  return {
    runtimeMode,
    requestTimeoutMs: toNumberOr(
      input.requestTimeoutMs ?? (isBackfill ? process.env.TRAINING_BACKFILL_PROXY_TIMEOUT_MS : process.env.TRAINING_PROXY_TIMEOUT_MS),
      requestTimeoutDefault
    ),
    repairTimeoutMs: toNumberOr(
      input.repairTimeoutMs ?? (isBackfill ? process.env.TRAINING_BACKFILL_REPAIR_TIMEOUT_MS : process.env.TRAINING_REPAIR_TIMEOUT_MS),
      repairTimeoutDefault
    ),
    executionTimeoutMs: toNumberOr(
      input.executionTimeoutMs ?? (isBackfill ? process.env.TRAINING_BACKFILL_EXECUTION_TIMEOUT_MS : process.env.TRAINING_PROXY_EXECUTION_TIMEOUT_MS),
      executionTimeoutDefault
    ),
    repairExecutionTimeoutMs: toNumberOr(
      input.repairExecutionTimeoutMs ?? (isBackfill ? process.env.TRAINING_BACKFILL_REPAIR_EXECUTION_TIMEOUT_MS : process.env.TRAINING_REPAIR_EXECUTION_TIMEOUT_MS),
      repairExecutionTimeoutDefault
    ),
    retries: toNumberOr(
      input.retries ?? (isBackfill ? process.env.TRAINING_BACKFILL_PROXY_RETRIES : process.env.TRAINING_PROXY_RETRIES),
      retriesDefault
    ),
    repairRetries: toNumberOr(
      input.repairRetries ?? (isBackfill ? process.env.TRAINING_BACKFILL_REPAIR_RETRIES : process.env.TRAINING_REPAIR_RETRIES),
      repairRetriesDefault
    ),
    retryDelayMs: toNumberOr(
      input.retryDelayMs ?? (isBackfill ? process.env.TRAINING_BACKFILL_RETRY_DELAY_MS : process.env.TRAINING_PROXY_RETRY_DELAY_MS),
      retryDelayDefault
    ),
    breakerRetryDelayMs: toNumberOr(
      input.breakerRetryDelayMs ?? (isBackfill ? process.env.TRAINING_BACKFILL_BREAKER_RETRY_DELAY_MS : process.env.TRAINING_BREAKER_RETRY_DELAY_MS),
      breakerRetryDelayDefault
    ),
    resetOnTimeout: parseBoolean(input.resetOnTimeout ?? process.env.TRAINING_PROXY_RESET_ON_TIMEOUT, true),
    retryOnTimeout: parseBoolean(
      input.retryOnTimeout ?? (isBackfill ? process.env.TRAINING_BACKFILL_RETRY_ON_TIMEOUT : process.env.TRAINING_PROXY_RETRY_ON_TIMEOUT),
      !isBackfill
    ),
    retryOnBreakerOpen: parseBoolean(
      input.retryOnBreakerOpen ?? (isBackfill ? process.env.TRAINING_BACKFILL_RETRY_ON_BREAKER_OPEN : process.env.TRAINING_RETRY_ON_BREAKER_OPEN),
      true
    ),
    disableRepairOnTimeout: parseBoolean(
      input.disableRepairOnTimeout ?? (isBackfill ? process.env.TRAINING_BACKFILL_DISABLE_REPAIR_ON_TIMEOUT : process.env.TRAINING_DISABLE_REPAIR_ON_TIMEOUT),
      disableRepairOnTimeoutDefault
    )
  };
}

function isTimeoutLikeError(message) {
  return /timeout|timed out|aborterror|etimedout|gemini cli timeout/i.test(String(message || ''));
}

function templateReplace(template, vars = {}) {
  return String(template || '').replace(/\{\{\s*(\w+)\s*\}\}/g, (_, key) => String(vars[key] || ''));
}

function stripMarkdownFence(text) {
  let raw = String(text || '').trim();
  if (!raw) return '';
  if (raw.startsWith('```')) {
    raw = raw.replace(/^```(?:json)?\s*/i, '').replace(/```$/i, '').trim();
  }
  return raw;
}

function extractJsonLikeText(rawText) {
  const clean = stripMarkdownFence(rawText);
  const first = clean.indexOf('{');
  const last = clean.lastIndexOf('}');
  if (first >= 0 && last > first) {
    return clean.slice(first, last + 1);
  }
  return clean;
}

function parseJsonFromText(rawText) {
  const jsonText = extractJsonLikeText(rawText);
  if (!jsonText) {
    throw new Error('empty output');
  }
  return JSON.parse(jsonText);
}

function clampDifficulty(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return 3;
  return Math.max(1, Math.min(5, Math.round(n)));
}

function toStr(value, fallback = '') {
  const text = String(value == null ? '' : value).trim();
  return text || fallback;
}

function normalizeStringArray(value, maxLen = 6) {
  const arr = Array.isArray(value) ? value : [];
  const seen = new Set();
  const out = [];
  arr.forEach((item) => {
    const text = toStr(item);
    if (!text) return;
    const key = text.toLowerCase();
    if (seen.has(key)) return;
    seen.add(key);
    out.push(text);
  });
  return out.slice(0, maxLen);
}

function isLikelyJapanese(text) {
  return /[\u3040-\u30FF\u3400-\u9FFF々〆ヵヶ]/.test(String(text || ''));
}

function sanitizeQuestionText(text) {
  return toStr(text).replace(/\s+/g, ' ').trim();
}

function escapeRegex(text) {
  return String(text || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function ensureChoiceContainsAnswer(quiz) {
  if (quiz.type !== 'choice') return quiz;
  const choices = normalizeStringArray(quiz.choices, 8);
  const answer = toStr(quiz.answer);
  if (!answer) return { ...quiz, choices };
  const has = choices.some((item) => item.toLowerCase() === answer.toLowerCase());
  if (!has) choices.push(answer);
  return { ...quiz, choices: choices.slice(0, 8) };
}

function uniqByKey(items, keyGetter) {
  const map = new Map();
  items.forEach((item) => {
    const key = String(keyGetter(item) || '').trim().toLowerCase();
    if (!key) return;
    if (!map.has(key)) map.set(key, item);
  });
  return Array.from(map.values());
}

function normalizeEnCollocations(items = []) {
  const normalized = (Array.isArray(items) ? items : []).map((item, idx) => ({
    id: toStr(item.id, `en-${idx + 1}`),
    pattern: toStr(item.pattern),
    meaningZh: toStr(item.meaningZh),
    usageZh: toStr(item.usageZh),
    exampleEn: toStr(item.exampleEn),
    exampleZh: toStr(item.exampleZh),
    distractors: normalizeStringArray(item.distractors, 6),
    difficulty: clampDifficulty(item.difficulty)
  }));
  return uniqByKey(normalized, (item) => item.pattern);
}

function normalizeJaChunks(items = []) {
  const normalized = (Array.isArray(items) ? items : []).map((item, idx) => ({
    id: toStr(item.id, `ja-${idx + 1}`),
    chunk: toStr(item.chunk),
    reading: toStr(item.reading),
    meaningZh: toStr(item.meaningZh),
    usageZh: toStr(item.usageZh),
    exampleJa: toStr(item.exampleJa),
    exampleZh: toStr(item.exampleZh),
    grammarLabel: toStr(item.grammarLabel),
    distractors: normalizeStringArray(item.distractors, 6),
    difficulty: clampDifficulty(item.difficulty)
  }));
  return uniqByKey(normalized, (item) => item.chunk);
}

function normalizeQuizzes(items = []) {
  const normalized = (Array.isArray(items) ? items : []).map((item, idx) => {
    const lang = toStr(item.lang, 'en').toLowerCase() === 'ja' ? 'ja' : 'en';
    const type = toStr(item.type, 'cloze').toLowerCase() === 'choice' ? 'choice' : 'cloze';
    const quiz = {
      id: toStr(item.id, `q-${idx + 1}`),
      lang,
      type,
      question: sanitizeQuestionText(item.question),
      answer: toStr(item.answer),
      choices: normalizeStringArray(item.choices, 8),
      explanationZh: toStr(item.explanationZh),
      relatedUnitIds: normalizeStringArray(item.relatedUnitIds, 6)
    };
    return ensureChoiceContainsAnswer(quiz);
  });
  return uniqByKey(normalized, (item) => item.id);
}

function buildCoverageScore(enCount, jaCount, quizCount) {
  const en = Math.min(1, enCount / 4);
  const ja = Math.min(1, jaCount / 4);
  const quiz = Math.min(1, quizCount / 4);
  return Number((en * 0.35 + ja * 0.35 + quiz * 0.3).toFixed(4));
}

function buildQualityScore(coverageScore, selfConfidence = 0) {
  const conf = Math.max(0, Math.min(1, Number(selfConfidence) || 0));
  const score = (coverageScore * 0.7 + conf * 0.3) * 100;
  return Number(score.toFixed(2));
}

function validateTrainingPack(payload, options = {}) {
  const strictMin = options.strictMin !== false;
  const errors = [];
  const phrase = toStr(options.phrase || payload?.phrase);
  const cardType = normalizeCardType(options.cardType || payload?.cardType || 'trilingual');
  const schemaVersion = toStr(payload?.schemaVersion || TRAINING_SCHEMA_VERSION, TRAINING_SCHEMA_VERSION);

  const enCollocations = normalizeEnCollocations(payload?.enCollocations || []);
  const jaChunks = normalizeJaChunks(payload?.jaChunks || []);
  const quizzes = normalizeQuizzes(payload?.quizzes || []);

  if (schemaVersion !== TRAINING_SCHEMA_VERSION) {
    errors.push(`schemaVersion must be ${TRAINING_SCHEMA_VERSION}`);
  }
  if (!phrase) errors.push('phrase is required');
  if (strictMin && enCollocations.length < 4) errors.push('enCollocations must be >= 4');
  if (strictMin && jaChunks.length < 4) errors.push('jaChunks must be >= 4');
  if (strictMin && quizzes.length < 4) errors.push('quizzes must be >= 4');

  enCollocations.forEach((item, idx) => {
    if (!item.pattern) errors.push(`enCollocations[${idx}].pattern is required`);
    if (!item.meaningZh) errors.push(`enCollocations[${idx}].meaningZh is required`);
    if (!item.exampleEn) errors.push(`enCollocations[${idx}].exampleEn is required`);
    if (!item.exampleZh) errors.push(`enCollocations[${idx}].exampleZh is required`);
  });

  jaChunks.forEach((item, idx) => {
    if (!item.chunk) errors.push(`jaChunks[${idx}].chunk is required`);
    if (!item.meaningZh) errors.push(`jaChunks[${idx}].meaningZh is required`);
    if (!item.exampleJa) errors.push(`jaChunks[${idx}].exampleJa is required`);
    if (!item.exampleZh) errors.push(`jaChunks[${idx}].exampleZh is required`);
  });

  const unitIds = new Set([
    ...enCollocations.map((item) => item.id),
    ...jaChunks.map((item) => item.id)
  ]);

  quizzes.forEach((quiz, idx) => {
    if (!quiz.question) errors.push(`quizzes[${idx}].question is required`);
    if (!quiz.answer) errors.push(`quizzes[${idx}].answer is required`);
    if (!quiz.explanationZh) errors.push(`quizzes[${idx}].explanationZh is required`);

    if (quiz.type === 'choice' && quiz.choices.length < 2) {
      errors.push(`quizzes[${idx}].choices must be >= 2 for choice type`);
    }

    const answerInQuestion = quiz.question.toLowerCase().includes(quiz.answer.toLowerCase());
    const answerInChoices = quiz.choices.some((item) => item.toLowerCase() === quiz.answer.toLowerCase());
    if (!answerInQuestion && !answerInChoices) {
      errors.push(`quizzes[${idx}] answer cannot be validated by question/choices`);
    }

    quiz.relatedUnitIds.forEach((id) => {
      if (!unitIds.has(id)) {
        errors.push(`quizzes[${idx}] relatedUnitId not found: ${id}`);
      }
    });
  });

  const quality = payload?.quality && typeof payload.quality === 'object'
    ? payload.quality
    : {};
  const selfConfidence = Math.max(0, Math.min(1, Number(quality.selfConfidence) || 0));
  const coverageScore = Math.max(0, Math.min(1, Number(quality.coverageScore) || 0));

  const normalizedPayload = {
    schemaVersion: TRAINING_SCHEMA_VERSION,
    phrase,
    cardType,
    enCollocations,
    jaChunks,
    quizzes,
    quality: {
      selfConfidence,
      coverageScore,
      notes: toStr(quality.notes)
    }
  };

  const computedCoverage = buildCoverageScore(
    enCollocations.length,
    jaChunks.length,
    quizzes.length
  );
  if (!normalizedPayload.quality.coverageScore) {
    normalizedPayload.quality.coverageScore = computedCoverage;
  }

  const qualityScore = buildQualityScore(
    normalizedPayload.quality.coverageScore,
    normalizedPayload.quality.selfConfidence
  );

  return {
    ok: errors.length === 0,
    errors,
    payload: normalizedPayload,
    qualityScore,
    coverageScore: normalizedPayload.quality.coverageScore,
    selfConfidence: normalizedPayload.quality.selfConfidence
  };
}

function parseGrammarExamples(markdown) {
  const lines = String(markdown || '').split(/\r?\n/);
  const examples = [];
  let inJaSection = false;
  let current = null;

  lines.forEach((line) => {
    const heading = line.match(/^##\s*\d+\.\s*(.+?)\s*:?\s*$/);
    if (heading) {
      inJaSection = /日本語|日语/i.test(heading[1]);
      current = null;
      return;
    }
    const ex = line.match(/^\s*-\s*\*\*例句\d+\*\*:\s*(.+)$/);
    if (ex && (inJaSection || !examples.length)) {
      current = { text: toStr(ex[1]), translation: '' };
      examples.push(current);
      return;
    }
    if (!current) return;
    const bullet = line.match(/^\s*-\s+(.+)$/);
    if (bullet && !/^外来语标注[:：]/i.test(bullet[1])) {
      if (!current.translation) current.translation = toStr(bullet[1]);
    }
  });

  return examples;
}

function stripJapaneseReading(text) {
  return String(text || '')
    .replace(/([一-龯々〆ヵヶ]{1,10})\(([\u3040-\u30FFー・]{1,20})\)/g, '$1')
    .replace(/\(([\u3040-\u30FFー・]{1,20})\)/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function extractEnglishCollocationsFromExamples(examples = [], phrase = '', maxCount = 6) {
  const phraseWords = new Set(
    (String(phrase || '').toLowerCase().match(/[a-z]+/g) || []).filter((w) => !EN_STOPWORDS.has(w))
  );
  const candidates = new Map();

  examples.forEach((ex, idx) => {
    const words = (toStr(ex.text).toLowerCase().match(/[a-z]+(?:'[a-z]+)?/g) || []);
    for (let n = 2; n <= 3; n += 1) {
      for (let i = 0; i <= words.length - n; i += 1) {
        const chunkWords = words.slice(i, i + n);
        if (chunkWords.every((w) => EN_STOPWORDS.has(w))) continue;
        const pattern = chunkWords.join(' ');
        const key = pattern.toLowerCase();
        const item = candidates.get(key) || {
          pattern,
          count: 0,
          boost: 0,
          exampleEn: toStr(ex.text),
          exampleZh: toStr(ex.translation),
          sourceIndex: idx
        };
        item.count += 1;
        if (chunkWords.some((w) => phraseWords.has(w))) item.boost += 2;
        candidates.set(key, item);
      }
    }
  });

  const sorted = Array.from(candidates.values())
    .sort((a, b) => (b.boost - a.boost) || (b.count - a.count) || (a.sourceIndex - b.sourceIndex))
    .slice(0, maxCount);

  return sorted.map((item, idx) => ({
    id: `en-${idx + 1}`,
    pattern: item.pattern,
    meaningZh: '从例句抽取的常用英文搭配',
    usageZh: '优先用于口语表达和固定搭配记忆',
    exampleEn: item.exampleEn,
    exampleZh: item.exampleZh || '请结合卡片语境理解该搭配',
    distractors: [],
    difficulty: 2
  }));
}

function extractJapaneseChunksFromExamples(examples = [], phrase = '', maxCount = 6) {
  const map = new Map();
  const phraseJa = stripJapaneseReading(phrase);
  const particlePattern = /[一-龯ぁ-んァ-ヶー]{1,10}(?:を|が|に|で|と|へ|から|まで|より|は|も|の)[一-龯ぁ-んァ-ヶー]{1,10}/g;
  const grammarLexicon = ['わけでもなく', 'において', 'について', 'に対して', 'として', 'により', 'に向けて', 'ておく', 'てしまう', 'ことができる'];

  const push = (chunk, ex, score = 0) => {
    const cleaned = stripJapaneseReading(chunk).replace(/[、。！？]/g, '').trim();
    if (!cleaned || cleaned.length < 2 || cleaned.length > 20) return;
    const key = cleaned;
    const item = map.get(key) || {
      chunk: cleaned,
      count: 0,
      boost: 0,
      exampleJa: stripJapaneseReading(ex.text),
      exampleZh: toStr(ex.translation)
    };
    item.count += 1;
    item.boost += score;
    map.set(key, item);
  };

  examples.forEach((ex) => {
    const sentence = stripJapaneseReading(ex.text);
    if (!sentence) return;
    if (phraseJa && isLikelyJapanese(phraseJa) && sentence.includes(phraseJa)) {
      push(phraseJa, ex, 3);
    }
    grammarLexicon.forEach((token) => {
      if (sentence.includes(token)) push(token, ex, 2);
    });
    const matches = sentence.match(particlePattern) || [];
    matches.forEach((m) => push(m, ex, 1));
  });

  return Array.from(map.values())
    .sort((a, b) => (b.boost - a.boost) || (b.count - a.count))
    .slice(0, maxCount)
    .map((item, idx) => ({
      id: `ja-${idx + 1}`,
      chunk: item.chunk,
      reading: item.chunk,
      meaningZh: '从例句抽取的常用日语语块',
      usageZh: '用于句型套用与语感强化',
      exampleJa: item.exampleJa,
      exampleZh: item.exampleZh || '请结合语境理解该语块',
      grammarLabel: '语块',
      distractors: [],
      difficulty: 3
    }));
}

function fallbackHeuristicPack({ phrase, cardType, markdown }) {
  const normalizedCardType = normalizeCardType(cardType);
  const parsed = parseTrilingualMarkdown(markdown);
  const enExamples = (parsed?.sections?.en?.examples || []).map((item) => ({
    text: toStr(item.text),
    translation: toStr(item.translation)
  }));
  const jaExamples = normalizedCardType === 'grammar_ja'
    ? parseGrammarExamples(markdown).map((item) => ({
      text: toStr(item.text),
      translation: toStr(item.translation)
    }))
    : (parsed?.sections?.ja?.examples || []).map((item) => ({
      text: toStr(item.text),
      translation: toStr(item.translation)
    }));

  let enCollocations = extractEnglishCollocationsFromExamples(enExamples, phrase, 8);
  let jaChunks = extractJapaneseChunksFromExamples(jaExamples, phrase, 8);

  while (enCollocations.length < 4) {
    const idx = enCollocations.length + 1;
    enCollocations.push({
      id: `en-${idx}`,
      pattern: idx === 1 ? toStr(phrase, 'core phrase') : `${toStr(phrase, 'core phrase')} usage ${idx}`,
      meaningZh: '核心表达的搭配补充',
      usageZh: '用于扩展表达范围',
      exampleEn: enExamples[0]?.text || 'Please use this phrase in a practical sentence.',
      exampleZh: enExamples[0]?.translation || '请将该搭配用于实际表达。',
      distractors: [],
      difficulty: 2
    });
  }

  while (jaChunks.length < 4) {
    const idx = jaChunks.length + 1;
    const defaultChunk = ['〜について', '〜において', '〜として', '〜に対して'][idx - 1] || '〜に関して';
    jaChunks.push({
      id: `ja-${idx}`,
      chunk: defaultChunk,
      reading: defaultChunk,
      meaningZh: '语法语块补充',
      usageZh: '用于对比与替换练习',
      exampleJa: jaExamples[0]?.text || 'この表現を文脈に合わせて使ってみよう。',
      exampleZh: jaExamples[0]?.translation || '请在语境中尝试使用该语块。',
      grammarLabel: '语法语块',
      distractors: [],
      difficulty: 3
    });
  }

  const quizzes = [];
  enCollocations.slice(0, 2).forEach((item, idx) => {
    const sentence = toStr(item.exampleEn);
    const question = sentence && sentence.toLowerCase().includes(item.pattern.toLowerCase())
      ? sentence.replace(new RegExp(escapeRegex(item.pattern), 'i'), '____')
      : `Fill in the blank with the correct collocation: ____`;
    quizzes.push({
      id: `q-en-${idx + 1}`,
      lang: 'en',
      type: 'cloze',
      question,
      answer: item.pattern,
      choices: [item.pattern, ...(item.distractors || [])].slice(0, 4),
      explanationZh: `该题考查搭配：${item.pattern}`,
      relatedUnitIds: [item.id]
    });
  });
  jaChunks.slice(0, 2).forEach((item, idx) => {
    const sentence = toStr(item.exampleJa);
    const question = sentence && sentence.includes(item.chunk)
      ? sentence.replace(item.chunk, '＿＿＿＿')
      : '请填入合适的日语语块：＿＿＿＿';
    quizzes.push({
      id: `q-ja-${idx + 1}`,
      lang: 'ja',
      type: 'cloze',
      question,
      answer: item.chunk,
      choices: [item.chunk, ...(item.distractors || [])].slice(0, 4),
      explanationZh: `该题考查语块：${item.chunk}`,
      relatedUnitIds: [item.id]
    });
  });

  while (quizzes.length < 4) {
    const item = enCollocations[quizzes.length % enCollocations.length];
    quizzes.push({
      id: `q-${quizzes.length + 1}`,
      lang: 'en',
      type: 'choice',
      question: `以下哪个搭配更符合当前语境？`,
      answer: item.pattern,
      choices: [item.pattern, ...normalizeStringArray(item.distractors, 3)].slice(0, 4),
      explanationZh: '优先选择与当前卡片语义最一致的固定搭配。',
      relatedUnitIds: [item.id]
    });
  }

  const coverageScore = buildCoverageScore(enCollocations.length, jaChunks.length, quizzes.length);
  const payload = {
    schemaVersion: TRAINING_SCHEMA_VERSION,
    phrase: toStr(phrase),
    cardType: normalizedCardType,
    enCollocations,
    jaChunks,
    quizzes,
    quality: {
      selfConfidence: 0.55,
      coverageScore,
      notes: 'heuristic fallback'
    }
  };

  const validated = validateTrainingPack(payload, {
    phrase,
    cardType: normalizedCardType,
    strictMin: false
  });

  return {
    ok: validated.ok,
    payload: validated.payload,
    qualityScore: validated.qualityScore,
    coverageScore: validated.coverageScore,
    selfConfidence: validated.selfConfidence,
    errors: validated.errors
  };
}

function getResponseText(resp) {
  if (!resp || typeof resp !== 'object') return toStr(resp);
  if (typeof resp.markdown === 'string' && resp.markdown.trim()) return resp.markdown;
  if (typeof resp.rawOutput === 'string' && resp.rawOutput.trim()) return resp.rawOutput;
  if (typeof resp.text === 'string' && resp.text.trim()) return resp.text;
  if (typeof resp.output === 'string' && resp.output.trim()) return resp.output;
  return JSON.stringify(resp, null, 2);
}

function buildSanitizedTrainingResponseValidator(context = {}) {
  return (response) => {
    try {
      const rawText = getResponseText(response);
      if (!rawText) return false;
      const parsed = parseJsonFromText(rawText);
      const validated = validateTrainingPack(parsed, {
        phrase: context.phrase,
        cardType: context.cardType,
        strictMin: true
      });
      return validated.ok;
    } catch (err) {
      return false;
    }
  };
}

async function callTeacherModel(prompt, options = {}) {
  const model = toStr(options.model || TRAINING_MODEL_DEFAULT, TRAINING_MODEL_DEFAULT);
  const baseName = toStr(options.baseName, 'training_pack');
  const timeoutMs = toNumberOr(options.timeoutMs ?? process.env.TRAINING_PROXY_TIMEOUT_MS, 120000);
  const response = await runGeminiProxy(prompt, {
    baseName,
    model,
    timeoutMs,
    executionTimeoutMs: toNumberOr(options.executionTimeoutMs, 0),
    retries: toNumberOr(options.retries, 1),
    retryDelayMs: toNumberOr(options.retryDelayMs, 1200),
    breakerRetryDelayMs: toNumberOr(options.breakerRetryDelayMs, 6000),
    resetOnTimeout: options.resetOnTimeout,
    retryOnTimeout: options.retryOnTimeout,
    retryOnBreakerOpen: options.retryOnBreakerOpen,
    validateSanitizedResponse: options.validateSanitizedResponse
  });
  const rawText = getResponseText(response);
  return {
    model: toStr(response?.model || model, model),
    rawText,
    response
  };
}

async function repairTrainingPack(input = {}) {
  const phrase = toStr(input.phrase);
  const cardType = normalizeCardType(input.cardType);
  const markdown = toStr(input.markdown);
  const validationErrors = Array.isArray(input.validationErrors) ? input.validationErrors : [];
  const rawOutput = toStr(input.rawOutput);
  const template = readTemplate(REPAIR_TEMPLATE_PATH, '');
  const prompt = templateReplace(template, {
    phrase,
    card_type: cardType,
    markdown,
    raw_output: rawOutput,
    validation_errors: validationErrors.join('\n')
  });

  const start = Date.now();
  const llm = await callTeacherModel(prompt, {
    model: input.model,
    baseName: `${toStr(input.baseName, 'training_pack')}_repair`,
    timeoutMs: input.timeoutMs,
    executionTimeoutMs: input.executionTimeoutMs,
    retries: input.retries,
    retryDelayMs: input.retryDelayMs,
    breakerRetryDelayMs: input.breakerRetryDelayMs,
    resetOnTimeout: input.resetOnTimeout,
    retryOnTimeout: input.retryOnTimeout,
    retryOnBreakerOpen: input.retryOnBreakerOpen,
    validateSanitizedResponse: buildSanitizedTrainingResponseValidator({ phrase, cardType })
  });
  const latencyMs = Date.now() - start;
  let parsed;
  try {
    parsed = parseJsonFromText(llm.rawText);
  } catch (err) {
    return {
      ok: false,
      errors: [`repair parse failed: ${err.message}`],
      rawOutput: llm.rawText,
      model: llm.model,
      prompt,
      latencyMs
    };
  }

  const validated = validateTrainingPack(parsed, {
    phrase,
    cardType,
    strictMin: true
  });
  return {
    ok: validated.ok,
    errors: validated.errors,
    payload: validated.payload,
    qualityScore: validated.qualityScore,
    coverageScore: validated.coverageScore,
    selfConfidence: validated.selfConfidence,
    rawOutput: llm.rawText,
    model: llm.model,
    prompt,
    latencyMs
  };
}

async function generateTrainingPack(input = {}) {
  const phrase = toStr(input.phrase);
  const cardType = normalizeCardType(input.cardType);
  const markdown = toStr(input.markdown);
  const model = toStr(input.model || TRAINING_MODEL_DEFAULT, TRAINING_MODEL_DEFAULT);
  const baseName = toStr(input.baseName, 'training_pack');
  const runtime = buildRuntimeOptions(input);

  const template = readTemplate(PROMPT_TEMPLATE_PATH, '');
  const prompt = templateReplace(template, {
    phrase,
    card_type: cardType,
    markdown
  });

  const attempts = [];
  const allValidationErrors = [];
  const startedAt = Date.now();

  try {
    const llmStart = Date.now();
    const llm = await callTeacherModel(prompt, {
      model,
      baseName,
      timeoutMs: runtime.requestTimeoutMs,
      executionTimeoutMs: runtime.executionTimeoutMs,
      retries: runtime.retries,
      retryDelayMs: runtime.retryDelayMs,
      breakerRetryDelayMs: runtime.breakerRetryDelayMs,
      resetOnTimeout: runtime.resetOnTimeout,
      retryOnTimeout: runtime.retryOnTimeout,
      retryOnBreakerOpen: runtime.retryOnBreakerOpen,
      validateSanitizedResponse: buildSanitizedTrainingResponseValidator({ phrase, cardType })
    });
    const llmLatency = Date.now() - llmStart;
    attempts.push({ stage: 'llm', model: llm.model, latencyMs: llmLatency });

    let parsed;
    try {
      parsed = parseJsonFromText(llm.rawText);
    } catch (err) {
      allValidationErrors.push(`llm parse failed: ${err.message}`);
      if (runtime.disableRepairOnTimeout && isTimeoutLikeError(err.message)) {
        const fallback = fallbackHeuristicPack({ phrase, cardType, markdown });
        return {
          status: fallback.ok ? 'fallback' : 'failed',
          source: 'heuristic',
          payload: fallback.ok ? fallback.payload : null,
          qualityScore: fallback.ok ? fallback.qualityScore : 0,
          coverageScore: fallback.ok ? fallback.coverageScore : 0,
          selfConfidence: fallback.ok ? fallback.selfConfidence : 0,
          validationErrors: allValidationErrors,
          fallbackReason: 'llm_timeout_skip_repair',
          providerUsed: 'gemini',
          modelUsed: model,
          promptVersion: TRAINING_PROMPT_VERSION,
          schemaVersion: TRAINING_SCHEMA_VERSION,
          tokensInput: TokenCounter.estimate(prompt),
          tokensOutput: TokenCounter.estimate(llm.rawText),
          tokensTotal: TokenCounter.estimate(prompt) + TokenCounter.estimate(llm.rawText),
          costTotal: 0,
          latencyMs: Date.now() - startedAt,
          rawOutput: llm.rawText,
          attempts
        };
      }
      const repaired = await repairTrainingPack({
        phrase,
        cardType,
        markdown,
        validationErrors: allValidationErrors,
        rawOutput: llm.rawText,
        model,
        baseName,
        timeoutMs: runtime.repairTimeoutMs,
        executionTimeoutMs: runtime.repairExecutionTimeoutMs,
        retries: runtime.repairRetries,
        retryDelayMs: runtime.retryDelayMs,
        breakerRetryDelayMs: runtime.breakerRetryDelayMs,
        resetOnTimeout: runtime.resetOnTimeout,
        retryOnTimeout: runtime.retryOnTimeout,
        retryOnBreakerOpen: runtime.retryOnBreakerOpen
      });
      attempts.push({ stage: 'repair', model: repaired.model || model, latencyMs: repaired.latencyMs || 0 });
      if (repaired.ok) {
        const tokensInput = TokenCounter.estimate(prompt) + TokenCounter.estimate(repaired.prompt || '');
        const tokensOutput = TokenCounter.estimate(llm.rawText) + TokenCounter.estimate(repaired.rawOutput || '');
        const tokensTotal = tokensInput + tokensOutput;
        const cost = TokenCounter.calculateCost({ input: tokensInput, output: tokensOutput, total: tokensTotal }, 'gemini');
        return {
          status: 'repaired',
          source: 'repaired',
          payload: repaired.payload,
          qualityScore: repaired.qualityScore,
          coverageScore: repaired.coverageScore,
          selfConfidence: repaired.selfConfidence,
          validationErrors: [],
          fallbackReason: null,
          providerUsed: 'gemini',
          modelUsed: repaired.model || model,
          promptVersion: TRAINING_REPAIR_PROMPT_VERSION,
          schemaVersion: TRAINING_SCHEMA_VERSION,
          tokensInput,
          tokensOutput,
          tokensTotal,
          costTotal: Number(cost.total || 0),
          latencyMs: Date.now() - startedAt,
          rawOutput: repaired.rawOutput || llm.rawText,
          attempts
        };
      }

      allValidationErrors.push(...(repaired.errors || []));
      const fallback = fallbackHeuristicPack({ phrase, cardType, markdown });
      return {
        status: fallback.ok ? 'fallback' : 'failed',
        source: fallback.ok ? 'heuristic' : 'heuristic',
        payload: fallback.ok ? fallback.payload : null,
        qualityScore: fallback.ok ? fallback.qualityScore : 0,
        coverageScore: fallback.ok ? fallback.coverageScore : 0,
        selfConfidence: fallback.ok ? fallback.selfConfidence : 0,
        validationErrors: allValidationErrors,
        fallbackReason: 'repair_parse_failed',
        providerUsed: 'gemini',
        modelUsed: model,
        promptVersion: TRAINING_PROMPT_VERSION,
        schemaVersion: TRAINING_SCHEMA_VERSION,
        tokensInput: TokenCounter.estimate(prompt),
        tokensOutput: TokenCounter.estimate(llm.rawText),
        tokensTotal: TokenCounter.estimate(prompt) + TokenCounter.estimate(llm.rawText),
        costTotal: 0,
        latencyMs: Date.now() - startedAt,
        rawOutput: llm.rawText,
        attempts
      };
    }

    const validated = validateTrainingPack(parsed, { phrase, cardType, strictMin: true });
    if (validated.ok) {
      const tokensInput = TokenCounter.estimate(prompt);
      const tokensOutput = TokenCounter.estimate(llm.rawText);
      const tokensTotal = tokensInput + tokensOutput;
      const cost = TokenCounter.calculateCost({ input: tokensInput, output: tokensOutput, total: tokensTotal }, 'gemini');
      return {
        status: 'ready',
        source: 'llm',
        payload: validated.payload,
        qualityScore: validated.qualityScore,
        coverageScore: validated.coverageScore,
        selfConfidence: validated.selfConfidence,
        validationErrors: [],
        fallbackReason: null,
        providerUsed: 'gemini',
        modelUsed: llm.model || model,
        promptVersion: TRAINING_PROMPT_VERSION,
        schemaVersion: TRAINING_SCHEMA_VERSION,
        tokensInput,
        tokensOutput,
        tokensTotal,
        costTotal: Number(cost.total || 0),
        latencyMs: Date.now() - startedAt,
        rawOutput: llm.rawText,
        attempts
      };
    }

    allValidationErrors.push(...validated.errors);
    if (runtime.disableRepairOnTimeout && validated.errors.some((error) => isTimeoutLikeError(error))) {
      const fallback = fallbackHeuristicPack({ phrase, cardType, markdown });
      return {
        status: fallback.ok ? 'fallback' : 'failed',
        source: 'heuristic',
        payload: fallback.ok ? fallback.payload : null,
        qualityScore: fallback.ok ? fallback.qualityScore : 0,
        coverageScore: fallback.ok ? fallback.coverageScore : 0,
        selfConfidence: fallback.ok ? fallback.selfConfidence : 0,
        validationErrors: allValidationErrors,
        fallbackReason: 'llm_timeout_skip_repair',
        providerUsed: 'gemini',
        modelUsed: model,
        promptVersion: TRAINING_PROMPT_VERSION,
        schemaVersion: TRAINING_SCHEMA_VERSION,
        tokensInput: TokenCounter.estimate(prompt),
        tokensOutput: TokenCounter.estimate(llm.rawText),
        tokensTotal: TokenCounter.estimate(prompt) + TokenCounter.estimate(llm.rawText),
        costTotal: 0,
        latencyMs: Date.now() - startedAt,
        rawOutput: llm.rawText,
        attempts
      };
    }
    const repaired = await repairTrainingPack({
      phrase,
      cardType,
      markdown,
      validationErrors: allValidationErrors,
      rawOutput: llm.rawText,
      model,
      baseName,
      timeoutMs: runtime.repairTimeoutMs,
      executionTimeoutMs: runtime.repairExecutionTimeoutMs,
      retries: runtime.repairRetries,
      retryDelayMs: runtime.retryDelayMs,
      breakerRetryDelayMs: runtime.breakerRetryDelayMs,
      resetOnTimeout: runtime.resetOnTimeout,
      retryOnTimeout: runtime.retryOnTimeout,
      retryOnBreakerOpen: runtime.retryOnBreakerOpen
    });
    attempts.push({ stage: 'repair', model: repaired.model || model, latencyMs: repaired.latencyMs || 0 });
    if (repaired.ok) {
      const tokensInput = TokenCounter.estimate(prompt) + TokenCounter.estimate(repaired.prompt || '');
      const tokensOutput = TokenCounter.estimate(llm.rawText) + TokenCounter.estimate(repaired.rawOutput || '');
      const tokensTotal = tokensInput + tokensOutput;
      const cost = TokenCounter.calculateCost({ input: tokensInput, output: tokensOutput, total: tokensTotal }, 'gemini');
      return {
        status: 'repaired',
        source: 'repaired',
        payload: repaired.payload,
        qualityScore: repaired.qualityScore,
        coverageScore: repaired.coverageScore,
        selfConfidence: repaired.selfConfidence,
        validationErrors: [],
        fallbackReason: null,
        providerUsed: 'gemini',
        modelUsed: repaired.model || model,
        promptVersion: TRAINING_REPAIR_PROMPT_VERSION,
        schemaVersion: TRAINING_SCHEMA_VERSION,
        tokensInput,
        tokensOutput,
        tokensTotal,
        costTotal: Number(cost.total || 0),
        latencyMs: Date.now() - startedAt,
        rawOutput: repaired.rawOutput || llm.rawText,
        attempts
      };
    }

    allValidationErrors.push(...(repaired.errors || []));
    const fallback = fallbackHeuristicPack({ phrase, cardType, markdown });
    return {
      status: fallback.ok ? 'fallback' : 'failed',
      source: 'heuristic',
      payload: fallback.ok ? fallback.payload : null,
      qualityScore: fallback.ok ? fallback.qualityScore : 0,
      coverageScore: fallback.ok ? fallback.coverageScore : 0,
      selfConfidence: fallback.ok ? fallback.selfConfidence : 0,
      validationErrors: allValidationErrors,
      fallbackReason: 'llm_validation_failed',
      providerUsed: 'gemini',
      modelUsed: model,
      promptVersion: TRAINING_PROMPT_VERSION,
      schemaVersion: TRAINING_SCHEMA_VERSION,
      tokensInput: TokenCounter.estimate(prompt),
      tokensOutput: TokenCounter.estimate(llm.rawText),
      tokensTotal: TokenCounter.estimate(prompt) + TokenCounter.estimate(llm.rawText),
      costTotal: 0,
      latencyMs: Date.now() - startedAt,
      rawOutput: llm.rawText,
      attempts
    };
  } catch (error) {
    const fallback = fallbackHeuristicPack({ phrase, cardType, markdown });
    const validationErrors = [...allValidationErrors, `llm_call_failed: ${error.message}`];
    return {
      status: fallback.ok ? 'fallback' : 'failed',
      source: 'heuristic',
      payload: fallback.ok ? fallback.payload : null,
      qualityScore: fallback.ok ? fallback.qualityScore : 0,
      coverageScore: fallback.ok ? fallback.coverageScore : 0,
      selfConfidence: fallback.ok ? fallback.selfConfidence : 0,
      validationErrors,
      fallbackReason: 'llm_unavailable',
      providerUsed: 'gemini',
      modelUsed: model,
      promptVersion: TRAINING_PROMPT_VERSION,
      schemaVersion: TRAINING_SCHEMA_VERSION,
      tokensInput: TokenCounter.estimate(prompt),
      tokensOutput: 0,
      tokensTotal: TokenCounter.estimate(prompt),
      costTotal: 0,
      latencyMs: Date.now() - startedAt,
      rawOutput: '',
      attempts
    };
  }
}

module.exports = {
  TRAINING_SCHEMA_VERSION,
  TRAINING_PROMPT_VERSION,
  TRAINING_REPAIR_PROMPT_VERSION,
  generateTrainingPack,
  validateTrainingPack,
  repairTrainingPack,
  fallbackHeuristicPack
};
