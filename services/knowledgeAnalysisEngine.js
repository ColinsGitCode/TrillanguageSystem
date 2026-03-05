const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { runGeminiCli } = require('./geminiCliService');

function stripHtml(text) {
  return String(text || '').replace(/<[^>]*>/g, '');
}

function normalizeText(text) {
  return stripHtml(String(text || ''))
    .replace(/[ \t\r\n]+/g, ' ')
    .replace(/[\u200B-\u200D\uFEFF]/g, '')
    .trim();
}

function profileLang(text) {
  const input = String(text || '');
  const hasZh = /[\u4e00-\u9fff]/.test(input);
  const hasJa = /[\u3040-\u30ff]/.test(input);
  const hasEn = /[A-Za-z]/.test(input);
  if (hasZh && !hasJa && !hasEn) return 'zh';
  if (!hasZh && hasJa && !hasEn) return 'ja';
  if (!hasZh && !hasJa && hasEn) return 'en';
  return 'mixed';
}

function extractEnHeadword(record) {
  const phrase = String(record.phrase || '');
  const enFromPhrase = phrase.match(/[A-Za-z][A-Za-z\s\-']*/);
  if (enFromPhrase && enFromPhrase[0]) return enFromPhrase[0].trim();
  return normalizeText(record.en_translation || '').slice(0, 80) || null;
}

function extractJaHeadword(record) {
  const phrase = String(record.phrase || '');
  if (/[\u3040-\u30ff]/.test(phrase)) return normalizeText(phrase).slice(0, 80);
  const ja = normalizeText(record.ja_translation || '');
  if (!ja) return null;
  return ja
    .replace(/\([^)]*\)/g, '')
    .replace(/[（][^）]*[）]/g, '')
    .slice(0, 80)
    .trim() || null;
}

function extractZhHeadword(record) {
  const phrase = String(record.phrase || '');
  const zhPhrase = phrase.match(/[\u4e00-\u9fff]{1,}/g);
  if (zhPhrase && zhPhrase.length) return zhPhrase.join('').slice(0, 40);
  return normalizeText(record.zh_translation || '').slice(0, 40) || null;
}

function buildAliases(record) {
  const set = new Set();
  [record.phrase, record.en_translation, record.ja_translation, record.zh_translation].forEach((value) => {
    const normalized = normalizeText(value);
    if (normalized) set.add(normalized);
  });
  return Array.from(set).slice(0, 12);
}

function inferTags(record) {
  const text = normalizeText([
    record.phrase,
    record.en_translation,
    record.ja_translation,
    record.zh_translation,
    record.markdown_content
  ].join(' ')).toLowerCase();

  const tags = [];
  const rules = [
    { tag: 'ai-tech', keys: ['model', 'prompt', 'token', 'llm', '推理', '模型', '提示词'] },
    { tag: 'engineering', keys: ['api', 'queue', 'retry', 'latency', 'circuit', 'cache', 'docker', 'proxy', 'db', 'database'] },
    { tag: 'communication', keys: ['简而言之', '也就是说', '要するに', 'つまり', 'explain', 'clarify'] },
    { tag: 'grammar-ja', keys: ['文法', 'grammar', '〜', 'わけでもなく', '要するに'] }
  ];
  rules.forEach((rule) => {
    if (rule.keys.some((key) => text.includes(String(key).toLowerCase()))) {
      tags.push(rule.tag);
    }
  });
  if (!tags.length) tags.push('general');
  return Array.from(new Set(tags));
}

function extractJapaneseSentences(markdownContent) {
  const text = String(markdownContent || '');
  const sectionMatch = text.match(/##\s*2\.[\s\S]*?(?:##\s*3\.|$)/);
  if (!sectionMatch) return [];
  const section = sectionMatch[0];
  const lines = section.split('\n');
  const sentences = [];
  for (const line of lines) {
    const match = line.match(/^\s*-\s*\*\*例句\d+\*\*:\s*(.+)$/);
    if (match) {
      const sentence = normalizeText(match[1]);
      if (sentence) sentences.push(sentence);
    }
  }
  return sentences;
}

function detectGrammarPatterns(sentence) {
  const knownPatterns = [
    { pattern: '〜わけでもなく', explanationZh: '表示并非完全如此，而是部分否定或缓和表达。' },
    { pattern: '〜要するに', explanationZh: '用于总结前文，表示“简而言之/总之”。' },
    { pattern: '〜ことがある', explanationZh: '表示“有时会……”的经验或偶发事件。' },
    { pattern: '〜ておく', explanationZh: '表示提前做好某动作以备后续。' },
    { pattern: '〜てしまう', explanationZh: '表示动作完成或带有遗憾语气。' },
    { pattern: '〜ように', explanationZh: '表示目的、变化结果或请求。' }
  ];

  const normalized = String(sentence || '');
  return knownPatterns.filter((item) => normalized.includes(item.pattern.replace('〜', '')));
}

function hashFingerprint(parts) {
  return crypto.createHash('sha1').update(parts.join('|')).digest('hex');
}

function runSummary(cards = []) {
  const totals = {
    total: cards.length,
    byCardType: {},
    byProvider: {},
    byLangProfile: {}
  };
  let qualityCount = 0;
  let qualitySum = 0;
  let tokenCount = 0;
  let tokenSum = 0;

  cards.forEach((card) => {
    const cardType = String(card.card_type || 'trilingual');
    const provider = String(card.llm_provider || 'unknown');
    const langProfile = profileLang(card.phrase);
    totals.byCardType[cardType] = (totals.byCardType[cardType] || 0) + 1;
    totals.byProvider[provider] = (totals.byProvider[provider] || 0) + 1;
    totals.byLangProfile[langProfile] = (totals.byLangProfile[langProfile] || 0) + 1;

    if (card.quality_score != null) {
      qualityCount += 1;
      qualitySum += Number(card.quality_score || 0);
    }
    if (card.tokens_total != null) {
      tokenCount += 1;
      tokenSum += Number(card.tokens_total || 0);
    }
  });

  const avgQuality = qualityCount > 0 ? Number((qualitySum / qualityCount).toFixed(2)) : null;
  const avgTokens = tokenCount > 0 ? Number((tokenSum / tokenCount).toFixed(2)) : null;
  const actionItems = [];
  if ((totals.byCardType.grammar_ja || 0) < Math.max(5, Math.round(cards.length * 0.08))) {
    actionItems.push({ priority: 1, action: '提升语法卡占比，优先覆盖高频语法点。' });
  }
  if ((totals.byProvider.local || 0) < 10) {
    actionItems.push({ priority: 2, action: '增加本地模型样本，形成稳定对照集。' });
  }

  return {
    overview: `共分析 ${cards.length} 张卡片。`,
    topTopics: Object.entries(totals.byCardType)
      .sort((a, b) => b[1] - a[1])
      .map(([topic, count]) => ({ topic, count })),
    qualityObservations: [
      {
        finding: avgQuality == null ? '质量数据不足' : `平均质量分 ${avgQuality}`,
        severity: avgQuality != null && avgQuality < 80 ? 'high' : 'low',
        evidenceIds: []
      },
      {
        finding: avgTokens == null ? 'Token 数据不足' : `平均总 Token ${avgTokens}`,
        severity: 'low',
        evidenceIds: []
      }
    ],
    actionItems
  };
}

function runIndex(cards = []) {
  const entries = cards.map((card) => {
    const aliases = buildAliases(card);
    return {
      generationId: Number(card.id),
      phrase: String(card.phrase || ''),
      cardType: String(card.card_type || 'trilingual'),
      folderName: String(card.folder_name || ''),
      langProfile: profileLang(card.phrase),
      enHeadword: extractEnHeadword(card),
      jaHeadword: extractJaHeadword(card),
      zhHeadword: extractZhHeadword(card),
      aliases,
      tags: inferTags(card),
      score: Number(card.quality_score || 0)
    };
  });
  return { entries };
}

function normalizeTermKey(text) {
  return normalizeText(text || '')
    .toLowerCase()
    .replace(/[’']/g, "'")
    .replace(/[^a-z0-9\u3040-\u30ff\u4e00-\u9fff\- ]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function normalizeMeaningKey(text) {
  return normalizeText(text || '')
    .toLowerCase()
    .replace(/[，。；、]/g, ',')
    .replace(/[()（）]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function buildPairKey(termA, termB) {
  const a = normalizeTermKey(termA);
  const b = normalizeTermKey(termB);
  return [a, b].sort().join('||');
}

function tokenizeZhMeaning(text) {
  const normalized = normalizeMeaningKey(text);
  if (!normalized) return [];
  return normalized
    .split(/[,\|/]/g)
    .map((item) => item.trim())
    .filter(Boolean)
    .map((item) => item.replace(/\s+/g, ''));
}

function jaccardScore(tokensA, tokensB) {
  const setA = new Set(Array.isArray(tokensA) ? tokensA.filter(Boolean) : []);
  const setB = new Set(Array.isArray(tokensB) ? tokensB.filter(Boolean) : []);
  if (!setA.size || !setB.size) return 0;
  let inter = 0;
  setA.forEach((token) => {
    if (setB.has(token)) inter += 1;
  });
  const union = setA.size + setB.size - inter;
  if (!union) return 0;
  return inter / union;
}

function extractCollocationTokens(...texts) {
  const input = normalizeText(texts.filter(Boolean).join(' ')).toLowerCase();
  if (!input) return [];
  const tokens = input.match(/[a-z][a-z\-']{2,}|[\u3040-\u30ff]{2,}|[\u4e00-\u9fff]{2,}/g) || [];
  const stop = new Set(['the', 'and', 'for', 'with', 'that', 'this', 'from', 'have', 'will', 'into', 'about', 'your']);
  const counter = new Map();
  tokens.forEach((token) => {
    if (stop.has(token)) return;
    counter.set(token, (counter.get(token) || 0) + 1);
  });
  return Array.from(counter.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, 6)
    .map(([token]) => token);
}

function percentile(values, p = 0.95) {
  if (!Array.isArray(values) || values.length === 0) return 0;
  const sorted = values.slice().sort((a, b) => a - b);
  const pos = Math.min(sorted.length - 1, Math.max(0, Math.floor((sorted.length - 1) * p)));
  return Number(sorted[pos] || 0);
}

function normalizeSynonymBoundaryOptions(options = {}) {
  const llmEnvEnabled = ['1', 'true', 'yes'].includes(String(process.env.KNOWLEDGE_SYNONYM_LLM_ENABLED || '').toLowerCase());
  const llmEnabled = options.llmEnabled == null ? llmEnvEnabled : Boolean(options.llmEnabled);
  return {
    minCandidateScore: Number(options.minCandidateScore == null ? 0.62 : options.minCandidateScore),
    maxPairs: Math.max(1, Number(options.maxPairs == null ? 120 : options.maxPairs)),
    maxLlmPairs: Math.max(0, Number(options.maxLlmPairs == null ? 24 : options.maxLlmPairs)),
    model: options.model || process.env.KNOWLEDGE_SYNONYM_MODEL || process.env.GEMINI_CLI_MODEL || '',
    schemaVersion: String(options.schemaVersion || '1.0.0'),
    promptVersion: String(options.promptVersion || 'syn-v1'),
    llmEnabled,
    llmTimeoutMs: Math.max(5000, Number(options.llmTimeoutMs || process.env.KNOWLEDGE_SYNONYM_LLM_TIMEOUT_MS || 120000))
  };
}

function collectTermRecords(cards = []) {
  const termMap = new Map();
  cards.forEach((card) => {
    const term = normalizeText(card.phrase || '');
    const termKey = normalizeTermKey(term);
    if (!term || !termKey) return;
    if (!termMap.has(termKey)) {
      termMap.set(termKey, { term, records: [] });
    }
    termMap.get(termKey).records.push(card);
  });
  return termMap;
}

function discoverSynonymCandidates(cards = [], options = {}) {
  const termMap = collectTermRecords(cards);
  const meaningBuckets = new Map();

  cards.forEach((card) => {
    const term = normalizeText(card.phrase || '');
    const termKey = normalizeTermKey(term);
    const meaningKey = normalizeMeaningKey(card.zh_translation || '');
    if (!termKey || !meaningKey) return;
    if (!meaningBuckets.has(meaningKey)) meaningBuckets.set(meaningKey, []);
    meaningBuckets.get(meaningKey).push({
      id: Number(card.id),
      term,
      termKey,
      zhTokens: tokenizeZhMeaning(card.zh_translation || ''),
      tags: inferTags(card)
    });
  });

  const pairMap = new Map();
  for (const [meaningKey, rows] of meaningBuckets.entries()) {
    if (!rows || rows.length < 2) continue;
    for (let i = 0; i < rows.length; i += 1) {
      for (let j = i + 1; j < rows.length; j += 1) {
        const a = rows[i];
        const b = rows[j];
        if (a.termKey === b.termKey) continue;
        const pairKey = buildPairKey(a.term, b.term);
        if (!pairKey) continue;
        const tokenScore = jaccardScore(a.zhTokens, b.zhTokens);
        const tagScore = jaccardScore(a.tags, b.tags);
        const score = Number((tokenScore * 0.75 + tagScore * 0.25).toFixed(4));
        const prev = pairMap.get(pairKey);
        if (!prev || score > prev.candidateScore) {
          const [left, right] = [a.term, b.term].sort((x, y) => x.localeCompare(y));
          pairMap.set(pairKey, {
            pairKey,
            termA: left,
            termB: right,
            termAKey: normalizeTermKey(left),
            termBKey: normalizeTermKey(right),
            groupKey: meaningKey,
            candidateScore: score,
            evidenceIds: [a.id, b.id]
          });
        } else if (prev) {
          prev.evidenceIds = Array.from(new Set(prev.evidenceIds.concat([a.id, b.id])));
        }
      }
    }
  }

  return {
    termMap,
    candidates: Array.from(pairMap.values())
      .filter((item) => item.candidateScore >= Number(options.minCandidateScore || 0.62))
      .sort((a, b) => b.candidateScore - a.candidateScore)
      .slice(0, Math.max(1, Number(options.maxPairs || 120)))
  };
}

function buildEvidenceSnapshot(candidate, termMap = new Map()) {
  const termARecords = (termMap.get(candidate.termAKey)?.records || []).slice(0, 4);
  const termBRecords = (termMap.get(candidate.termBKey)?.records || []).slice(0, 4);
  const both = termARecords.concat(termBRecords);
  const sourceIds = Array.from(new Set(both.map((item) => Number(item.id)).filter(Boolean))).slice(0, 12);

  const extractPayload = (records = []) => ({
    definitions: Array.from(new Set(records.map((item) => normalizeText(item.en_translation || '')).filter(Boolean))).slice(0, 4),
    zhExplanations: Array.from(new Set(records.map((item) => normalizeText(item.zh_translation || '')).filter(Boolean))).slice(0, 4),
    jaExamples: Array.from(
      new Set(records.flatMap((item) => extractJapaneseSentences(item.markdown_content || '')).map((line) => normalizeText(line)).filter(Boolean))
    ).slice(0, 6),
    cardIds: Array.from(new Set(records.map((item) => Number(item.id)).filter(Boolean))).slice(0, 8)
  });

  const termAData = extractPayload(termARecords);
  const termBData = extractPayload(termBRecords);
  const normalizedA = normalizeTermKey(candidate.termA);
  const normalizedB = normalizeTermKey(candidate.termB);

  const mentionsAInB = termBRecords.some((item) => normalizeTermKey(item.markdown_content || '').includes(normalizedA));
  const mentionsBInA = termARecords.some((item) => normalizeTermKey(item.markdown_content || '').includes(normalizedB));

  const snapshot = {
    pair: { termA: candidate.termA, termB: candidate.termB },
    groupKey: candidate.groupKey,
    candidateScore: candidate.candidateScore,
    sourceIds,
    termA: termAData,
    termB: termBData,
    crossMentions: {
      aMentionedInB: mentionsAInB,
      bMentionedInA: mentionsBInA
    }
  };

  const evidenceHash = crypto
    .createHash('sha1')
    .update(JSON.stringify(snapshot))
    .digest('hex');

  return { snapshot, evidenceHash, sourceIds, termARecords, termBRecords };
}

function buildLocalBoundaryResult(candidate, snapshotMeta) {
  const { snapshot, sourceIds } = snapshotMeta;
  const termAKeys = extractCollocationTokens(
    candidate.termA,
    ...(snapshot.termA.definitions || []),
    ...(snapshot.termA.jaExamples || []),
    ...(snapshot.termA.zhExplanations || [])
  );
  const termBKeys = extractCollocationTokens(
    candidate.termB,
    ...(snapshot.termB.definitions || []),
    ...(snapshot.termB.jaExamples || []),
    ...(snapshot.termB.zhExplanations || [])
  );
  const shared = termAKeys.filter((item) => termBKeys.includes(item)).slice(0, 3);
  const uniqueA = termAKeys.filter((item) => !shared.includes(item)).slice(0, 3);
  const uniqueB = termBKeys.filter((item) => !shared.includes(item)).slice(0, 3);
  const riskLevel = candidate.candidateScore >= 0.82 ? 'high' : (candidate.candidateScore >= 0.7 ? 'medium' : 'low');
  const confidence = Number(Math.min(0.95, Math.max(0.55, 0.45 + candidate.candidateScore * 0.5)).toFixed(3));
  const coverageRatio = Number(Math.min(1, sourceIds.length / 8).toFixed(3));

  const contextSplit = [
    {
      dimension: 'register',
      a: `${candidate.termA} 偏向 ${uniqueA.join('/') || '分析场景'}。`,
      b: `${candidate.termB} 偏向 ${uniqueB.join('/') || '日常场景'}。`,
      why: `共享搭配: ${shared.join('/') || '较少'}。`
    },
    {
      dimension: 'specificity',
      a: `${candidate.termA} 语义边界更聚焦，适合精确定义。`,
      b: `${candidate.termB} 语义边界更宽，适合上下文扩展。`,
      why: `候选分 ${candidate.candidateScore}，需结合上下文。`
    },
    {
      dimension: 'jp_mapping',
      a: (snapshot.termA.zhExplanations || [])[0] || `${candidate.termA} 对应映射需复核。`,
      b: (snapshot.termB.zhExplanations || [])[0] || `${candidate.termB} 对应映射需复核。`,
      why: '日语映射基于历史卡片释义与例句。'
    },
    {
      dimension: 'collocation',
      a: uniqueA.join(' / ') || '暂无稳定搭配',
      b: uniqueB.join(' / ') || '暂无稳定搭配',
      why: '基于历史例句与释义抽取关键词。'
    }
  ];

  const misuseRisks = [
    {
      scenario: `在需要区分 ${candidate.termA}/${candidate.termB} 的正式说明中混用`,
      risk: '可能导致语气和语义边界不清，影响可读性。',
      severity: riskLevel
    }
  ];

  const jpNuance = {
    a: (snapshot.termA.jaExamples || [])[0] || '',
    b: (snapshot.termB.jaExamples || [])[0] || '',
    note: '建议结合日语例句语境确认词义边界。'
  };

  const boundaryTagsA = Array.from(new Set(uniqueA.concat(shared).slice(0, 6)));
  const boundaryTagsB = Array.from(new Set(uniqueB.concat(shared).slice(0, 6)));
  const actionableHint = `表达偏 ${uniqueA[0] || '分析'} 语境优先 ${candidate.termA}；偏 ${uniqueB[0] || '日常'} 语境优先 ${candidate.termB}。`;

  return {
    pair: { termA: candidate.termA, termB: candidate.termB },
    contextSplit,
    misuseRisks,
    jpNuance,
    boundaryTags: { a: boundaryTagsA, b: boundaryTagsB },
    confidence,
    evidenceRefs: sourceIds,
    actionableHint,
    recommendation: actionableHint,
    riskLevel,
    coverageRatio,
    boundaryMatrix: {
      tone: `A:${uniqueA[0] || 'analysis'} / B:${uniqueB[0] || 'daily'}`,
      register: `共享搭配 ${shared.join('/') || '较少'}`,
      collocation: `A[${uniqueA.join('/')}], B[${uniqueB.join('/')}]`
    }
  };
}

function extractFirstJsonBlock(text) {
  const input = String(text || '').trim();
  if (!input) return '';
  if (input.startsWith('{') && input.endsWith('}')) return input;
  const start = input.indexOf('{');
  if (start < 0) return '';
  let depth = 0;
  for (let i = start; i < input.length; i += 1) {
    const ch = input[i];
    if (ch === '{') depth += 1;
    if (ch === '}') {
      depth -= 1;
      if (depth === 0) {
        return input.slice(start, i + 1);
      }
    }
  }
  return '';
}

function normalizeLlmSynonymResult(payload, fallback) {
  if (!payload || typeof payload !== 'object') return fallback;
  const pair = payload.pair && typeof payload.pair === 'object'
    ? payload.pair
    : fallback.pair;
  const contextSplit = Array.isArray(payload.contextSplit) && payload.contextSplit.length
    ? payload.contextSplit
    : fallback.contextSplit;
  const misuseRisks = Array.isArray(payload.misuseRisks) && payload.misuseRisks.length
    ? payload.misuseRisks
    : fallback.misuseRisks;
  const jpNuance = payload.jpNuance && typeof payload.jpNuance === 'object'
    ? payload.jpNuance
    : fallback.jpNuance;
  const boundaryTags = payload.boundaryTags && typeof payload.boundaryTags === 'object'
    ? payload.boundaryTags
    : fallback.boundaryTags;
  const confidence = Number(payload.confidence);
  return {
    ...fallback,
    pair: {
      termA: normalizeText(pair.termA || fallback.pair.termA),
      termB: normalizeText(pair.termB || fallback.pair.termB)
    },
    contextSplit,
    misuseRisks,
    jpNuance,
    boundaryTags: {
      a: Array.isArray(boundaryTags.a) ? boundaryTags.a.slice(0, 8) : fallback.boundaryTags.a,
      b: Array.isArray(boundaryTags.b) ? boundaryTags.b.slice(0, 8) : fallback.boundaryTags.b
    },
    confidence: Number.isFinite(confidence) ? Number(Math.min(1, Math.max(0, confidence)).toFixed(3)) : fallback.confidence,
    actionableHint: normalizeText(payload.actionableHint || fallback.actionableHint) || fallback.actionableHint,
    recommendation: normalizeText(payload.actionableHint || fallback.recommendation) || fallback.recommendation
  };
}

function buildSynonymBoundaryPrompt({ candidate, snapshot, fallbackResult, config }) {
  const schema = {
    pair: { termA: 'string', termB: 'string' },
    contextSplit: [{ dimension: 'register|specificity|jp_mapping|collocation', a: 'string', b: 'string', why: 'string' }],
    misuseRisks: [{ scenario: 'string', risk: 'string', severity: 'low|medium|high' }],
    jpNuance: { a: 'string', b: 'string', note: 'string' },
    boundaryTags: { a: ['string'], b: ['string'] },
    confidence: 0.0,
    evidenceRefs: [0],
    actionableHint: 'string'
  };
  return [
    '你是术语语义边界分析器，只能返回 JSON。',
    `task=synonym_boundary promptVersion=${config.promptVersion} schemaVersion=${config.schemaVersion}`,
    '禁止 markdown、禁止解释性前后缀、禁止新增字段。',
    `schema=${JSON.stringify(schema)}`,
    `candidate=${JSON.stringify({ pairKey: candidate.pairKey, termA: candidate.termA, termB: candidate.termB, candidateScore: candidate.candidateScore })}`,
    `evidence=${JSON.stringify(snapshot)}`,
    `fallback=${JSON.stringify(fallbackResult)}`,
    '仅输出一个 JSON 对象。'
  ].join('\n');
}

async function runSynonymBoundary(cards = [], taskOptions = {}) {
  const config = normalizeSynonymBoundaryOptions(taskOptions);
  const discovery = discoverSynonymCandidates(cards, config);
  const groups = [];
  const candidateRows = [];
  const llmLatencies = [];
  let llmAttempted = 0;
  let llmSuccess = 0;
  let llmFailed = 0;

  for (let idx = 0; idx < discovery.candidates.length; idx += 1) {
    const candidate = discovery.candidates[idx];
    const snapshotMeta = buildEvidenceSnapshot(candidate, discovery.termMap);
    const localResult = buildLocalBoundaryResult(candidate, snapshotMeta);

    let finalResult = localResult;
    let parseStatus = 'local';
    let llmLatencyMs = 0;
    let llmError = null;

    const shouldUseLlm = config.llmEnabled && idx < config.maxLlmPairs;
    if (shouldUseLlm) {
      llmAttempted += 1;
      const started = Date.now();
      try {
        const prompt = buildSynonymBoundaryPrompt({
          candidate,
          snapshot: snapshotMeta.snapshot,
          fallbackResult: localResult,
          config
        });
        const llmResp = await runGeminiCli(prompt, {
          model: config.model,
          timeoutMs: config.llmTimeoutMs,
          baseName: `synonym_${candidate.termA}_${candidate.termB}`
        });
        llmLatencyMs = Math.max(0, Date.now() - started);
        llmLatencies.push(llmLatencyMs);
        const jsonText = extractFirstJsonBlock(llmResp?.markdown || llmResp?.rawOutput || '');
        const parsed = JSON.parse(jsonText);
        finalResult = normalizeLlmSynonymResult(parsed, localResult);
        parseStatus = 'ok';
        llmSuccess += 1;
      } catch (err) {
        llmLatencyMs = Math.max(0, Date.now() - started);
        llmLatencies.push(llmLatencyMs);
        parseStatus = 'failed_parse';
        llmError = err.message || 'llm parse failed';
        llmFailed += 1;
      }
    } else if (config.llmEnabled) {
      parseStatus = 'skipped_budget';
    }

    const members = [];
    const pushMembers = (records = []) => {
      records.forEach((record) => {
        members.push({
          generationId: Number(record.id),
          term: normalizeText(record.phrase || ''),
          lang: profileLang(record.phrase || '')
        });
      });
    };
    pushMembers(snapshotMeta.termARecords);
    pushMembers(snapshotMeta.termBRecords);

    groups.push({
      groupKey: candidate.groupKey,
      pairKey: candidate.pairKey,
      termA: candidate.termA,
      termB: candidate.termB,
      members: members.slice(0, 12),
      boundaryMatrix: finalResult.boundaryMatrix || localResult.boundaryMatrix,
      misuseRisk: finalResult.riskLevel || localResult.riskLevel,
      riskLevel: finalResult.riskLevel || localResult.riskLevel,
      recommendation: finalResult.recommendation || localResult.recommendation,
      actionableHint: finalResult.actionableHint || localResult.actionableHint,
      confidence: Number(finalResult.confidence || localResult.confidence || 0.6),
      coverageRatio: Number(finalResult.coverageRatio || localResult.coverageRatio || 0.5),
      model: shouldUseLlm ? config.model : null,
      promptVersion: config.promptVersion,
      schemaVersion: config.schemaVersion,
      evidenceHash: snapshotMeta.evidenceHash,
      contextSplit: finalResult.contextSplit || localResult.contextSplit,
      misuseRisks: finalResult.misuseRisks || localResult.misuseRisks,
      jpNuance: finalResult.jpNuance || localResult.jpNuance,
      boundaryTagsA: finalResult.boundaryTags?.a || localResult.boundaryTags.a,
      boundaryTagsB: finalResult.boundaryTags?.b || localResult.boundaryTags.b,
      resultJson: finalResult,
      parseStatus
    });

    candidateRows.push({
      pairKey: candidate.pairKey,
      termA: candidate.termA,
      termB: candidate.termB,
      candidateScore: Number(candidate.candidateScore || 0),
      evidenceHash: snapshotMeta.evidenceHash,
      evidenceSnapshot: snapshotMeta.snapshot,
      status: parseStatus,
      llmLatencyMs,
      llmError
    });
  }

  const avgLatency = llmLatencies.length
    ? Number((llmLatencies.reduce((sum, val) => sum + val, 0) / llmLatencies.length).toFixed(2))
    : 0;
  const p95Latency = llmLatencies.length ? percentile(llmLatencies, 0.95) : 0;
  const jsonParseRate = llmAttempted > 0 ? Number((llmSuccess / llmAttempted).toFixed(4)) : 1;

  return {
    groups,
    candidates: candidateRows,
    stats: {
      candidateCount: candidateRows.length,
      llmAttempted,
      llmSuccessCount: llmSuccess,
      llmFailedCount: llmFailed,
      jsonParseRate,
      avgLlmLatencyMs: avgLatency,
      p95LlmLatencyMs: p95Latency
    },
    meta: {
      model: config.model || null,
      promptVersion: config.promptVersion,
      schemaVersion: config.schemaVersion,
      minCandidateScore: config.minCandidateScore,
      maxPairs: config.maxPairs,
      maxLlmPairs: config.maxLlmPairs,
      llmEnabled: config.llmEnabled
    }
  };
}

function runGrammarLink(cards = []) {
  const patternMap = new Map();
  cards.forEach((card) => {
    const sentences = extractJapaneseSentences(card.markdown_content || '');
    sentences.forEach((sentence) => {
      const patterns = detectGrammarPatterns(sentence);
      patterns.forEach((patternInfo) => {
        const key = patternInfo.pattern;
        if (!patternMap.has(key)) {
          patternMap.set(key, {
            pattern: key,
            explanationZh: patternInfo.explanationZh,
            confidence: 0.7,
            exampleRefs: []
          });
        }
        patternMap.get(key).exampleRefs.push({
          generationId: Number(card.id),
          sentence: sentence.slice(0, 140)
        });
      });
    });
  });

  return {
    patterns: Array.from(patternMap.values()).map((item) => ({
      ...item,
      exampleRefs: item.exampleRefs.slice(0, 50)
    }))
  };
}

function runCluster(cards = []) {
  const clusterDefs = [
    { key: 'engineering', label: '工程系统', desc: '架构、接口、性能与运维相关表达', keywords: ['api', 'queue', 'retry', 'latency', 'db', 'database', 'cache', 'docker', 'proxy', '可观测', '高可用', '重试'] },
    { key: 'communication', label: '沟通表达', desc: '解释、总结、转述与论述相关表达', keywords: ['简而言之', '也就是说', '要するに', 'つまり', '说明', '解释', '焦点', '舆论'] },
    { key: 'grammar', label: '日语语法', desc: '语法结构和句型模式', keywords: ['わけでもなく', '〜', '文法', 'grammar', '使い分け'] },
    { key: 'general', label: '通用词汇', desc: '未归类的常规词汇', keywords: [] }
  ];

  const clusters = clusterDefs.map((def) => ({
    clusterKey: def.key,
    label: def.label,
    description: def.desc,
    keywords: def.keywords,
    confidence: 0.6,
    cards: []
  }));

  cards.forEach((card) => {
    const haystack = normalizeText([
      card.phrase,
      card.en_translation,
      card.ja_translation,
      card.zh_translation,
      card.markdown_content
    ].join(' ')).toLowerCase();

    let matched = false;
    for (const cluster of clusters) {
      if (!cluster.keywords.length) continue;
      const hitCount = cluster.keywords.filter((keyword) => haystack.includes(String(keyword).toLowerCase())).length;
      if (hitCount > 0) {
        matched = true;
        cluster.cards.push({
          generationId: Number(card.id),
          score: Number((hitCount / cluster.keywords.length).toFixed(4))
        });
      }
    }
    if (!matched) {
      const fallback = clusters.find((cluster) => cluster.clusterKey === 'general');
      fallback.cards.push({
        generationId: Number(card.id),
        score: 0.2
      });
    }
  });

  return {
    clusters: clusters.filter((cluster) => cluster.cards.length > 0)
  };
}

function runIssuesAudit(cards = []) {
  const issues = [];
  const phraseMap = new Map();

  cards.forEach((card) => {
    const normalizedPhrase = normalizeText(card.phrase || '').toLowerCase();
    if (!normalizedPhrase) return;
    if (!phraseMap.has(normalizedPhrase)) phraseMap.set(normalizedPhrase, []);
    phraseMap.get(normalizedPhrase).push(card);
  });

  for (const [phrase, group] of phraseMap.entries()) {
    if (group.length <= 1) continue;
    group.forEach((card) => {
      issues.push({
        issueType: 'duplicate_phrase',
        severity: group.length >= 3 ? 'high' : 'medium',
        generationId: Number(card.id),
        phrase: card.phrase || '',
        fingerprint: hashFingerprint(['duplicate_phrase', phrase, String(card.id)]),
        detail: {
          phrase,
          duplicateCount: group.length,
          relatedIds: group.map((item) => item.id)
        }
      });
    });
  }

  cards.forEach((card) => {
    const markdown = String(card.markdown_content || '');
    const refs = markdown.match(/<audio\s+controls\s+src="([^"]+)"/g) || [];
    if (!refs.length) return;
    const mdPath = String(card.md_file_path || '');
    const dir = mdPath ? path.dirname(mdPath) : '';
    if (!dir || !fs.existsSync(dir)) return;

    const missing = [];
    refs.forEach((raw) => {
      const m = raw.match(/src="([^"]+)"/);
      const src = m ? m[1] : '';
      if (!src) return;
      const target = path.join(dir, src);
      if (!fs.existsSync(target)) {
        missing.push(src);
      }
    });
    if (missing.length > 0) {
      issues.push({
        issueType: 'audio_missing',
        severity: missing.length >= 2 ? 'high' : 'medium',
        generationId: Number(card.id),
        phrase: card.phrase || '',
        fingerprint: hashFingerprint(['audio_missing', String(card.id), missing.join('|')]),
        detail: {
          missingAudioFiles: missing,
          mdFilePath: mdPath
        }
      });
    }
  });

  cards.forEach((card) => {
    const markdown = String(card.markdown_content || '');
    if (String(card.card_type || 'trilingual') === 'trilingual') {
      const hasEnglish = /##\s*1\.\s*英文/.test(markdown);
      const hasJapanese = /##\s*2\./.test(markdown);
      const hasChinese = /##\s*3\.\s*中文/.test(markdown);
      if (!hasEnglish || !hasJapanese || !hasChinese) {
        issues.push({
          issueType: 'format_anomaly',
          severity: 'medium',
          generationId: Number(card.id),
          phrase: card.phrase || '',
          fingerprint: hashFingerprint(['format_anomaly', String(card.id), 'section_missing']),
          detail: {
            hasEnglish,
            hasJapanese,
            hasChinese
          }
        });
      }
    }
  });

  return { issues };
}

function wrapResult(task, result, inputCount) {
  const hasPayload = result && Object.keys(result).length > 0;
  return {
    task,
    status: hasPayload ? 'ok' : 'partial',
    warnings: [],
    errors: [],
    quality: {
      confidence: hasPayload ? 0.75 : 0.4,
      coverageRatio: inputCount > 0 ? 1 : 0
    },
    result: result || {}
  };
}

async function runTask(taskType, cards = [], taskOptions = {}) {
  const normalizedTask = String(taskType || '').trim().toLowerCase();
  switch (normalizedTask) {
    case 'summary':
      return wrapResult('summary', runSummary(cards), cards.length);
    case 'index':
      return wrapResult('index', runIndex(cards), cards.length);
    case 'synonym_boundary':
      return wrapResult('synonym_boundary', await runSynonymBoundary(cards, taskOptions), cards.length);
    case 'grammar_link':
      return wrapResult('grammar_link', runGrammarLink(cards), cards.length);
    case 'cluster':
      return wrapResult('cluster', runCluster(cards), cards.length);
    case 'issues_audit':
      return wrapResult('issues_audit', runIssuesAudit(cards), cards.length);
    default:
      return {
        task: normalizedTask || 'unknown',
        status: 'failed',
        warnings: [],
        errors: [`Unsupported task type: ${normalizedTask}`],
        quality: { confidence: 0, coverageRatio: 0 },
        result: {}
      };
  }
}

module.exports = {
  runTask
};
