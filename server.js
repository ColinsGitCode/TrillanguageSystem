// server.js (Partial Update)
const express = require('express');
const path = require('path');
const fs = require('fs');
require('dotenv').config();

const { buildPrompt } = require('./services/promptEngine');
const geminiService = require('./services/geminiService');
const { saveGeneratedFiles, buildBaseName, ensureTodayDirectory } = require('./services/fileManager');
const { generateAudioBatch } = require('./services/ttsService');
const { renderHtmlFromMarkdown, buildAudioTasksFromMarkdown, prepareMarkdownForCard } = require('./services/htmlRenderer');

const { TokenCounter, PerformanceMonitor, QualityChecker, PromptParser } = require('./services/observabilityService');
const { HealthCheckService } = require('./services/healthCheckService');

const app = express();
const PORT = process.env.PORT || 3010;
const RECORDS_PATH = process.env.RECORDS_PATH || '/data/trilingual_records';

app.use(express.static('public'));
app.use('/data', express.static(RECORDS_PATH));
app.use(express.json({ limit: '10mb' }));

// ... (Keep existing throttle logic and helper functions)
const GENERATE_MIN_INTERVAL_MS = 4000;
const generationThrottle = new Map();
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
      suffix = `_${normalized.lang || 'en'}_${index + 1}`;
    }
    normalized.filename_suffix = suffix;
    return normalized;
  });
}

function validateGeneratedContent(content, options = {}) {
    const errors = [];
    if (!content || typeof content !== 'object') {
        errors.push('Response is not a valid JSON object');
        return errors;
    }
    if (typeof content.markdown_content !== 'string' || !content.markdown_content.trim()) {
        errors.push('markdown_content is missing or empty');
    }
    // Strict HTML check if required (skipped for local render mode)
    if (!options.allowMissingHtml && (!content.html_content || !content.html_content.includes('<html'))) {
        // errors.push('html_content is invalid'); // Relaxed for now as we render locally
    }
    return errors;
}

// ========== Core Logic ==========

async function generateWithProvider(phrase, provider, perf) {
  let llmService;
  try {
      llmService = provider === 'gemini' ? geminiService : require('./services/localLlmService');
  } catch (e) {
      throw new Error(`Provider ${provider} not available: ${e.message}`);
  }

  perf.mark('promptBuild');
  const { targetDir, folderName } = ensureTodayDirectory();
  const baseName = buildBaseName(phrase, targetDir);
  const prompt = buildPrompt({ phrase, filenameBase: baseName });

  perf.mark('llmCall');
  // Expecting { content, usage } structure
  const response = await llmService.generateContent(prompt);
  
  // Normalize response structure
  let content, usage;
  if (response.content && response.usage) {
      content = response.content;
      usage = response.usage;
  } else {
      // Fallback for services not yet updated (though we updated them)
      content = response;
      usage = { input: 0, output: 0, total: 0 };
  }

  perf.mark('jsonParse');

  const cost = TokenCounter.calculateCost(usage, provider);
  const quality = QualityChecker.check(content, phrase);
  const promptData = PromptParser.parse(prompt);

  return {
    output: content,
    prompt,
    baseName, targetDir, folderName, // Pass file info for saving
    observability: {
      tokens: usage,
      cost,
      quality,
      prompt: promptData,
      metadata: { provider, timestamp: Date.now() }
    }
  };
}

async function handleComparisonMode(phrase) {
  console.log('[Comparison] Starting parallel generation...');

  const results = {
    phrase,
    gemini: { success: false },
    local: { success: false },
    comparison: null
  };

  const perfGemini = new PerformanceMonitor().start();
  const perfLocal = new PerformanceMonitor().start();

  const [geminiResult, localResult] = await Promise.allSettled([
    generateWithProvider(phrase, 'gemini', perfGemini),
    generateWithProvider(phrase, 'local', perfLocal)
  ]);

  if (geminiResult.status === 'fulfilled') {
    const perfData = perfGemini.end();
    results.gemini = {
      success: true,
      output: geminiResult.value.output,
      observability: { ...geminiResult.value.observability, performance: perfData }
    };
  } else {
    results.gemini = { success: false, error: geminiResult.reason.message };
  }

  if (localResult.status === 'fulfilled') {
    const perfData = perfLocal.end();
    results.local = {
      success: true,
      output: localResult.value.output,
      observability: { ...localResult.value.observability, performance: perfData }
    };
  } else {
    results.local = { success: false, error: localResult.reason.message };
  }

  // Comparison Logic
  if (results.gemini.success && results.local.success) {
    const geminiObs = results.gemini.observability;
    const localObs = results.local.observability;
    
    // Normalize score logic: Quality (0-100) vs Time (ms, lower is better)
    const geminiScore = geminiObs.quality.score * 0.7 + (5000 / Math.max(geminiObs.performance.totalTime, 500)) * 30;
    const localScore = localObs.quality.score * 0.7 + (5000 / Math.max(localObs.performance.totalTime, 500)) * 30;

    let winner = 'tie';
    if (geminiScore > localScore + 5) winner = 'gemini';
    if (localScore > geminiScore + 5) winner = 'local';

    results.comparison = {
      metrics: {
        speed: { gemini: geminiObs.performance.totalTime, local: localObs.performance.totalTime },
        quality: { gemini: geminiObs.quality.score, local: localObs.quality.score },
        tokens: { gemini: geminiObs.tokens.total, local: localObs.tokens.total },
        cost: {
          gemini: typeof geminiObs.cost?.total === 'number' ? geminiObs.cost.total : 0,
          local: typeof localObs.cost?.total === 'number' ? localObs.cost.total : 0
        }
      },
      winner,
      recommendation: winner === 'gemini' ? 'Gemini wins on speed/quality balance.' : 
                      winner === 'local' ? 'Local LLM wins on speed/quality balance.' : 'Tie.'
    };
  }

  return results;
}

// API Endpoints

app.post('/api/generate', async (req, res) => {
  const perf = new PerformanceMonitor().start();
  try {
    if (!canGenerate(req)) return res.status(429).json({ error: 'Rate limit exceeded' });

    const { phrase, llm_provider = 'gemini', enable_compare = false } = req.body;
    if (!phrase) return res.status(400).json({ error: 'Phrase required' });

    // Mode: Comparison
    if (enable_compare) {
        const result = await handleComparisonMode(phrase);
        return res.json(result);
    }

    // Mode: Single
    const genResult = await generateWithProvider(phrase, llm_provider, perf);
    const { output: content, prompt, observability, baseName, targetDir, folderName } = genResult;

    // Validate
    const validationErrors = validateGeneratedContent(content, { allowMissingHtml: true });
    if (validationErrors.length) {
        return res.status(422).json({ error: 'Validation failed', details: validationErrors, prompt, llm_output: content });
    }

    // Post-process (Audio Tasks & HTML)
    const derivedAudioTasks = buildAudioTasksFromMarkdown(content.markdown_content);
    if (!Array.isArray(content.audio_tasks) || !content.audio_tasks.length) {
      content.audio_tasks = derivedAudioTasks;
    }

    const preparedMarkdown = await prepareMarkdownForCard(content.markdown_content, { baseName, audioTasks: content.audio_tasks });
    content.markdown_content = preparedMarkdown;
    content.html_content = await renderHtmlFromMarkdown(preparedMarkdown, { baseName, audioTasks: content.audio_tasks });

    // Save
    perf.mark('fileSave');
    const result = saveGeneratedFiles(phrase, content, { baseName, targetDir, folderName });

    // TTS
    let audio = null;
    const hasTtsEndpoint = process.env.TTS_EN_ENDPOINT || process.env.TTS_JA_ENDPOINT;
    if (hasTtsEndpoint && content.audio_tasks.length) {
        const audioTasks = normalizeAudioTasks(content.audio_tasks, result.baseName);
        audio = await generateAudioBatch(audioTasks, { outputDir: result.targetDir, baseName: result.baseName, extension: 'wav' });
    }

    perf.mark('audioGenerate');
    observability.performance = perf.end(); // Finalize perf stats

    res.json({
        success: true,
        result,
        audio,
        prompt,
        llm_output: content,
        observability
    });

  } catch (err) {
      console.error(err);
      res.status(500).json({ error: err.message });
  }
});

// Reuse existing endpoints
app.post('/api/ocr', async (req, res) => {
    try {
        const { image } = req.body;
        if (!image) return res.status(400).json({ error: 'No image' });
        const text = await geminiService.recognizeImage(image);
        res.json({ text: text || 'No text found' });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

app.get('/api/health', async (req, res) => {
    try {
        const status = await HealthCheckService.checkAll();
        res.json(status);
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

app.get('/api/folders', (req, res) => {
    const listFoldersWithHtml = require('./services/fileManager').listFoldersWithHtml; // Lazy require
    try {
        const folders = listFoldersWithHtml();
        res.json({ folders });
    } catch (e) { res.status(500).json({ error: e.message }); }
});

app.get('/api/folders/:folder/files', (req, res) => {
    const listHtmlFilesInFolder = require('./services/fileManager').listHtmlFilesInFolder;
    try {
        const files = listHtmlFilesInFolder(req.params.folder);
        res.json({ files });
    } catch (e) { res.status(500).json({ error: e.message }); }
});

app.get('/api/folders/:folder/files/:file', (req, res) => {
    const readFileInFolder = require('./services/fileManager').readFileInFolder;
    try {
        const content = readFileInFolder(req.params.folder, req.params.file);
        const ext = path.extname(req.params.file || '').toLowerCase();
        if (ext === '.wav') {
            res.set('Content-Type', 'audio/wav');
            res.send(content);
            return;
        }
        if (ext === '.mp3') {
            res.set('Content-Type', 'audio/mpeg');
            res.send(content);
            return;
        }
        res.send(content);
    } catch (e) { res.status(404).send('Not Found'); }
});

app.listen(PORT, () => {
    console.log(`Server running on http://localhost:${PORT}`);
    console.log(`Mission Control available at http://localhost:${PORT}/dashboard.html`);
});
