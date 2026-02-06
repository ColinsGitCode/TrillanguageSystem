/**
 * Golden Examples Service
 *
 * 从数据库中提取高质量的生成结果作为 Few-shot 示例
 * 用于提升本地 LLM 的生成质量
 */

const db = require('./databaseService');

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
    let query = `
      SELECT
        g.id,
        g.phrase,
        g.llm_provider,
        g.markdown_content,
        g.created_at,
        om.quality_score,
        om.tokens_total,
        om.prompt_text,
        om.output_raw
      FROM generations g
      LEFT JOIN observability_metrics om ON g.id = om.generation_id
      WHERE g.llm_provider = ?
        AND g.markdown_content IS NOT NULL
        AND om.quality_score >= ?
      ORDER BY om.quality_score DESC, g.created_at DESC
      LIMIT ?
    `;

    const examples = db.prepare(query).all(
      config.provider,
      config.minQualityScore,
      config.limit
    );

    return examples.map(ex => formatExample(ex));
  } catch (error) {
    console.error('[GoldenExamples] Error extracting examples:', error);
    return [];
  }
}

/**
 * 格式化为 Few-shot 示例格式
 */
function formatExample(record) {
  return {
    input: record.phrase,
    output: record.markdown_content,
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
async function getRelevantExamples(currentPhrase, count = 3) {
  try {
    // 策略：优先选择与当前短语相似的高质量示例
    // 可以基于：1) 短语长度 2) 语言类型 3) 复杂度

    const phraseLength = currentPhrase.length;
    const isEnglish = /^[a-zA-Z\s]+$/.test(currentPhrase);
    const isChinese = /[\u4e00-\u9fa5]/.test(currentPhrase);

    let query = `
      SELECT
        g.phrase,
        g.markdown_content,
        om.quality_score,
        LENGTH(g.phrase) as phrase_length
      FROM generations g
      LEFT JOIN observability_metrics om ON g.id = om.generation_id
      WHERE g.llm_provider = 'gemini'
        AND om.quality_score >= 85
        AND g.markdown_content IS NOT NULL
    `;

    // 根据输入语言类型过滤
    if (isEnglish) {
      query += ` AND g.phrase GLOB '[a-zA-Z]*'`;
    } else if (isChinese) {
      query += ` AND g.phrase LIKE '%' || char(0x4e00, 0x9fa5) || '%'`;
    }

    query += `
      ORDER BY
        ABS(LENGTH(g.phrase) - ?) ASC,
        om.quality_score DESC
      LIMIT ?
    `;

    const examples = db.prepare(query).all(phraseLength, count);
    return examples.map(ex => formatExample(ex));
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

    const stats = db.prepare(query).get();

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

  const fewShotSection = `
以下是 ${examples.length} 个高质量生成示例（评分 > 85），请参考它们的格式和详细程度：

${examples.map((ex, idx) => `
### 示例 ${idx + 1}（质量评分: ${ex.qualityScore}）
**输入**: ${ex.input}

**输出**:
${ex.output.substring(0, 500)}...
`).join('\n')}

---

现在请按照上述示例的质量标准，为以下短语生成学习卡片：
`;

  return fewShotSection + '\n\n' + basePrompt;
}

module.exports = {
  extractGoldenExamples,
  getRelevantExamples,
  analyzeGoldenPatterns,
  buildEnhancedPrompt,
  EXTRACTION_STRATEGIES
};
