/**
 * Golden Examples Service
 *
 * 从数据库中提取高质量的生成结果作为 Few-shot 示例
 * 用于提升本地 LLM 的生成质量
 */

const dbService = require('./databaseService');

/**
 * 提取 Golden Examples 的策略
 */
const EXTRACTION_STRATEGIES = {
  // 策略1: 高评分的 Gemini 结果
  HIGH_QUALITY_GEMINI: {
    provider: 'gemini',
    minQualityScore: 85,
    limit: 5
  },

  // 策略2: 对比模式中 Gemini 胜出的案例
  GEMINI_WINNER: {
    provider: 'gemini',
    winnerOnly: true,
    limit: 3
  },

  // 策略3: 多样性采样（不同类型的短语）
  DIVERSE_SAMPLING: {
    provider: 'gemini',
    minQualityScore: 80,
    diversityField: 'phrase',
    limit: 5
  }
};

const DEFAULT_MAX_OUTPUT_CHARS = Number(process.env.GOLDEN_EXAMPLE_MAX_CHARS || 900);

/**
 * 计算两个字符串之间的 bigram 相似度 (Dice coefficient)
 * 适用于中英日混合文本，无需分词依赖
 */
function bigramSimilarity(a, b) {
  const strA = String(a || '').toLowerCase().trim();
  const strB = String(b || '').toLowerCase().trim();
  if (!strA || !strB) return 0;
  if (strA === strB) return 1;
  const bigramsA = new Set();
  const bigramsB = new Set();
  for (let i = 0; i < strA.length - 1; i++) bigramsA.add(strA.slice(i, i + 2));
  for (let i = 0; i < strB.length - 1; i++) bigramsB.add(strB.slice(i, i + 2));
  if (!bigramsA.size || !bigramsB.size) return 0;
  let overlap = 0;
  for (const bg of bigramsA) { if (bigramsB.has(bg)) overlap++; }
  return (2 * overlap) / (bigramsA.size + bigramsB.size);
}

function clipText(raw, maxChars = DEFAULT_MAX_OUTPUT_CHARS) {
  const text = String(raw || '').trim();
  if (!text) return '';
  if (text.length <= maxChars) return text;
  const safe = Math.max(120, maxChars - 3);
  return `${text.slice(0, safe)}...`;
}

/**
 * 从数据库提取 Golden Examples
 * @param {string} strategy - 提取策略
 * @param {object} options - 额外选项
 * @returns {Promise<Array>} Golden examples
 */
async function extractGoldenExamples(strategy = 'HIGH_QUALITY_GEMINI', options = {}) {
  const config = EXTRACTION_STRATEGIES[strategy];
  if (!config) {
    throw new Error(`Unknown strategy: ${strategy}`);
  }

  try {
    const provider = options.provider || config.provider;
    const minScore = Number(options.minQualityScore || config.minQualityScore || 0);
    const limit = Number(options.limit || config.limit || 5);
    const outputMode = (options.outputMode || 'json').toLowerCase();

    let query = `
      SELECT
        g.id,
        g.phrase,
        g.llm_provider,
        g.markdown_content,
        g.created_at,
        om.quality_score,
        om.tokens_total,
        om.prompt_full,
        om.prompt_parsed,
        om.llm_output,
        om.metadata
      FROM generations g
      LEFT JOIN observability_metrics om ON g.id = om.generation_id
      WHERE g.llm_provider = ?
        AND g.markdown_content IS NOT NULL
        AND om.quality_score >= ?
      ORDER BY om.quality_score DESC, g.created_at DESC
      LIMIT ?
    `;

    const examples = dbService.db.prepare(query).all(
      provider,
      minScore,
      limit
    );

    return examples.map((ex) => formatExample(ex, {
      outputMode,
      maxOutputChars: Number(options.maxOutputChars || DEFAULT_MAX_OUTPUT_CHARS)
    }));
  } catch (error) {
    console.error('[GoldenExamples] Error extracting examples:', error);
    return [];
  }
}

function safeJsonParse(text) {
  if (!text || typeof text !== 'string') return null;
  try {
    return JSON.parse(text);
  } catch (err) {
    return null;
  }
}

function normalizeExampleOutput(record, outputMode, options = {}) {
  const maxOutputChars = Number(options.maxOutputChars || DEFAULT_MAX_OUTPUT_CHARS);
  if (outputMode === 'markdown') {
    const markdown = clipText(record.markdown_content || record.llm_output || '', maxOutputChars);
    return { outputText: markdown, outputObject: null };
  }

  const parsed = safeJsonParse(record.llm_output);
  if (parsed && typeof parsed === 'object') {
    const minimal = {
      markdown_content: clipText(parsed.markdown_content || record.markdown_content || '', maxOutputChars),
      audio_tasks: Array.isArray(parsed.audio_tasks) ? parsed.audio_tasks.slice(0, 6) : []
    };
    return { outputText: JSON.stringify(minimal, null, 2), outputObject: minimal };
  }

  const fallback = {
    markdown_content: clipText(record.markdown_content || record.llm_output || '', maxOutputChars),
    audio_tasks: []
  };
  return { outputText: JSON.stringify(fallback, null, 2), outputObject: fallback };
}

/**
 * 格式化为 Few-shot 示例格式
 */
function formatExample(record, options = {}) {
  const outputMode = (options.outputMode || 'json').toLowerCase();
  const { outputText } = normalizeExampleOutput(record, outputMode, options);
  return {
    input: record.phrase,
    output: outputText,
    qualityScore: record.quality_score,
    metadata: {
      generationId: record.id,
      provider: record.llm_provider,
      createdAt: record.created_at,
      tokens: record.tokens_total
    }
  };
}

/**
 * 根据当前输入选择最相关的 Few-shot examples
 * @param {string} currentPhrase - 当前要生成的短语
 * @param {number} count - 需要的示例数量
 * @returns {Promise<Array>} 相关示例
 */
async function getRelevantExamples(currentPhrase, count = 3, options = {}) {
  try {
    const phraseLength = currentPhrase.length;
    const isEnglish = /^[a-zA-Z\s]+$/.test(currentPhrase);
    const outputMode = (options.outputMode || 'json').toLowerCase();
    const minScore = Number(options.minQualityScore || 85);
    const provider = options.provider || 'gemini';
    const experimentId = String(options.experimentId || '').trim();
    const roundNumber = Number(options.roundNumber || 0);
    const maxOutputChars = Number(options.maxOutputChars || DEFAULT_MAX_OUTPUT_CHARS);
    const teacherFirst = options.teacherFirst !== false;

    // 优先复用同实验的 teacher 样本
    if (teacherFirst && experimentId) {
      const teacherQuery = `
        SELECT
          tr.id,
          tr.phrase,
          tr.provider AS llm_provider,
          tr.quality_score,
          tr.output_text AS llm_output,
          tr.output_text AS markdown_content,
          tr.created_at,
          NULL AS tokens_total
        FROM teacher_references tr
        WHERE tr.experiment_id = ?
          AND tr.round_number <= ?
          AND tr.quality_score >= ?
        ORDER BY
          ABS(LENGTH(tr.phrase) - ?) ASC,
          tr.quality_score DESC,
          tr.updated_at DESC
        LIMIT ?
      `;

      const teacherExamples = dbService.db.prepare(teacherQuery).all(
        experimentId,
        roundNumber,
        minScore,
        phraseLength,
        count
      );

      if (teacherExamples.length) {
        return teacherExamples.map((ex) => formatExample(ex, {
          outputMode,
          maxOutputChars
        }));
      }
    }

    // 查询候选集（扩大范围取 count*5，后续在 JS 层按相似度重排）
    const candidateLimit = Math.max(count * 5, 15);
    let query = `
      SELECT
        g.id,
        g.llm_provider,
        g.phrase,
        g.markdown_content,
        g.created_at,
        om.quality_score,
        om.llm_output,
        om.tokens_total
      FROM generations g
      LEFT JOIN observability_metrics om ON g.id = om.generation_id
      WHERE g.llm_provider = ?
        AND om.quality_score >= ?
        AND g.markdown_content IS NOT NULL
    `;

    // 根据输入语言类型过滤
    if (isEnglish) {
      query += ` AND g.phrase GLOB '[a-zA-Z]*'`;
    }

    query += `
      ORDER BY om.quality_score DESC
      LIMIT ?
    `;

    const candidates = dbService.db.prepare(query).all(provider, minScore, candidateLimit);

    // 按 bigram 关键词相似度重排，取 top-N
    const scored = candidates.map((ex) => ({
      ...ex,
      _similarity: bigramSimilarity(currentPhrase, ex.phrase)
    }));
    scored.sort((a, b) => {
      // 优先相似度，相似度相同时按 quality 排序
      const simDiff = b._similarity - a._similarity;
      if (Math.abs(simDiff) > 0.01) return simDiff;
      return (b.quality_score || 0) - (a.quality_score || 0);
    });

    const examples = scored.slice(0, count);
    return examples.map((ex) => formatExample(ex, {
      outputMode,
      maxOutputChars
    }));
  } catch (error) {
    console.error('[GoldenExamples] Error getting relevant examples:', error);
    return [];
  }
}

/**
 * 分析高质量案例的共同特征
 * @returns {Promise<Object>} 特征分析结果
 */
async function analyzeGoldenPatterns() {
  try {
    const query = `
      SELECT
        AVG(om.quality_score) as avg_quality,
        AVG(om.tokens_total) as avg_tokens,
        AVG(LENGTH(g.markdown_content)) as avg_content_length,
        COUNT(*) as total_count
      FROM generations g
      LEFT JOIN observability_metrics om ON g.id = om.generation_id
      WHERE g.llm_provider = 'gemini'
        AND om.quality_score >= 85
    `;

    const stats = dbService.db.prepare(query).get();

    return {
      goldenStandards: {
        avgQualityScore: stats.avg_quality,
        avgTokens: stats.avg_tokens,
        avgContentLength: stats.avg_content_length,
        sampleSize: stats.total_count
      },
      recommendations: generateRecommendations(stats)
    };
  } catch (error) {
    console.error('[GoldenExamples] Error analyzing patterns:', error);
    return null;
  }
}

function generateRecommendations(stats) {
  const recommendations = [];

  if (stats.avg_tokens > 1500) {
    recommendations.push('高质量输出通常包含更详细的例句（平均 tokens > 1500）');
  }

  if (stats.avg_content_length > 800) {
    recommendations.push('建议生成内容长度 > 800 字符以保证完整性');
  }

  return recommendations;
}

/**
 * 构建增强版 Prompt（包含 Few-shot examples）
 * @param {string} basePrompt - 基础 Prompt
 * @param {Array} examples - Few-shot 示例
 * @returns {string} 增强后的 Prompt
 */
function buildEnhancedPrompt(basePrompt, examples) {
  if (!examples || examples.length === 0) {
    return basePrompt;
  }

  const exampleBlocks = examples.map((ex, idx) => [
    `### 示例 ${idx + 1}（质量评分: ${ex.qualityScore || 'N/A'}）`,
    `输入: ${String(ex.input || '').trim()}`,
    '输出示例:',
    String(ex.output || '').trim()
  ].join('\n')).join('\n\n');

  const fewShotSection = [
    `请参考以下 ${examples.length} 个高质量示例，仅学习结构与细节层级，不要照抄具体文本。`,
    '严格遵循输出格式，并保证字段完整。',
    '',
    exampleBlocks,
    '',
    '---',
    '',
    '现在请基于下面任务生成结果：'
  ].join('\n');

  return `${fewShotSection}\n\n${basePrompt}`;
}

module.exports = {
  extractGoldenExamples,
  getRelevantExamples,
  analyzeGoldenPatterns,
  buildEnhancedPrompt,
  EXTRACTION_STRATEGIES
};
