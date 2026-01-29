const express = require('express');
const path = require('path');
const fs = require('fs');
require('dotenv').config();

const { buildPrompt } = require('./services/promptEngine');
const { generateContent } = require('./services/geminiService');
const { saveGeneratedFiles, buildBaseName } = require('./services/fileManager');
const { generateAudioBatch } = require('./services/ttsService');
const { renderHtmlFromMarkdown, buildAudioTasksFromMarkdown } = require('./services/htmlRenderer');

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

function listHtmlFiles(folderName) {
  const folderPath = resolveFolder(folderName);
  if (!folderPath) return [];
  return fs
    .readdirSync(folderPath, { withFileTypes: true })
    .filter((entry) => entry.isFile() && entry.name.toLowerCase().endsWith('.html'))
    .map((entry) => entry.name)
    .sort();
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

app.post('/api/generate', async (req, res) => {
  try {
    if (!canGenerate(req)) {
      return res.status(429).json({ error: '生成请求过于频繁，请稍后再试' });
    }
    const { phrase } = req.body;
    if (!phrase) {
      return res.status(400).json({ error: 'Phrase is required' });
    }

    console.log(`[Generate] Starting task for phrase: "${phrase}"`);

    // 1. Build Prompt
    const baseName = buildBaseName(phrase);
    const prompt = buildPrompt({ phrase, filenameBase: baseName });

    // 2. Call Gemini
    const content = await generateContent(prompt);

    const renderHtmlLocally = (process.env.HTML_RENDER_MODE || 'local').toLowerCase() === 'local';
    const validationErrors = validateGeneratedContent(content, {
      allowMissingHtml: renderHtmlLocally,
      allowMissingAudioTasks: renderHtmlLocally,
    });
    if (validationErrors.length) {
      return res.status(422).json({
        error: `Invalid AI response: ${validationErrors.join('; ')}`,
        details: validationErrors,
      });
    }

    if (renderHtmlLocally || !content.html_content) {
      const derivedAudioTasks = buildAudioTasksFromMarkdown(content.markdown_content);
      content.audio_tasks = derivedAudioTasks.length
        ? derivedAudioTasks
        : Array.isArray(content.audio_tasks) ? content.audio_tasks : [];
      content.html_content = renderHtmlFromMarkdown(content.markdown_content, {
        baseName,
        audioTasks: content.audio_tasks,
      });
    }

    // 3. Save Files
    const result = saveGeneratedFiles(phrase, content, { baseName });

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

    res.json({
      success: true,
      result,
      audio,
    });
  } catch (error) {
    console.error('[Generate] Error:', error);
    res.status(500).json({ error: error.message || 'Generation failed' });
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
    const files = listHtmlFiles(folder);
    res.json({ files });
  } catch (err) {
    console.error('Error listing files', err);
    res.status(500).json({ error: 'Unable to list files' });
  }
});

app.get('/api/folders/:folder/files/:file', (req, res) => {
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
  if (path.extname(filePath).toLowerCase() === '.html') {
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
