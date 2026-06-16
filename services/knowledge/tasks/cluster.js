'use strict';

// cluster task — semantic classification of cards into a curated taxonomy.
// Two-track: japanese-grammar cards (card_type === 'grammar_ja') are placed on
// the communicative-`function` axis, all other cards on the subject-`topic`
// axis (see services/knowledge/taxonomy.js).
//
// Pipeline per axis:
//   1. rule pass — keyword match each card against the axis categories; the
//      best-scoring category wins.
//   2. LLM fallback (optional, default on) — cards the rules could not place
//      are batched to DeepSeek, which assigns each to one axis category. Any
//      card the model declines / mis-labels lands in the axis fallback bucket.
//
// Output shape is unchanged from the legacy version (`{ clusters: [...] }`)
// plus a `taxonomy` field per cluster, so the persistence layer keeps working.

const { normalizeText } = require('../textUtils');
const { generateJson } = require('../../llm/deepseekService');
const { resolveDeepSeekModel } = require('../../../lib/serverConfig');
const {
  axisForCardType,
  getTaxonomy,
  getFallbackKey,
  getCategory,
  assignableKeys,
} = require('../taxonomy');

function boolFromEnv(name, defaultValue) {
  const raw = process.env[name];
  if (raw == null || raw === '') return defaultValue;
  return ['1', 'true', 'yes'].includes(String(raw).toLowerCase());
}

function normalizeOptions(options = {}) {
  const envEnabled = boolFromEnv('KNOWLEDGE_CLUSTER_LLM_ENABLED', true);
  const llmEnabled = options.llmEnabled == null ? envEnabled : Boolean(options.llmEnabled);
  return {
    llmEnabled,
    // Hard ceiling on cards sent to the model per job (across both axes).
    maxLlmCards: Math.max(0, Number(options.maxLlmCards == null ? (process.env.KNOWLEDGE_CLUSTER_MAX_LLM_CARDS || 80) : options.maxLlmCards)),
    llmBatchSize: Math.max(1, Number(options.llmBatchSize == null ? (process.env.KNOWLEDGE_CLUSTER_LLM_BATCH_SIZE || 20) : options.llmBatchSize)),
    model: resolveDeepSeekModel(options.model || process.env.KNOWLEDGE_CLUSTER_MODEL || process.env.DEEPSEEK_MODEL),
    llmTimeoutMs: Math.max(5000, Number(options.llmTimeoutMs || process.env.KNOWLEDGE_CLUSTER_LLM_TIMEOUT_MS || 120000)),
    // Test seam: callers (unit tests) can inject an async (prompt) => text|obj
    // to avoid real network. Production never sets this.
    llmInvoke: typeof options.llmInvoke === 'function' ? options.llmInvoke : null
  };
}

function cardHaystack(card) {
  return normalizeText([
    card.phrase,
    card.en_translation,
    card.ja_translation,
    card.zh_translation,
    card.markdown_content
  ].join(' ')).toLowerCase();
}

// Rule pass: returns { categoryKey, score } for the best keyword match, or
// null when nothing matched.
function ruleClassify(haystack, taxonomy) {
  let best = null;
  for (const category of taxonomy) {
    if (!category.keywords.length) continue;
    const hits = category.keywords.filter((kw) => haystack.includes(String(kw).toLowerCase()));
    if (hits.length > 0) {
      const score = Number(Math.min(0.95, 0.55 + hits.length * 0.1).toFixed(4));
      if (!best || score > best.score) {
        best = { categoryKey: category.key, score, hits: hits.length };
      }
    }
  }
  return best;
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
      if (depth === 0) return input.slice(start, i + 1);
    }
  }
  return '';
}

function responseToText(response) {
  if (response == null) return '';
  if (typeof response === 'string') return response;
  if (typeof response === 'object') {
    return String(response.markdown || response.rawOutput || response.output || response.text || '');
  }
  return String(response);
}

function buildLlmPrompt(axis, cards) {
  const categories = getTaxonomy(axis)
    .filter((cat) => cat.key !== getFallbackKey(axis))
    .map((cat) => ({ key: cat.key, label: cat.label, desc: cat.desc }));
  const items = cards.map((card) => ({
    id: Number(card.id),
    phrase: normalizeText(card.phrase || '').slice(0, 80),
    zh: normalizeText(card.zh_translation || '').slice(0, 60),
    en: normalizeText(card.en_translation || '').slice(0, 60),
    ja: normalizeText(card.ja_translation || '').slice(0, 60)
  }));
  const axisHint = axis === 'function'
    ? '按日语句式的“交际功能”归类（例如疑问、建议、比较、因果）。'
    : '按词条的“主题领域”归类（例如工程技术、AI与数据、商务职场）。';
  return [
    '你是知识卡片语义归类器，只能返回 JSON。',
    `task=cluster axis=${axis}`,
    axisHint,
    '为每张卡片从 categories 中选择最合适的一个 key；若无合适项可省略该卡片。',
    '禁止 markdown、禁止解释性前后缀、禁止新增字段、禁止臆造 key。',
    'schema={"assignments":[{"id":0,"categoryKey":"string","confidence":0.0}]}',
    `categories=${JSON.stringify(categories)}`,
    `cards=${JSON.stringify(items)}`,
    '仅输出一个 JSON 对象。'
  ].join('\n');
}

async function invokeLlm(prompt, config, baseName) {
  if (config.llmInvoke) return config.llmInvoke(prompt);
  void baseName;
  return generateJson(prompt, {
    model: config.model,
    timeoutMs: config.llmTimeoutMs
  });
}

// Returns Map<id, { categoryKey, score }> for the cards the model placed.
async function llmClassify(axis, cards, config, stats) {
  const result = new Map();
  if (!cards.length) return result;
  const validKeys = new Set(assignableKeys(axis));
  const idSet = new Set(cards.map((c) => Number(c.id)));

  for (let i = 0; i < cards.length; i += config.llmBatchSize) {
    const batch = cards.slice(i, i + config.llmBatchSize);
    stats.llmAttempted += 1;
    try {
      const prompt = buildLlmPrompt(axis, batch);
      const response = await invokeLlm(prompt, config, `cluster_${axis}_${i}`);
      const jsonText = extractFirstJsonBlock(responseToText(response));
      const parsed = JSON.parse(jsonText);
      const assignments = Array.isArray(parsed.assignments) ? parsed.assignments : [];
      let placed = 0;
      assignments.forEach((row) => {
        const id = Number(row && row.id);
        const key = String(row && row.categoryKey || '').trim();
        if (!idSet.has(id) || !validKeys.has(key)) return;
        const confidence = Number(row.confidence);
        result.set(id, {
          categoryKey: key,
          score: Number.isFinite(confidence) ? Number(Math.min(0.95, Math.max(0.3, confidence)).toFixed(4)) : 0.55
        });
        placed += 1;
      });
      if (placed > 0) stats.llmSuccess += 1;
      else stats.llmFailed += 1;
    } catch (err) {
      stats.llmFailed += 1;
      stats.lastError = err.message || 'cluster llm classify failed';
    }
  }
  return result;
}

async function run(cards = [], taskOptions = {}) {
  const config = normalizeOptions(taskOptions);
  const stats = { llmAttempted: 0, llmSuccess: 0, llmFailed: 0, ruleMatched: 0, llmMatched: 0, fallback: 0, lastError: null };

  // clusterKey -> { axis, cards: [{ generationId, score }] }
  const buckets = new Map();
  const ensureBucket = (key, axis) => {
    if (!buckets.has(key)) buckets.set(key, { axis, cards: [] });
    return buckets.get(key);
  };

  // 1. Split by axis and run the rule pass; collect unmatched per axis.
  const unmatchedByAxis = { function: [], topic: [] };
  cards.forEach((card) => {
    if (!card || !card.id) return;
    const axis = axisForCardType(card.card_type);
    const taxonomy = getTaxonomy(axis);
    const match = ruleClassify(cardHaystack(card), taxonomy);
    if (match) {
      stats.ruleMatched += 1;
      ensureBucket(match.categoryKey, axis).cards.push({ generationId: Number(card.id), score: match.score });
    } else {
      unmatchedByAxis[axis].push(card);
    }
  });

  // 2. LLM fallback for unmatched cards (budget-capped, default on).
  let llmBudget = config.llmEnabled ? config.maxLlmCards : 0;
  for (const axis of ['function', 'topic']) {
    const unmatched = unmatchedByAxis[axis];
    if (!unmatched.length) continue;

    const llmTargets = llmBudget > 0 ? unmatched.slice(0, llmBudget) : [];
    llmBudget -= llmTargets.length;
    const assigned = llmTargets.length
      ? await llmClassify(axis, llmTargets, config, stats)
      : new Map();

    unmatched.forEach((card) => {
      const id = Number(card.id);
      const llmHit = assigned.get(id);
      if (llmHit) {
        stats.llmMatched += 1;
        ensureBucket(llmHit.categoryKey, axis).cards.push({ generationId: id, score: llmHit.score });
      } else {
        stats.fallback += 1;
        ensureBucket(getFallbackKey(axis), axis).cards.push({ generationId: id, score: 0.2 });
      }
    });
  }

  // 3. Materialize clusters from buckets, decorated with taxonomy metadata.
  const clusters = [];
  for (const [clusterKey, bucket] of buckets.entries()) {
    if (!bucket.cards.length) continue;
    const category = getCategory(bucket.axis, clusterKey);
    if (!category) continue;
    const avgScore = bucket.cards.reduce((sum, c) => sum + Number(c.score || 0), 0) / bucket.cards.length;
    clusters.push({
      clusterKey,
      label: category.label,
      description: category.desc,
      keywords: category.keywords,
      taxonomy: bucket.axis,
      confidence: Number(Math.min(0.95, Math.max(0.3, avgScore)).toFixed(4)),
      cards: bucket.cards
    });
  }

  return {
    clusters,
    meta: {
      llmEnabled: config.llmEnabled,
      llmProvider: 'deepseek',
      model: config.model,
      stats
    }
  };
}

module.exports = {
  run,
  _internal: {
    normalizeOptions,
    ruleClassify,
    extractFirstJsonBlock,
    responseToText,
    buildLlmPrompt,
    llmClassify,
  },
};
