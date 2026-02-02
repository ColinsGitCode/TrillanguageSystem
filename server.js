const express = require('express');
const path = require('path');
const fs = require('fs');
require('dotenv').config();

const { buildPrompt } = require('./services/promptEngine');
const geminiService = require('./services/geminiService');
const { saveGeneratedFiles, buildBaseName, ensureTodayDirectory } = require('./services/fileManager');
const { generateAudioBatch } = require('./services/ttsService');
const { renderHtmlFromMarkdown, buildAudioTasksFromMarkdown, prepareMarkdownForCard } = require('./services/htmlRenderer');

// 可观测性服务
const { TokenCounter, PerformanceMonitor, QualityChecker, PromptParser } = require('./services/observabilityService');
const { HealthCheckService } = require('./services/healthCheckService');

const app = express();
const PORT = process.env.PORT || 3010;
const RECORDS_PATH = process.env.RECORDS_PATH || '/data/trilingual_records';

const baseDir = path.resolve(RECORDS_PATH);

// Middleware
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

const generationThrottle = new Map();
const GENERATE_MIN_INTERVAL_MS = 4000;

function canGenerate(req) {
  const key = req.ip || 'unknown';
  const now = Date.now();
  const last = generationThrottle.get(key) || 0;
  if (now - last < GENERATE_MIN_INTERVAL_MS) {
    return false;
  }
  generationThrottle.set(key, now);
  return true;
}

// Helper: safely build a path inside the base directory
function resolveFolder(folderName) {
  const safeName = folderName || '';
  const folderPath = path.resolve(path.join(baseDir, safeName));
  if (!folderPath.startsWith(baseDir)) return null;
  if (!fs.existsSync(folderPath) || !fs.statSync(folderPath).isDirectory()) return null;
  return folderPath;
}

function listFoldersWithHtml() {
  if (!fs.existsSync(baseDir)) return [];
  return fs
    .readdirSync(baseDir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .filter((entry) => {
      const dirPath = path.join(baseDir, entry.name);
      return fs
        .readdirSync(dirPath, { withFileTypes: true })
        .some((f) => f.isFile() && f.name.toLowerCase().endsWith('.html'));
    })
    .map((entry) => entry.name)
    .sort();
}

function readMetaTitle(metaPath) {
  try {
    if (!fs.existsSync(metaPath)) return null;
    const raw = fs.readFileSync(metaPath, 'utf-8');
    const data = JSON.parse(raw);
    if (data && typeof data.phrase === 'string') {
      const phrase = data.phrase.trim();
      if (phrase) return phrase;
    }
  } catch (err) {
    return null;
  }
  return null;
}

function readMarkdownTitle(mdPath) {
  try {
    if (!fs.existsSync(mdPath)) return null;
    const raw = fs.readFileSync(mdPath, 'utf-8');
    const lines = raw.split(/\r?\n/);
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      if (trimmed.startsWith('#')) {
        const title = trimmed.replace(/^#+\s*/, '').trim();
        if (title) return title;
      } else {
        return trimmed;
      }
    }
  } catch (err) {
    return null;
  }
  return null;
}

function getDisplayTitle(folderPath, baseName) {
  const metaTitle = readMetaTitle(path.join(folderPath, `${baseName}.meta.json`));
  if (metaTitle) return metaTitle;
  const mdTitle = readMarkdownTitle(path.join(folderPath, `${baseName}.md`));
  if (mdTitle) return mdTitle;
  return baseName;
}

function listHtmlFilesDetailed(folderName) {
  const folderPath = resolveFolder(folderName);
  if (!folderPath) return [];
  const htmlFiles = fs
    .readdirSync(folderPath, { withFileTypes: true })
    .filter((entry) => entry.isFile() && entry.name.toLowerCase().endsWith('.html'))
    .map((entry) => entry.name)
    .sort();

  return htmlFiles.map((file) => {
    const baseName = file.replace(/\.html$/i, '');
    return {
      file,
      title: getDisplayTitle(folderPath, baseName),
    };
  });
}

function validateGeneratedContent(content, options = {}) {
  const { allowMissingHtml = false, allowMissingAudioTasks = false } = options;
  const errors = [];
  if (!content || typeof content !== 'object') {
    errors.push('响应不是有效的 JSON 对象');
    return errors;
  }

  if (typeof content.markdown_content !== 'string' || !content.markdown_content.trim()) {
    errors.push('缺少 markdown_content');
  }
  if (!allowMissingHtml) {
    if (typeof content.html_content !== 'string' || !content.html_content.trim()) {
      errors.push('缺少 html_content');
    }
  }
  if (typeof content.html_content === 'string') {
    const html = content.html_content;
    const forbiddenPatterns = [
      /<script\b/i,
      /javascript:/i,
      /<iframe\b/i,
      /<object\b/i,
      /<embed\b/i,
    ];
    forbiddenPatterns.forEach((pattern) => {
      if (pattern.test(html)) {
        errors.push(`html_content 包含不允许的内容: ${pattern}`);
      }
    });

    const tagMatches = html.match(/<\s*\/?\s*[a-zA-Z0-9:-]+/g) || [];
    const allowedTags = new Set([
      'html', 'head', 'meta', 'title', 'style', 'body',
      'main', 'section', 'article', 'header', 'footer', 'div', 'span',
      'h1', 'h2', 'h3', 'h4', 'h5', 'h6',
      'p', 'br', 'hr',
      'ul', 'ol', 'li',
      'strong', 'em', 'b', 'i', 'u', 'small',
      'ruby', 'rt', 'rp',
      'audio', 'source',
      'table', 'thead', 'tbody', 'tr', 'th', 'td',
      'img',
      'a',
    ]);

    const disallowedTags = new Set();
    tagMatches.forEach((rawTag) => {
      const cleaned = rawTag.replace(/<|\/|\s/g, '').toLowerCase();
      if (cleaned && !allowedTags.has(cleaned)) {
        disallowedTags.add(cleaned);
      }
    });

    if (disallowedTags.size > 0) {
      errors.push(`html_content 包含未允许的标签: ${Array.from(disallowedTags).join(', ')}`);
    }
  }
  if ('audio_tasks' in content && !Array.isArray(content.audio_tasks)) {
    errors.push('audio_tasks 必须为数组');
  }
  if (!allowMissingAudioTasks && Array.isArray(content.audio_tasks)) {
    content.audio_tasks.forEach((task, index) => {
      if (!task || typeof task !== 'object') {
        errors.push(`audio_tasks[${index}] 不是有效对象`);
        return;
      }
      if (typeof task.text !== 'string' || !task.text.trim()) {
        errors.push(`audio_tasks[${index}].text 缺失`);
      }
      if (typeof task.lang !== 'string' || !task.lang.trim()) {
        errors.push(`audio_tasks[${index}].lang 缺失`);
      }
      if (typeof task.filename_suffix !== 'string' || !task.filename_suffix.trim()) {
        errors.push(`audio_tasks[${index}].filename_suffix 缺失`);
      }
    });
  }

  return errors;
}

function normalizeAudioTasks(tasks, baseName) {
  if (!Array.isArray(tasks)) return [];
  return tasks.map((task, index) => {
    const normalized = { ...task };
    let suffix = String(normalized.filename_suffix || '');
    if (baseName && suffix.includes(baseName)) {
      suffix = suffix.replace(baseName, '');
    }
    suffix = suffix.replace(/\.(wav|mp3|m4a)$/i, '');
    if (!suffix.trim()) {
      suffix = `_audio_${index + 1}`;
    }
    normalized.filename_suffix = suffix;
    return normalized;
  });
}

// Routes

// ========== 辅助函数：使用指定 provider 生成内容 ==========
async function generateWithProvider(phrase, provider, perf) {
  const llmService = provider === 'gemini' ? geminiService : require('./services/localLlmService');

  perf.mark('promptBuild');
  const { targetDir, folderName } = ensureTodayDirectory();
  const baseName = buildBaseName(phrase, targetDir);
  const prompt = buildPrompt({ phrase, filenameBase: baseName });

  perf.mark('llmCall');
  const content = await llmService.generateContent(prompt);

  perf.mark('jsonParse');

  // 提取 tokens（从原始 API 响应）
  const tokens = provider === 'gemini'
    ? TokenCounter.extractGeminiTokens(content)
    : TokenCounter.extractOpenAITokens(content);

  const cost = TokenCounter.calculateCost(tokens, provider);
  const quality = QualityChecker.check(content, phrase);
  const promptData = PromptParser.parse(prompt);

  return {
    output: content,
    prompt,
    observability: {
      tokens,
      cost,
      quality,
      prompt: promptData,
      metadata: { provider, timestamp: Date.now() }
    }
  };
}

// ========== 辅助函数：对比模式处理 ==========
async function handleComparisonMode(phrase) {
  console.log('[Comparison] Starting parallel generation...');

  const results = {
    phrase,
    gemini: { success: false },
    local: { success: false },
    comparison: null
  };

  // 并行调用两个 provider
  const perfGemini = new PerformanceMonitor().start();
  const perfLocal = new PerformanceMonitor().start();

  const [geminiResult, localResult] = await Promise.allSettled([
    generateWithProvider(phrase, 'gemini', perfGemini),
    generateWithProvider(phrase, 'local', perfLocal)
  ]);

  // 处理 Gemini 结果
  if (geminiResult.status === 'fulfilled') {
    const perfData = perfGemini.end();
    results.gemini = {
      success: true,
      output: geminiResult.value.output,
      observability: {
        ...geminiResult.value.observability,
        performance: perfData
      }
    };
  } else {
    results.gemini = {
      success: false,
      error: geminiResult.reason.message
    };
  }

  // 处理 Local 结果
  if (localResult.status === 'fulfilled') {
    const perfData = perfLocal.end();
    results.local = {
      success: true,
      output: localResult.value.output,
      observability: {
        ...localResult.value.observability,
        performance: perfData
      }
    };
  } else {
    results.local = {
      success: false,
      error: localResult.reason.message
    };
  }

  // 生成对比分析
  if (results.gemini.success && results.local.success) {
    const geminiObs = results.gemini.observability;
    const localObs = results.local.observability;

    results.comparison = {
      metrics: {
        speed: {
          gemini: geminiObs.performance.totalTime,
          local: localObs.performance.totalTime,
          faster: geminiObs.performance.totalTime < localObs.performance.totalTime ? 'gemini' : 'local'
        },
        quality: {
          gemini: geminiObs.quality.score,
          local: localObs.quality.score,
          better: geminiObs.quality.score > localObs.quality.score ? 'gemini' : 'local'
        },
        cost: {
          gemini: geminiObs.cost.total,
          local: localObs.cost.total,
          cheaper: geminiObs.cost.total <= localObs.cost.total ? 'gemini' : 'local'
        }
      },
      winner: determineWinner(geminiObs, localObs),
      recommendation: generateRecommendation(geminiObs, localObs)
    };
  }

  return results;
}

function determineWinner(geminiObs, localObs) {
  const geminiScore = geminiObs.quality.score * 0.6 + (10000 / geminiObs.performance.totalTime) * 0.4;
  const localScore = localObs.quality.score * 0.6 + (10000 / localObs.performance.totalTime) * 0.4;

  if (Math.abs(geminiScore - localScore) < 5) return 'tie';
  return geminiScore > localScore ? 'gemini' : 'local';
}

function generateRecommendation(geminiObs, localObs) {
  const speedDiff = localObs.performance.totalTime - geminiObs.performance.totalTime;
  const qualityDiff = geminiObs.quality.score - localObs.quality.score;

  if (qualityDiff > 10 && speedDiff < 2000) {
    return '推荐使用 Gemini：质量更高且速度相当';
  }
  if (speedDiff > 3000 && qualityDiff < 5) {
    return '推荐使用 Gemini：速度明显更快';
  }
  if (localObs.cost.total === 0 && qualityDiff < 10) {
    return '推荐使用 Local LLM：成本为零且质量接近';
  }

  return '两者表现相当，可根据实际需求选择';
}

// ========== 增强的 /api/generate 端点 ==========
app.post('/api/generate', async (req, res) => {
  let prompt = null;
  const perf = new PerformanceMonitor().start();

  try {
    if (!canGenerate(req)) {
      return res.status(429).json({ error: '生成请求过于频繁，请稍后再试' });
    }

    // 获取参数
    const { phrase, llm_provider = 'gemini', enable_compare = false } = req.body;

    if (!phrase) {
      return res.status(400).json({ error: 'Phrase is required' });
    }

    // ===== 对比模式 =====
    if (enable_compare) {
      const comparisonResults = await handleComparisonMode(phrase);
      return res.json(comparisonResults);
    }

    // ===== 单模型模式 =====
    const llmService = llm_provider === 'gemini' ? geminiService : require('./services/localLlmService');

    console.log(`[Generate] Using provider: ${llm_provider.toUpperCase()}`);
    console.log(`[Generate] Phrase: "${phrase}"`);

    // 1. Build Prompt
    perf.mark('promptBuild');
    const { targetDir, folderName } = ensureTodayDirectory();
    const baseName = buildBaseName(phrase, targetDir);
    prompt = buildPrompt({ phrase, filenameBase: baseName });

    // 2. Call LLM
    perf.mark('llmCall');
    const content = await llmService.generateContent(prompt);
    const llmOutput = JSON.parse(JSON.stringify(content));

    perf.mark('jsonParse');

    const renderHtmlLocally = (process.env.HTML_RENDER_MODE || 'local').toLowerCase() === 'local';
    const validationErrors = validateGeneratedContent(content, {
      allowMissingHtml: renderHtmlLocally,
      allowMissingAudioTasks: renderHtmlLocally,
    });
    if (validationErrors.length) {
      return res.status(422).json({
        error: `Invalid AI response: ${validationErrors.join('; ')}`,
        details: validationErrors,
        prompt,
        llm_output: llmOutput,
      });
    }

    const derivedAudioTasks = buildAudioTasksFromMarkdown(content.markdown_content);
    if (!Array.isArray(content.audio_tasks) || !content.audio_tasks.length) {
      content.audio_tasks = derivedAudioTasks;
    }

    const preparedMarkdown = await prepareMarkdownForCard(content.markdown_content, {
      baseName,
      audioTasks: content.audio_tasks,
    });
    content.markdown_content = preparedMarkdown;

    if (renderHtmlLocally || !content.html_content) {
      content.html_content = await renderHtmlFromMarkdown(preparedMarkdown, {
        baseName,
        audioTasks: content.audio_tasks,
        prepared: true,
      });
    }

    // 3. Save Files
    perf.mark('fileSave');
    const result = saveGeneratedFiles(phrase, content, { baseName, targetDir, folderName });

    console.log(`[Generate] Success. Saved to ${result.folder}/${result.files.join(', ')}`);

    // 4. (Optional Phase 2) Trigger TTS here
    let audio = null;
    const hasTtsEndpoint =
      process.env.TTS_API_ENDPOINT || process.env.TTS_EN_ENDPOINT || process.env.TTS_JA_ENDPOINT;

    if (hasTtsEndpoint && Array.isArray(content.audio_tasks) && content.audio_tasks.length) {
      const audioTasks = normalizeAudioTasks(content.audio_tasks, result.baseName);
      audio = await generateAudioBatch(audioTasks, {
        outputDir: result.targetDir,
        baseName: result.baseName,
        extension: 'wav',
      });

      if (audio.errors && audio.errors.length) {
        console.warn('[Generate] TTS errors:', audio.errors);
      }
    }

    perf.mark('audioGenerate');
    const performance = perf.end();

    // ===== 构建可观测性数据 =====

    // F1: Token 计数
    const tokens = llm_provider === 'gemini'
      ? TokenCounter.extractGeminiTokens(llmOutput)
      : TokenCounter.extractOpenAITokens(llmOutput);

    const cost = TokenCounter.calculateCost(tokens, llm_provider);

    // 配额数据（TODO: 从数据库或缓存读取）
    const quota = {
      used: 0,  // 需要持久化统计
      limit: 1500,
      remaining: 1500,
      resetAt: new Date().setHours(24, 0, 0, 0),
      percentage: 0
    };

    // F5: Prompt 解析
    const promptData = PromptParser.parse(prompt);

    // F7: 质量检查
    const quality = QualityChecker.check(content, phrase);

    // 组装可观测性数据
    const observability = {
      tokens,
      cost,
      quota,
      performance,
      prompt: promptData,
      quality,
      metadata: {
        provider: llm_provider,
        model: process.env[llm_provider === 'gemini' ? 'GEMINI_MODEL' : 'LLM_MODEL'],
        timestamp: Date.now(),
        requestId: `req_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`
      }
    };

    res.json({
      success: true,
      result,
      audio,
      prompt,
      llm_output: llmOutput,
      observability  // ✅ 新增可观测性数据
    });
  } catch (error) {
    console.error('[Generate] Error:', error);
    res.status(500).json({ error: error.message || 'Generation failed', prompt });
  }
});

app.post('/api/ocr', async (req, res) => {
  try {
    if (!canGenerate(req)) {
      return res.status(429).json({ error: '请求过于频繁，请稍后再试' });
    }

    const { image, llm_provider = 'gemini' } = req.body;
    if (!image || !image.startsWith('data:image/')) {
      return res.status(400).json({ error: '请提供有效的图片' });
    }

    // 限制图片大小 (4MB base64 约 5.3MB)
    if (image.length > 5 * 1024 * 1024) {
      return res.status(400).json({ error: '图片过大，请使用小于 4MB 的图片' });
    }

    console.log('[OCR] Starting recognition...');
    const text = await geminiService.recognizeImage(image);

    if (!text || !text.trim()) {
      return res.status(422).json({ error: '未能识别出文字' });
    }

    console.log('[OCR] Recognized:', text.substring(0, 100));
    res.json({ text: text.trim() });
  } catch (error) {
    console.error('[OCR] Error:', error);
    res.status(500).json({ error: error.message || 'OCR 失败' });
  }
});

// ========== F3: 健康检查端点 ==========
app.get('/api/health', async (req, res) => {
  try {
    const { services, system } = await HealthCheckService.checkAll();

    // 计算存储信息
    const storageService = services.find(s => s.type === 'storage');
    const storage = storageService?.details || {
      used: 0,
      total: 0,
      percentage: 0,
      recordsCount: 0
    };

    res.json({
      services,
      storage,
      system
    });
  } catch (error) {
    console.error('[Health] Error:', error);
    res.status(500).json({ error: 'Health check failed' });
  }
});

app.get('/api/folders', (req, res) => {
  try {
    const folders = listFoldersWithHtml();
    res.json({ folders });
  } catch (err) {
    console.error('Error listing folders', err);
    res.status(500).json({ error: 'Unable to list folders' });
  }
});

app.get('/api/folders/:folder/files', (req, res) => {
  try {
    const folder = req.params.folder;
    const files = listHtmlFilesDetailed(folder);
    res.json({ files });
  } catch (err) {
    console.error('Error listing files', err);
    res.status(500).json({ error: 'Unable to list files' });
  }
});

app.get('/api/folders/:folder/files/:file', async (req, res) => {
  const folder = req.params.folder;
  const file = req.params.file;
  const folderPath = resolveFolder(folder);
  if (!folderPath) {
    return res.status(404).json({ error: 'Folder not found' });
  }
  const filePath = path.resolve(path.join(folderPath, file));
  if (!filePath.startsWith(folderPath)) {
    return res.status(400).json({ error: 'Invalid file path' });
  }
  if (!fs.existsSync(filePath) || !fs.statSync(filePath).isFile()) {
    return res.status(404).json({ error: 'File not found' });
  }
  const ext = path.extname(filePath).toLowerCase();
  if (ext === '.md') {
    try {
      const markdown = fs.readFileSync(filePath, 'utf-8');
      const audioTasks = buildAudioTasksFromMarkdown(markdown);
      const baseName = path.basename(filePath, '.md');
      const prepared = await prepareMarkdownForCard(markdown, { baseName, audioTasks });
      res.setHeader('Content-Type', 'text/markdown; charset=utf-8');
      return res.send(prepared);
    } catch (err) {
      console.error('Error preparing markdown', err);
      return res.status(500).json({ error: 'Unable to load markdown' });
    }
  }
  if (ext === '.html') {
    res.setHeader(
      'Content-Security-Policy',
      "default-src 'self'; img-src 'self' data:; media-src 'self' data:; font-src 'self' data:; style-src 'self' 'unsafe-inline'; script-src 'none'; object-src 'none'; base-uri 'none'; frame-ancestors 'self'"
    );
    res.setHeader('X-Content-Type-Options', 'nosniff');
  }
  res.sendFile(filePath);
});

app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.listen(PORT, () => {
  console.log(`Viewer running on port ${PORT}`);
  console.log(`Serving records from ${baseDir}`);
});
