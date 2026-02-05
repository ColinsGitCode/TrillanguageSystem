require('dotenv').config();
const { parseTrilingualMarkdown } = require('./markdownParser');

/**
 * 可观测性服务 - 统一管理 Token、性能、质量等指标
 * 功能：
 * - F1: Token 计数与成本估算
 * - F2: 性能监控
 * - F7: 质量评分
 * - F5: Prompt 结构化解析
 */

// ========== F1: Token 计数器 ==========
class TokenCounter {
  /**
   * 估算 Token 数量（简单估算：1 token ≈ 4 字符）
   * @param {string} text - 文本内容
   * @returns {number} 估算的 token 数量
   */
  static estimate(text) {
    if (!text || typeof text !== 'string') return 0;
    return Math.ceil(text.length / 4);
  }

  /**
   * 从 Gemini API 响应提取 Token 信息
   * @param {Object} response - Gemini API 原始响应
   * @returns {Object} Token 使用信息
   */
  static extractGeminiTokens(response) {
    // Gemini API 的 usageMetadata 可能在不同位置
    const usage = response?.usageMetadata || response?.usage;

    if (!usage) {
      // 如果没有 usage 信息，尝试估算
      console.warn('[TokenCounter] No usage metadata found, estimating tokens');
      return {
        input: 0,
        output: 0,
        total: 0,
        cached: 0
      };
    }

    return {
      input: usage.promptTokenCount || 0,
      output: usage.candidatesTokenCount || 0,
      total: usage.totalTokenCount || 0,
      cached: usage.cachedContentTokenCount || 0
    };
  }

  /**
   * 从 OpenAI 兼容响应提取 Token 信息
   * @param {Object} response - OpenAI 兼容的 API 响应
   * @returns {Object} Token 使用信息
   */
  static extractOpenAITokens(response) {
    const usage = response?.usage;

    if (!usage) {
      console.warn('[TokenCounter] No usage info found, estimating tokens');
      return {
        input: 0,
        output: 0,
        total: 0
      };
    }

    return {
      input: usage.prompt_tokens || 0,
      output: usage.completion_tokens || 0,
      total: usage.total_tokens || 0
    };
  }

  /**
   * 计算成本（基于不同 provider）
   * @param {Object} tokens - Token 使用信息
   * @param {string} provider - LLM 提供商 ('gemini' | 'local')
   * @returns {Object} 成本信息
   */
  static calculateCost(tokens, provider) {
    if (provider === 'gemini') {
      // Gemini 1.5 Flash 免费层 - 实际免费
      // 付费价格参考（如需切换到付费）：
      // Input: $0.075 per 1M tokens
      // Output: $0.30 per 1M tokens
      return {
        input: 0,
        output: 0,
        total: 0
      };
    }

    if (provider === 'local') {
      // 本地 LLM - 免费
      return {
        input: 0,
        output: 0,
        total: 0
      };
    }

    // 默认返回 0
    return {
      input: 0,
      output: 0,
      total: 0
    };
  }
}

// ========== F2: 性能监控器 ==========
class PerformanceMonitor {
  constructor() {
    this.startTime = null;
    this.lastMark = null;
    this.phases = {};
  }

  /**
   * 开始性能监控
   * @returns {PerformanceMonitor} 返回自身以支持链式调用
   */
  start() {
    this.startTime = Date.now();
    this.lastMark = this.startTime;
    this.phases = {};
    return this;
  }

  /**
   * 标记一个阶段
   * @param {string} phaseName - 阶段名称
   * @returns {PerformanceMonitor} 返回自身以支持链式调用
   */
  mark(phaseName) {
    const now = Date.now();
    this.phases[phaseName] = now - this.lastMark;
    this.lastMark = now;
    return this;
  }

  /**
   * 结束性能监控并返回结果
   * @returns {Object} 性能数据
   */
  end() {
    const totalTime = Date.now() - this.startTime;

    return {
      totalTime,
      phases: this.phases,
      networkLatency: this.phases.llmCall || 0,
      serverProcessing: totalTime - (this.phases.llmCall || 0)
    };
  }
}

// ========== F7: 质量检查器 ==========
class QualityChecker {
  /**
   * 检查生成内容质量
   * @param {Object} content - LLM 生成的内容
   * @param {string} expectedPhrase - 用户输入的短语
   * @returns {Object} 质量评估结果
   */
  static check(content, expectedPhrase) {
    const parsed = parseTrilingualMarkdown(content?.markdown_content || '');
    const templateCompliance = this.calculateTemplateCompliance(parsed);

    // 执行各项检查
    const checks = {
      jsonValid: this.isValidJSON(content),
      fieldsComplete: this.hasRequiredFields(content),
      translationAccuracy: this.checkTranslation(content, expectedPhrase),
      exampleSentenceQuality: this.checkExampleQuality(content),
      audioTasksGenerated: this.hasAudioTasks(content),
      templateCompliance
    };

    // 计算各维度得分（标准化维度名称）
    const dimensions = {
      completeness: this.calculateCompletenessScore(checks, content),     // 完整性 (40分)
      accuracy: this.calculateAccuracyScore(content, expectedPhrase),     // 准确性 (30分)
      exampleQuality: this.calculateExampleScore(content, parsed),          // 例句质量 (20分)
      formatting: this.calculateFormattingScore(content, parsed, templateCompliance) // 格式规范 (10分)
    };

    // 计算综合得分
    const score = this.calculateOverallScore(dimensions);

    // 生成警告和建议
    const warnings = this.generateWarnings(checks, dimensions);
    const suggestions = this.generateSuggestions(warnings);

    return {
      score,
      checks,
      dimensions,
      templateCompliance,
      warnings,
      suggestions
    };
  }

  /**
   * 检查是否为有效 JSON 对象
   */
  static isValidJSON(content) {
    return typeof content === 'object' && content !== null;
  }

  /**
   * 检查必需字段是否完整
   */
  static hasRequiredFields(content) {
    const required = ['markdown_content', 'html_content'];
    return required.every(field =>
      typeof content[field] === 'string' && content[field].trim()
    );
  }

  /**
   * 检查翻译准确性
   */
  static checkTranslation(content, phrase) {
    const markdown = content.markdown_content || '';
    const hasPhrase = markdown.toLowerCase().includes(String(phrase || '').toLowerCase());
    if (!hasPhrase) return 'poor';

    const parsed = parseTrilingualMarkdown(markdown);
    const hasEn = !!parsed.sections.en.translation;
    const hasJa = !!parsed.sections.ja.translation;
    const hasZh = !!parsed.sections.zh.translation;
    const languageCount = [hasEn, hasJa, hasZh].filter(Boolean).length;

    if (languageCount >= 3) return 'excellent';
    if (languageCount >= 2) return 'good';
    return 'fair';
  }

  /**
   * 检查例句质量
   */
  static checkExampleQuality(content) {
    const parsed = parseTrilingualMarkdown(content?.markdown_content || '');
    const examples = [
      ...(parsed.sections.en.examples || []),
      ...(parsed.sections.ja.examples || [])
    ];

    if (examples.length < 2) return 'poor';
    if (examples.length < 3) return 'fair';

    const avgLength = examples.reduce((sum, ex) => {
      const text = ex.text || '';
      if (/[a-zA-Z]/.test(text)) {
        return sum + text.split(/\s+/).filter(Boolean).length;
      }
      return sum + text.length;
    }, 0) / examples.length;

    if (avgLength >= 8 && avgLength <= 20) return 'excellent';
    if (avgLength >= 5 && avgLength <= 25) return 'good';
    return 'fair';
  }

  /**
   * 检查是否有音频任务
   */
  static hasAudioTasks(content) {
    return Array.isArray(content.audio_tasks) && content.audio_tasks.length > 0;
  }

  /**
   * 计算完整性得分 (40分)
   * 检查结构完整性和必需字段
   */
  static calculateCompletenessScore(checks, content) {
    let score = 0;

    // JSON有效性 (10分)
    if (checks.jsonValid) score += 10;

    // 必需字段完整 (15分)
    if (checks.fieldsComplete) score += 15;

    // 音频任务存在 (10分)
    if (checks.audioTasksGenerated) score += 10;

    // 内容长度合理 (5分)
    const markdown = content.markdown_content || '';
    if (markdown.length > 500) score += 5;

    return score;
  }

  /**
   * 计算准确性得分 (30分)
   * 评估翻译准确性和语言覆盖
   */
  static calculateAccuracyScore(content, phrase) {
    const markdown = content.markdown_content || '';
    let score = 0;

    // 包含原短语 (5分)
    if (markdown.toLowerCase().includes(phrase.toLowerCase())) {
      score += 5;
    }

    // 三语覆盖 (15分)
    const hasChinese = /[\u4e00-\u9fa5]/.test(markdown);
    const hasEnglish = /[a-zA-Z]/.test(markdown);
    const hasJapanese = /[\u3040-\u309f\u30a0-\u30ff]/.test(markdown);
    const languageCount = [hasChinese, hasEnglish, hasJapanese].filter(Boolean).length;

    if (languageCount === 3) score += 15;
    else if (languageCount === 2) score += 10;
    else if (languageCount === 1) score += 5;

    // 结构化章节 (10分)
    const sectionCount = (markdown.match(/##/g) || []).length;
    if (sectionCount >= 3) score += 10;
    else if (sectionCount >= 2) score += 5;

    return score;
  }

  /**
   * 计算例句质量得分 (20分)
   * 评估例句数量、长度和质量
   */
  static calculateExampleScore(content, parsed) {
    const examples = [
      ...(parsed?.sections?.en?.examples || []),
      ...(parsed?.sections?.ja?.examples || [])
    ];
    let score = 0;

    // 例句数量 (8分)
    if (examples.length >= 3) score += 8;
    else if (examples.length >= 2) score += 5;
    else if (examples.length >= 1) score += 2;

    // 平均长度合理 (8分)
    if (examples.length > 0) {
      const avgLength = examples.reduce((sum, ex) => {
        const text = ex.text || '';
        if (/[a-zA-Z]/.test(text)) {
          return sum + text.split(/\s+/).filter(Boolean).length;
        }
        return sum + text.length;
      }, 0) / examples.length;

      // 理想长度：8-20 个单词
      if (avgLength >= 8 && avgLength <= 20) score += 8;
      else if (avgLength >= 5 && avgLength <= 25) score += 5;
      else score += 2;
    }

    // 例句多样性 (4分)
    if (examples.length > 0) {
      const uniqueStarts = new Set(examples.map(ex => (ex.text || '').split(/\s+/)[0]?.toLowerCase()));
      if (uniqueStarts.size >= examples.length * 0.8) score += 4;
      else if (uniqueStarts.size >= examples.length * 0.6) score += 2;
    }

    return score;
  }

  /**
   * 计算格式规范得分 (10分)
   * 检查格式化和特殊标记
   */
  static calculateFormattingScore(content, parsed, templateCompliance) {
    const markdown = content.markdown_content || '';
    let score = 0;

    // 模板一致性 (4分)
    if (typeof templateCompliance === 'number') {
      score += Math.round((templateCompliance / 100) * 4);
    }

    // 日文注音（Ruby标记） (3分)
    const hasRuby = /\(.+?\)/.test(markdown);
    if (hasRuby) score += 3;

    // 标题层级结构 (2分)
    const hasH1 = /#\s+/.test(markdown);
    const hasH2 = /##\s+/.test(markdown);
    if (hasH1 && hasH2) score += 2;
    else if (hasH1 || hasH2) score += 1;

    // 音频标记格式 (1分)
    const hasAudioMarks = /\{\{[a-z]{2}-audio-\d+\}\}/.test(markdown);
    if (hasAudioMarks) score += 1;

    return Math.min(10, score);
  }

  static calculateTemplateCompliance(parsed) {
    const required = [];
    required.push(parsed?.title);

    const en = parsed?.sections?.en || {};
    const ja = parsed?.sections?.ja || {};
    const zh = parsed?.sections?.zh || {};

    required.push(en.translation, en.explanation);
    required.push(en.examples?.[0]?.text, en.examples?.[0]?.translation);
    required.push(en.examples?.[1]?.text, en.examples?.[1]?.translation);

    required.push(ja.translation, ja.explanation);
    required.push(ja.examples?.[0]?.text, ja.examples?.[0]?.translation);
    required.push(ja.examples?.[1]?.text, ja.examples?.[1]?.translation);

    required.push(zh.translation, zh.explanation);

    const filled = required.filter(Boolean).length;
    const total = required.length || 1;
    return Math.round((filled / total) * 100);
  }

  /**
   * 计算综合得分 (总分100)
   */
  static calculateOverallScore(dimensions) {
    // 直接求和，因为各维度已经按满分设计
    const score = dimensions.completeness +
                  dimensions.accuracy +
                  dimensions.exampleQuality +
                  dimensions.formatting;

    return Math.min(100, Math.max(0, Math.round(score)));
  }

  /**
   * 生成质量警告
   */
  static generateWarnings(checks, dimensions) {
    const warnings = [];

    if (!checks.jsonValid) warnings.push('JSON 格式无效');
    if (!checks.fieldsComplete) warnings.push('缺少必需字段');
    if (checks.translationAccuracy === 'poor') warnings.push('翻译准确性较低');
    if (checks.exampleSentenceQuality === 'poor') warnings.push('例句质量不佳');
    if (!checks.audioTasksGenerated) warnings.push('未生成音频任务');
    if (typeof checks.templateCompliance === 'number' && checks.templateCompliance < 80) {
      warnings.push('模板一致性不足');
    }
    if (dimensions.contentRichness < 60) warnings.push('内容丰富度偏低');

    return warnings;
  }

  /**
   * 生成改进建议
   */
  static generateSuggestions(warnings) {
    const suggestions = [];

    warnings.forEach(warning => {
      if (warning.includes('JSON')) {
        suggestions.push('检查 LLM 输出格式，确保返回有效 JSON');
      }
      if (warning.includes('例句')) {
        suggestions.push('调整 Prompt 中的例句质量标准');
      }
      if (warning.includes('音频')) {
        suggestions.push('确认 audio_tasks 字段生成逻辑');
      }
      if (warning.includes('模板一致性')) {
        suggestions.push('强化 Markdown 模板约束，确保字段与例句完整');
      }
      if (warning.includes('丰富度')) {
        suggestions.push('增加 Few-shot 示例的复杂度');
      }
    });

    // 去重
    return [...new Set(suggestions)];
  }
}

// ========== F5: Prompt 结构化解析器 ==========
class PromptParser {
  /**
   * 解析 Prompt 结构
   * @param {string} fullPrompt - 完整的 Prompt 文本
   * @returns {Object} 结构化的 Prompt 数据
   */
  static parse(fullPrompt) {
    if (!fullPrompt || typeof fullPrompt !== 'string') {
      return {
        full: '',
        structure: {
          systemInstruction: '',
          chainOfThought: [],
          fewShotExamples: [],
          qualityStandards: [],
          userInput: ''
        },
        metadata: {
          length: 0,
          tokenCount: 0,
          templateVersion: 'unknown'
        }
      };
    }

    const structure = {
      systemInstruction: '',
      chainOfThought: [],
      fewShotExamples: [],
      qualityStandards: [],
      userInput: ''
    };

    // 1. 提取 System Instruction（第一段到 "请严格按照以下步骤"）
    const sysMatch = fullPrompt.match(/^[\s\S]*?(?=请严格按照以下步骤|## 步骤|$)/);
    if (sysMatch) {
      structure.systemInstruction = sysMatch[0].trim();
    }

    // 2. 提取 Chain of Thought（步骤 1、2、3...）
    const cotMatches = fullPrompt.match(/(?:步骤|Step)\s*\d+[：:]\s*(.+?)(?=(?:步骤|Step)\s*\d+|## 示例|$)/gs);
    if (cotMatches) {
      structure.chainOfThought = cotMatches.map(s => s.trim());
    }

    // 3. 提取 Few-shot Examples
    const exampleMatches = fullPrompt.match(/###\s*示例\s*\d+[：:](.+?)(?=###\s*示例|## 质量标准|$)/gs);
    if (exampleMatches) {
      structure.fewShotExamples = exampleMatches.map(ex => {
        const titleMatch = ex.match(/###\s*示例\s*\d+[：:]\s*(.+)/);
        return {
          title: titleMatch ? titleMatch[1].trim() : '示例',
          content: ex.trim()
        };
      });
    }

    // 4. 提取 Quality Standards
    const qualityMatch = fullPrompt.match(/##\s*质量标准[\s\S]*?(?=---|用户输入|$)/);
    if (qualityMatch) {
      const standards = qualityMatch[0].match(/[-*]\s*\*\*(.+?)\*\*/g) || [];
      structure.qualityStandards = standards.map(s =>
        s.replace(/[-*]\s*\*\*|\*\*/g, '').trim()
      );
    }

    // 5. 提取 User Input
    const inputMatch = fullPrompt.match(/用户输入.*?[：:]\s*(.+)/);
    if (inputMatch) {
      structure.userInput = inputMatch[1].trim();
    }

    return {
      full: fullPrompt,
      structure,
      metadata: {
        length: fullPrompt.length,
        tokenCount: TokenCounter.estimate(fullPrompt),
        templateVersion: 'v2.0-optimized'
      }
    };
  }
}

module.exports = {
  TokenCounter,
  PerformanceMonitor,
  QualityChecker,
  PromptParser
};
