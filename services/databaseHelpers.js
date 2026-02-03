/**
 * 数据库辅助函数
 * 用于准备插入数据库的数据
 */

const crypto = require('crypto');

/**
 * 生成唯一请求ID
 */
function generateRequestId() {
  return `req_${Date.now()}_${crypto.randomBytes(4).toString('hex')}`;
}

/**
 * 检测短语语言
 */
function detectLanguage(phrase) {
  if (!phrase) return 'unknown';

  // 简单的语言检测
  if (/[\u4e00-\u9fa5]/.test(phrase)) return 'zh';
  if (/[\u3040-\u309f\u30a0-\u30ff]/.test(phrase)) return 'ja';
  if (/^[a-zA-Z\s]+$/.test(phrase)) return 'en';

  return 'mixed';
}

/**
 * 从markdown内容中提取翻译
 */
function extractTranslation(markdownContent, language) {
  if (!markdownContent) return null;

  try {
    const patterns = {
      en: /## 1\. 英文:[\s\S]*?- \*\*翻译\*\*:\s*(.+?)(?:\n|$)/,
      ja: /## 2\. 日本語:[\s\S]*?- \*\*翻訳\*\*:\s*(.+?)(?:\n|$)/,
      zh: /## 3\. 中文:[\s\S]*?- \*\*翻译\*\*:\s*(.+?)(?:\n|$)/
    };

    const match = markdownContent.match(patterns[language]);
    if (match && match[1]) {
      // 清理注音标记
      let translation = match[1].trim();
      // 移除日语的括号注音
      translation = translation.replace(/\([^)]+\)/g, '');
      return translation;
    }
  } catch (error) {
    console.warn(`[DB Helper] Failed to extract ${language} translation:`, error.message);
  }

  return null;
}

/**
 * 准备生成记录数据
 */
function prepareGenerationData({ phrase, provider, model, folderName, baseName, filePaths, content }) {
  return {
    phrase,
    phraseLanguage: detectLanguage(phrase),
    llmProvider: provider,
    llmModel: model,
    folderName,
    baseFilename: baseName,
    mdFilePath: filePaths.md,
    htmlFilePath: filePaths.html,
    metaFilePath: filePaths.meta,
    markdownContent: content.markdown_content || '',
    enTranslation: extractTranslation(content.markdown_content, 'en'),
    jaTranslation: extractTranslation(content.markdown_content, 'ja'),
    zhTranslation: extractTranslation(content.markdown_content, 'zh'),
    generationDate: new Date().toISOString().split('T')[0],
    requestId: generateRequestId()
  };
}

/**
 * 准备可观测性数据
 */
function prepareObservabilityData({ observability, prompt, content }) {
  const tokens = observability.tokens || {};
  const cost = observability.cost || {};
  const quota = observability.quota || {};
  const performance = observability.performance || {};
  const quality = observability.quality || {};
  const promptData = observability.prompt || {};
  const metadata = observability.metadata || {};

  return {
    tokensInput: tokens.input || 0,
    tokensOutput: tokens.output || 0,
    tokensTotal: tokens.total || 0,
    tokensCached: tokens.cached || 0,

    costInput: cost.input || 0,
    costOutput: cost.output || 0,
    costTotal: cost.total || 0,
    costCurrency: cost.currency || 'USD',

    quotaUsed: quota.used,
    quotaLimit: quota.limit,
    quotaRemaining: quota.remaining,
    quotaResetAt: quota.resetAt ? new Date(quota.resetAt).toISOString() : null,
    quotaPercentage: quota.percentage,

    performanceTotalMs: performance.totalTime || 0,
    performancePhases: JSON.stringify(performance.phases || {}),

    qualityScore: quality.score || 0,
    qualityChecks: JSON.stringify(quality.checks || []),
    qualityDimensions: JSON.stringify(quality.dimensions || {}),
    qualityWarnings: JSON.stringify(quality.warnings || []),

    promptFull: prompt,
    promptParsed: JSON.stringify(promptData),
    llmOutput: JSON.stringify(content),
    llmFinishReason: 'STOP',
    metadata: JSON.stringify(metadata)
  };
}

/**
 * 准备音频文件数据
 */
function prepareAudioFilesData({ audioTasks, baseName, folderName }) {
  if (!audioTasks || !Array.isArray(audioTasks)) return [];

  return audioTasks.map(task => ({
    language: task.lang,
    text: task.text,
    filenameSuffix: task.filename_suffix,
    filePath: task.filePath || `./trilingual_records/${folderName}/${baseName}${task.filename_suffix}.wav`,
    ttsProvider: task.lang === 'en' ? 'kokoro' : 'voicevox',
    ttsModel: task.lang === 'en' ? process.env.TTS_EN_MODEL : null,
    status: task.status || 'pending'
  }));
}

/**
 * 准备完整的数据库插入数据
 */
function prepareInsertData({
  phrase,
  provider,
  model,
  folderName,
  baseName,
  filePaths,
  content,
  observability,
  prompt,
  audioTasks
}) {
  return {
    generation: prepareGenerationData({
      phrase,
      provider,
      model,
      folderName,
      baseName,
      filePaths,
      content
    }),
    observability: prepareObservabilityData({
      observability,
      prompt,
      content
    }),
    audioFiles: prepareAudioFilesData({
      audioTasks,
      baseName,
      folderName
    })
  };
}

module.exports = {
  generateRequestId,
  detectLanguage,
  extractTranslation,
  prepareGenerationData,
  prepareObservabilityData,
  prepareAudioFilesData,
  prepareInsertData
};
