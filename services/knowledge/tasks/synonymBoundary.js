'use strict';

// synonym_boundary task — the largest and only async task. Pipeline:
// 1. collectTermRecords: bucket cards by normalized phrase
// 2. discoverSynonymCandidates: pair-wise jaccard over zh meaning tokens
//    + tag overlap, keep pairs above minCandidateScore
// 3. for each candidate: build evidence snapshot → build local boundary
//    result → optionally invoke Gemini (proxy or CLI) for richer payload
//    that supersedes the local result if it parses + validates
// 4. roll up groups + candidates + stats (latency p95, parse rate)

const crypto = require('crypto');
const { runGeminiCli } = require('../../geminiCliService');
const { runGeminiProxy } = require('../../geminiProxyService');
const {
  normalizeText,
  profileLang,
  inferTags,
  extractJapaneseSentences,
  getLlmResponseText,
  percentile,
} = require('../textUtils');

function normalizeTermKey(text) {
  return normalizeText(text || '')
    .toLowerCase()
    .replace(/[’']/g, "'")
    .replace(/[^a-z0-9぀-ヿ一-鿿\- ]/g, '')
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
    .split(/[,|/]/g)
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
  const tokens = input.match(/[a-z][a-z\-']{2,}|[぀-ヿ]{2,}|[一-鿿]{2,}/g) || [];
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

function normalizeOptions(options = {}) {
  const llmEnvEnabled = ['1', 'true', 'yes'].includes(String(process.env.KNOWLEDGE_SYNONYM_LLM_ENABLED || '').toLowerCase());
  const llmEnabled = options.llmEnabled == null ? llmEnvEnabled : Boolean(options.llmEnabled);
  const llmTransport = String(options.llmTransport || process.env.KNOWLEDGE_SYNONYM_LLM_TRANSPORT || 'proxy').trim().toLowerCase() === 'cli'
    ? 'cli'
    : 'proxy';
  return {
    minCandidateScore: Number(options.minCandidateScore == null ? 0.62 : options.minCandidateScore),
    maxPairs: Math.max(1, Number(options.maxPairs == null ? 120 : options.maxPairs)),
    maxLlmPairs: Math.max(0, Number(options.maxLlmPairs == null ? 24 : options.maxLlmPairs)),
    model: options.model || process.env.KNOWLEDGE_SYNONYM_MODEL || process.env.GEMINI_PROXY_MODEL || process.env.GEMINI_CLI_MODEL || '',
    schemaVersion: String(options.schemaVersion || '1.0.0'),
    promptVersion: String(options.promptVersion || 'syn-v1'),
    llmEnabled,
    llmTimeoutMs: Math.max(5000, Number(options.llmTimeoutMs || process.env.KNOWLEDGE_SYNONYM_LLM_TIMEOUT_MS || 120000)),
    llmTransport,
    llmGatewayUrl: options.llmGatewayUrl || process.env.KNOWLEDGE_SYNONYM_PROXY_URL || process.env.GEMINI_PROXY_URL || '',
    llmRetries: Math.max(0, Number(options.llmRetries == null ? (process.env.KNOWLEDGE_SYNONYM_LLM_RETRIES || 1) : options.llmRetries)),
    llmRetryDelayMs: Math.max(0, Number(options.llmRetryDelayMs == null ? (process.env.KNOWLEDGE_SYNONYM_LLM_RETRY_DELAY_MS || 1200) : options.llmRetryDelayMs)),
    proxyAuthMode: options.proxyAuthMode || process.env.KNOWLEDGE_SYNONYM_PROXY_AUTH_MODE || process.env.GEMINI_PROXY_AUTH_MODE,
    proxyApiKey: options.proxyApiKey || process.env.KNOWLEDGE_SYNONYM_PROXY_API_KEY || process.env.GEMINI_PROXY_API_KEY,
    proxyBearerToken: options.proxyBearerToken || process.env.KNOWLEDGE_SYNONYM_PROXY_BEARER_TOKEN || process.env.GEMINI_PROXY_BEARER_TOKEN,
    enforceGateway: options.enforceGateway
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

function validatePayload(payload, candidate) {
  if (!payload || typeof payload !== 'object') return false;
  if (!Array.isArray(payload.contextSplit) || payload.contextSplit.length === 0) return false;
  if (!Array.isArray(payload.misuseRisks) || payload.misuseRisks.length === 0) return false;
  if (!payload.jpNuance || typeof payload.jpNuance !== 'object') return false;
  if (!payload.boundaryTags || typeof payload.boundaryTags !== 'object') return false;
  if (!Array.isArray(payload.boundaryTags.a) || !Array.isArray(payload.boundaryTags.b)) return false;
  if (!payload.pair || typeof payload.pair !== 'object') return false;

  const terms = [normalizeText(payload.pair.termA), normalizeText(payload.pair.termB)].sort();
  const candidateTerms = [normalizeText(candidate.termA), normalizeText(candidate.termB)].sort();
  return terms[0] === candidateTerms[0] && terms[1] === candidateTerms[1];
}

function buildResponseValidator(candidate) {
  return (response) => {
    try {
      const jsonText = extractFirstJsonBlock(getLlmResponseText(response));
      if (!jsonText) return false;
      const parsed = JSON.parse(jsonText);
      return validatePayload(parsed, candidate);
    } catch (err) {
      return false;
    }
  };
}

function normalizeLlmResult(payload, fallback) {
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

function buildPrompt({ candidate, snapshot, fallbackResult, config }) {
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

async function run(cards = [], taskOptions = {}) {
  const config = normalizeOptions(taskOptions);
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
        const prompt = buildPrompt({
          candidate,
          snapshot: snapshotMeta.snapshot,
          fallbackResult: localResult,
          config
        });
        const baseName = `synonym_${candidate.termA}_${candidate.termB}`;
        const llmResp = config.llmTransport === 'cli'
          ? await runGeminiCli(prompt, {
              model: config.model,
              timeoutMs: config.llmTimeoutMs,
              baseName
            })
          : await runGeminiProxy(prompt, {
              model: config.model,
              timeoutMs: config.llmTimeoutMs,
              baseName,
              url: config.llmGatewayUrl || undefined,
              retries: config.llmRetries,
              retryDelayMs: config.llmRetryDelayMs,
              authMode: config.proxyAuthMode,
              apiKey: config.proxyApiKey,
              bearerToken: config.proxyBearerToken,
              enforceGateway: config.enforceGateway,
              validateSanitizedResponse: buildResponseValidator(candidate)
            });
        llmLatencyMs = Math.max(0, Date.now() - started);
        llmLatencies.push(llmLatencyMs);
        const jsonText = extractFirstJsonBlock(getLlmResponseText(llmResp));
        const parsed = JSON.parse(jsonText);
        if (!validatePayload(parsed, candidate)) {
          throw new Error('synonym boundary payload validation failed');
        }
        finalResult = normalizeLlmResult(parsed, localResult);
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
      llmTransport: config.llmTransport,
      promptVersion: config.promptVersion,
      schemaVersion: config.schemaVersion,
      minCandidateScore: config.minCandidateScore,
      maxPairs: config.maxPairs,
      maxLlmPairs: config.maxLlmPairs,
      llmEnabled: config.llmEnabled
    }
  };
}

module.exports = {
  run,
  // Exposed for the gemini-sanitize e2e regression and any future direct callers.
  _internal: {
    extractFirstJsonBlock,
    validatePayload,
    buildResponseValidator,
    normalizeLlmResult,
    buildPrompt,
  },
};
