const folderListEl = document.getElementById('folderList');
const fileListEl = document.getElementById('fileList');
const folderCountEl = document.getElementById('folderCount');
const fileCountEl = document.getElementById('fileCount');
const modalOverlay = document.getElementById('modalOverlay');

// Generation Elements
const phraseInput = document.getElementById('phraseInput');
const genBtn = document.getElementById('genBtn');

// Image OCR Elements
const imageDropZone = document.getElementById('imageDropZone');
const imagePreview = document.getElementById('imagePreview');
const ocrBtn = document.getElementById('ocrBtn');
const clearImageBtn = document.getElementById('clearImageBtn');

// Progress Elements
const progressBar = document.getElementById('progressBar');
const progressStatus = document.getElementById('progressStatus');
const promptText = document.getElementById('promptText');
const progressTimer = document.getElementById('progressTimer');

// Prompt Display Elements
const promptDisplay = document.getElementById('promptDisplay');
const promptContent = document.getElementById('promptContent');
const togglePromptBtn = document.getElementById('togglePromptBtn');
const outputDisplay = document.getElementById('outputDisplay');
const outputContent = document.getElementById('outputContent');
const toggleOutputBtn = document.getElementById('toggleOutputBtn');

const enableCompareCheckbox = document.getElementById('enableCompare');

// Timer state
let timerInterval = null;
let timerStartTime = null;

const state = {
  folders: [],
  files: [],
  selectedFolder: null,
  selectedFile: null,
  selectedFileTitle: null,
  imageBase64: null,
  isGenerating: false,
  llmProvider: localStorage.getItem('llm_provider') || 'gemini', 
};

function setStatus(text) {
  console.log(text);
}

if (window.marked) {
  marked.setOptions({ mangle: false, headerIds: false });
}

function normalizeFiles(files) {
  if (!Array.isArray(files)) return [];
  return files
    .map((item) => {
      if (!item) return null;
      if (typeof item === 'string') {
        return {
          file: item,
          title: item.replace(/\.html$/i, ''),
        };
      }
      const file = typeof item.file === 'string' ? item.file : '';
      if (!file) return null;
      const title = typeof item.title === 'string' && item.title.trim()
        ? item.title.trim()
        : file.replace(/\.html$/i, '');
      return { file, title };
    })
    .filter(Boolean);
}

function escapeHtml(text) {
  return String(text)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function sanitizeHtml(html) {
  if (window.DOMPurify) {
    return DOMPurify.sanitize(html, {
      USE_PROFILES: { html: true },
      ADD_TAGS: ['audio', 'source', 'ruby', 'rt', 'rp'],
      ADD_ATTR: ['class', 'src', 'data-audio-src', 'preload', 'controls', 'href', 'title', 'alt', 'aria-label'],
    });
  }
  return html;
}

function rewriteAudioSources(html) {
  return html.replace(/<audio\b([^>]*?)\s+src=(['"])([^'"]+)\2([^>]*)>/gi, (match, pre, quote, src, post) => {
    const preloadAttr = /preload=/i.test(match) ? '' : ' preload="none"';
    return `<audio${pre} data-audio-src=${quote}${src}${quote}${preloadAttr}${post}>`;
  });
}

// ========== Image Processing Functions ==========

function handlePaste(e) {
  const items = e.clipboardData?.items;
  if (!items) return;

  for (const item of items) {
    if (item.type.startsWith('image/')) {
      e.preventDefault();
      const file = item.getAsFile();
      processImageFile(file);
      break;
    }
  }
}

function handleDrop(e) {
  e.preventDefault();
  imageDropZone.classList.remove('dragover');
  const file = e.dataTransfer?.files[0];
  if (file?.type.startsWith('image/')) {
    processImageFile(file);
  }
}

function processImageFile(file) {
  if (file.size > 4 * 1024 * 1024) {
    alert('图片过大，请使用小于 4MB 的图片');
    return;
  }

  const reader = new FileReader();
  reader.onload = () => {
    state.imageBase64 = reader.result;
    showImagePreview(reader.result);
  };
  reader.readAsDataURL(file);
}

function showImagePreview(base64) {
  imagePreview.src = base64;
  imagePreview.classList.remove('hidden');
  const hint = imageDropZone.querySelector('.drop-hint');
  if (hint) hint.classList.add('hidden');
  ocrBtn.disabled = false;
  clearImageBtn.disabled = false;
}

function clearImage() {
  state.imageBase64 = null;
  imagePreview.src = '';
  imagePreview.classList.add('hidden');
  const hint = imageDropZone.querySelector('.drop-hint');
  if (hint) hint.classList.remove('hidden');
  ocrBtn.disabled = true;
  clearImageBtn.disabled = true;
}

async function recognizeAndFill() {
  if (!state.imageBase64) return;

  ocrBtn.disabled = true;
  ocrBtn.textContent = '识别中...';
  showProgress('[图片识别]');
  updateProgress('ocr', '正在识别图片中的文字...');

  try {
    const res = await fetch('/api/ocr', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ image: state.imageBase64 }),
    });

    const data = await res.json();
    if (!res.ok) throw new Error(data.error);

    // 填充到文本框
    stopTimer();
    const elapsed = getElapsedTime();
    phraseInput.value = data.text;
    phraseInput.focus();
    promptText.textContent = data.text;
    updateProgress('ocr', `✓ 识别完成 (${elapsed}): "${data.text.substring(0, 30)}${data.text.length > 30 ? '...' : ''}"`, false);

    setTimeout(hideProgress, 2500);

  } catch (error) {
    stopTimer();
    progressStatus.textContent = '✗ 识别失败: ' + error.message;
    progressStatus.style.color = '#f87171';
    setTimeout(() => {
      hideProgress();
      progressStatus.style.color = '';
    }, 3000);
  } finally {
    ocrBtn.disabled = false;
    ocrBtn.textContent = '识别文字';
  }
}

// ========== Timer Functions ==========

function formatTime(ms) {
  const totalSeconds = Math.floor(ms / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
}

function startTimer() {
  stopTimer();
  timerStartTime = Date.now();
  progressTimer.textContent = '00:00';
  progressTimer.classList.add('running');
  timerInterval = setInterval(() => {
    const elapsed = Date.now() - timerStartTime;
    progressTimer.textContent = formatTime(elapsed);
  }, 1000);
}

function stopTimer() {
  if (timerInterval) {
    clearInterval(timerInterval);
    timerInterval = null;
  }
  progressTimer.classList.remove('running');
}

function getElapsedTime() {
  if (!timerStartTime) return '00:00';
  return formatTime(Date.now() - timerStartTime);
}

// ========== Progress Functions ==========

function showProgress(phrase) {
  progressBar.classList.remove('hidden');
  promptText.textContent = phrase || '';
  startTimer();
}

function updateProgress(step, status, isActive = true) {
  progressBar.classList.remove('hidden');

  const steps = ['ocr', 'generate', 'save', 'audio'];
  const currentIndex = steps.indexOf(step);

  document.querySelectorAll('.progress-steps .step').forEach((el, i) => {
    el.classList.remove('active', 'done');
    if (i < currentIndex) el.classList.add('done');
    if (i === currentIndex && isActive) el.classList.add('active');
    if (i === currentIndex && !isActive) el.classList.add('done');
  });

  progressStatus.textContent = status;
  progressStatus.style.color = '';
}

function hideProgress() {
  progressBar.classList.add('hidden');
  stopTimer();
  promptText.textContent = '';
}

// ========== Prompt Display Functions ==========

function showFullPrompt(prompt) {
  promptContent.textContent = prompt;
  promptDisplay.classList.remove('hidden');
  promptDisplay.classList.remove('collapsed');
  togglePromptBtn.textContent = '收起';
}

function hideFullPrompt() {
  promptDisplay.classList.add('hidden');
}

function togglePrompt() {
  if (promptDisplay.classList.contains('collapsed')) {
    promptDisplay.classList.remove('collapsed');
    togglePromptBtn.textContent = '收起';
  } else {
    promptDisplay.classList.add('collapsed');
    togglePromptBtn.textContent = '展开';
  }
}

togglePromptBtn.addEventListener('click', togglePrompt);

function showFullOutput(output) {
  if (typeof output === 'string') {
    outputContent.textContent = output;
  } else {
    outputContent.textContent = JSON.stringify(output, null, 2);
  }
  outputDisplay.classList.remove('hidden');
  outputDisplay.classList.remove('collapsed');
  toggleOutputBtn.textContent = '收起';
}

function hideFullOutput() {
  outputDisplay.classList.add('hidden');
}

function toggleOutput() {
  if (outputDisplay.classList.contains('collapsed')) {
    outputDisplay.classList.remove('collapsed');
    toggleOutputBtn.textContent = '收起';
  } else {
    outputDisplay.classList.add('collapsed');
    toggleOutputBtn.textContent = '展开';
  }
}

toggleOutputBtn.addEventListener('click', toggleOutput);

// ========== Event Listeners for Image ==========

document.addEventListener('paste', handlePaste);
imageDropZone.addEventListener('dragover', (e) => {
  e.preventDefault();
  imageDropZone.classList.add('dragover');
});
imageDropZone.addEventListener('dragleave', () => {
  imageDropZone.classList.remove('dragover');
});
imageDropZone.addEventListener('drop', handleDrop);
ocrBtn.addEventListener('click', recognizeAndFill);
clearImageBtn.addEventListener('click', clearImage);

// ========== Generation Logic ==========

genBtn.addEventListener('click', async () => {
  const phrase = phraseInput.value.trim();
  if (!phrase) return;

  const enableCompare = enableCompareCheckbox.checked;

  state.isGenerating = true;
  genBtn.disabled = true;
  genBtn.textContent = '...';
  ocrBtn.disabled = true;

  try {
    showProgress(phrase);
    updateProgress('generate', enableCompare ? '正在进行模型对比...' : '正在调用 LLM 生成三语内容...');

    const res = await fetch('/api/generate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        phrase,
        llm_provider: state.llmProvider,
        enable_compare: enableCompare
      })
    });

    const data = await res.json();

    if (!res.ok) {
      const detail = data.details && Array.isArray(data.details) ? data.details.join('；') : '';
      const message = detail ? `${data.error}（${detail}）` : data.error;
      throw new Error(message || 'Generation failed');
    }

    // Save Observability Data
    if (data.comparison) {
        const comparisonPayload = {
          phrase: data.phrase,
          comparison: data.comparison,
          gemini: data.gemini ? { success: data.gemini.success, error: data.gemini.error, observability: data.gemini.observability } : null,
          local: data.local ? { success: data.local.success, error: data.local.error, observability: data.local.observability } : null,
        };
        try {
          localStorage.setItem('latest_observability', JSON.stringify(comparisonPayload));
        } catch (storageError) {
          console.warn('保存对比观测数据失败，已跳过', storageError);
        }
    } else if (data.observability) {
        try {
          localStorage.setItem('latest_observability', JSON.stringify(data.observability));
        } catch (storageError) {
          console.warn('保存观测数据失败，已跳过', storageError);
        }
    }

    if (enableCompare) {
      if (!data.comparison) {
        const fallbackObs = data.gemini?.observability || data.observability;
        if (fallbackObs) {
          try {
            localStorage.setItem('latest_observability', JSON.stringify(fallbackObs));
          } catch (storageError) {
            console.warn('保存 Gemini 观测数据失败，已跳过', storageError);
          }
        }
        hideProgress();
        const reason = data.local?.error || data.error || '本地模型未返回对比结果';
        alert(`对比未完成：${reason}\n已保存 Gemini 观测数据供 Mission Control 查看。`);
        return;
      }
      hideProgress();
      alert('对比完成！请访问 Mission Control (Dashboard) 查看详细分析数据。');
      return;
    }

    // ===== Single Mode Success =====
    updateProgress('save', '正在保存文件...');

    // 显示完整 Prompt 与 LLM 输出
    if (data.prompt) {
      showFullPrompt(data.prompt);
    } else {
      hideFullPrompt();
    }
    if (data.llm_output) {
      showFullOutput(data.llm_output);
    } else {
      hideFullOutput();
    }

    // 检查是否有音频生成
    if (data.audio && data.audio.results && data.audio.results.length > 0) {
      updateProgress('audio', '音频生成完成');
    }

    // 成功
    stopTimer();
    const elapsed = getElapsedTime();
    const savedHtml = data.result.files.find((file) => file.endsWith('.html')) || data.result.files[0];
    updateProgress('audio', `✓ 完成 (${elapsed}) - ${data.result.folder}/${savedHtml}`, false);
    phraseInput.value = '';
    clearImage();

    // Refresh folders and select the new one
    await loadFolders({ targetSelect: data.result.folder });

    setTimeout(hideProgress, 4000);

  } catch (error) {
    console.error(error);
    progressStatus.textContent = '✗ 错误: ' + error.message;
    progressStatus.style.color = '#f87171';
    setTimeout(() => {
      hideProgress();
      progressStatus.style.color = '';
    }, 5000);
  } finally {
    state.isGenerating = false;
    genBtn.disabled = false;
    genBtn.textContent = 'Generate';
    ocrBtn.disabled = !state.imageBase64;
  }
});

async function loadFolders(options = {}) {
  const { keepSelection = false, refreshFiles = false, targetSelect = null } = options;
  const prevSelectedFolder = state.selectedFolder;
  try {
    setStatus('加载文件夹列表中…');
    const response = await fetch('/api/folders');
    if (!response.ok) throw new Error('无法获取文件夹列表');
    const data = await response.json();
    state.folders = data.folders || [];
    folderCountEl.textContent = state.folders.length;
    renderFolders();
    if (!state.folders.length) {
      state.selectedFolder = null;
      state.files = [];
      fileCountEl.textContent = '0';
      fileListEl.innerHTML = '<p class="muted">未找到包含 HTML 的文件夹</p>';
      return;
    }

    let folderToSelect = state.folders[0];

    if (targetSelect && state.folders.includes(targetSelect)) {
        folderToSelect = targetSelect;
    } else if (keepSelection && prevSelectedFolder && state.folders.includes(prevSelectedFolder)) {
        folderToSelect = prevSelectedFolder;
    }

    if (targetSelect || !keepSelection || (keepSelection && !prevSelectedFolder)) {
         await selectFolder(folderToSelect);
    } else if (refreshFiles) {
         await loadFiles(state.selectedFolder);
    }

  } catch (err) {
    console.error(err);
    setStatus(err.message || '加载文件夹失败');
    folderListEl.innerHTML = '<p class="muted">加载失败</p>';
  }
}

function renderFolders() {
  folderListEl.innerHTML = '';
  if (!state.folders.length) {
    folderListEl.innerHTML = '<p class="muted">未找到包含 HTML 的文件夹</p>';
    return;
  }
  const monthNames = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const monthBuckets = new Map();
  const misc = [];

  state.folders.forEach((name) => {
    const match = name.match(/^(\d{4})(\d{2})(\d{2})$/);
    if (!match) {
      misc.push(name);
      return;
    }
    const year = Number(match[1]);
    const month = Number(match[2]);
    if (!month || month < 1 || month > 12) {
      misc.push(name);
      return;
    }

    const key = `${match[1]}${match[2]}`; // YYYYMM
    const label = `${match[1]}.${monthNames[month - 1]}`;
    if (!monthBuckets.has(key)) {
      monthBuckets.set(key, { label, items: [] });
    }
    monthBuckets.get(key).items.push(name);
  });

  const orderedKeys = Array.from(monthBuckets.keys()).sort((a, b) => b.localeCompare(a));
  orderedKeys.forEach((key) => {
    const { label, items } = monthBuckets.get(key);
    const sortedItems = items.sort((a, b) => b.localeCompare(a));
    const wrap = document.createElement('div');
    wrap.className = 'month-group';

    const heading = document.createElement('div');
    heading.className = 'month-label';
    heading.textContent = label;
    wrap.appendChild(heading);

    const grid = document.createElement('div');
    grid.className = 'folder-grid';

    sortedItems.forEach((name) => {
      const btn = document.createElement('button');
      btn.textContent = name;
      btn.className = state.selectedFolder === name ? 'active' : '';
      btn.addEventListener('click', () => selectFolder(name));
      grid.appendChild(btn);
    });

    wrap.appendChild(grid);
    folderListEl.appendChild(wrap);
  });

  if (misc.length) {
    const wrap = document.createElement('div');
    wrap.className = 'month-group';
    const heading = document.createElement('div');
    heading.className = 'month-label';
    heading.textContent = '其它';
    wrap.appendChild(heading);

    const grid = document.createElement('div');
    grid.className = 'folder-grid';

    misc.sort((a, b) => a.localeCompare(b)).forEach((name) => {
      const btn = document.createElement('button');
      btn.textContent = name;
      btn.className = state.selectedFolder === name ? 'active' : '';
      btn.addEventListener('click', () => selectFolder(name));
      grid.appendChild(btn);
    });

    wrap.appendChild(grid);
    folderListEl.appendChild(wrap);
  }
}

async function selectFolder(name) {
  state.selectedFolder = name;
  state.selectedFile = null;
  fileListEl.innerHTML = '<p class="muted">加载文件中…</p>';

  renderFolders();
  await loadFiles(name);
}

async function loadFiles(folder) {
  try {
    const response = await fetch(`/api/folders/${encodeURIComponent(folder)}/files`);
    if (!response.ok) throw new Error('无法获取文件列表');
    const data = await response.json();
    state.files = normalizeFiles(data.files || []);
    if (state.selectedFile && !state.files.some((item) => item.file === state.selectedFile)) {
      state.selectedFile = null;
      state.selectedFileTitle = null;
    }
    fileCountEl.textContent = state.files.length;
    renderFiles();
    setStatus(state.files.length ? '选择一个 HTML 文件以预览' : '此文件夹中没有 HTML 文件');
  } catch (err) {
    console.error(err);
    fileListEl.innerHTML = '<p class="muted">加载失败</p>';
    setStatus(err.message || '加载文件失败');
    state.files = [];
    fileCountEl.textContent = '0';
  }
}

function renderFiles() {
  fileListEl.innerHTML = '';
  if (!state.files.length) {
    fileListEl.innerHTML = '<p class="muted">没有可展示的 HTML 文件</p>';
    return;
  }
  state.files.forEach((item) => {
    const label = item.title;
    const btn = document.createElement('button');
    btn.textContent = label;
    btn.className = state.selectedFile === item.file ? 'active' : '';
    btn.addEventListener('click', () => selectFile(item.file, item.title));
    fileListEl.appendChild(btn);
  });
}

async function selectFile(file, title) {
  if (!state.selectedFolder) return;
  state.selectedFile = file;
  state.selectedFileTitle = title || file;
  renderFiles();

  const folder = encodeURIComponent(state.selectedFolder);
  const baseName = file.replace(/\.html$/i, '');
  const mdFile = `${baseName}.md`;

  // Only render from Markdown
  try {
    const res = await fetch(`/api/folders/${folder}/files/${encodeURIComponent(mdFile)}`);
    if (res.ok) {
        const text = await res.text();
        renderModernCard(text, title || baseName);
    } else {
        throw new Error('No markdown found');
    }
  } catch (e) {
      console.log('Markdown not found', e);
      renderErrorCard(title || baseName, '未找到 Markdown，无法渲染卡片。');
  }

  setStatus('已加载文件');
}

function renderModernCard(markdown, title) {
  const container = document.getElementById('modalContainer');
  
  // 1. Extract Title (First H1 or fallback to filename)
  let displayTitle = title;
  const h1Match = markdown.match(/^#\s+(.+)$/m);
  if (h1Match) {
      displayTitle = h1Match[1];
  }

  // 2. Parse Markdown Body
  const htmlContent = marked.parse(markdown);
  const safeHtml = sanitizeHtml(rewriteAudioSources(htmlContent));

  // 3. Build DOM
  const cardHtml = `
    <div class="modern-card">
        <button class="mc-close" onclick="closeModal()">×</button>
        <div class="mc-header">
            <h1 class="mc-phrase">${escapeHtml(displayTitle)}</h1>
            <div class="mc-meta">
                <span>Trilingual</span>
                <span>${new Date().getFullYear()}</span>
            </div>
        </div>
        <div class="mc-body mc-content">
            ${safeHtml}
        </div>
    </div>
  `;

  container.innerHTML = cardHtml;

  // 4. Post-process: Enhance Audio Elements
  const audioDivs = container.querySelectorAll('.audio');
  audioDivs.forEach(div => {
      const audioEl = div.querySelector('audio');
      if (audioEl) {
          const src = audioEl.getAttribute('data-audio-src') || audioEl.getAttribute('src');
          if (!src) return;
          audioEl.removeAttribute('src');
          const btn = document.createElement('button');
          btn.className = 'audio-btn';
          btn.innerHTML = '▶'; 
          btn.onclick = () => playAudio(btn, src);
          
          const prev = div.previousElementSibling;
          if (prev && (prev.tagName === 'LI' || prev.tagName === 'P')) {
              prev.appendChild(btn);
              div.remove();
          } else {
              div.innerHTML = '';
              div.appendChild(btn);
          }
      }
  });

  modalOverlay.classList.remove('hidden');
  modalOverlay.classList.add('show');
}

function renderErrorCard(title, message) {
  const container = document.getElementById('modalContainer');
  container.innerHTML = `
    <div class="modern-card mc-error">
      <button class="mc-close" onclick="closeModal()">×</button>
      <div class="mc-header">
        <h1 class="mc-phrase">${escapeHtml(title)}</h1>
        <div class="mc-meta">
          <span>Trilingual</span>
          <span>${new Date().getFullYear()}</span>
        </div>
      </div>
      <div class="mc-body">
        <p class="mc-error-text">${escapeHtml(message)}</p>
      </div>
    </div>
  `;
  modalOverlay.classList.remove('hidden');
  modalOverlay.classList.add('show');
}

let currentAudio = null;
function playAudio(btn, src) {
    if (currentAudio) {
        currentAudio.pause();
        currentAudio = null;
        document.querySelectorAll('.audio-btn').forEach(b => {
            b.classList.remove('playing');
            b.innerHTML = '▶';
        });
    }
    
    const folder = encodeURIComponent(state.selectedFolder);
    const audioUrl = `/api/folders/${folder}/files/${encodeURIComponent(src)}`;

    const audio = new Audio(audioUrl);
    currentAudio = audio;
    
    btn.classList.add('playing');
    btn.innerHTML = '||';

    audio.play();
    audio.onended = () => {
        btn.classList.remove('playing');
        btn.innerHTML = '▶';
        currentAudio = null;
    };
    audio.onerror = () => {
        btn.classList.remove('playing');
        btn.style.color = 'red';
        console.error('Audio load failed', audioUrl);
    };
}

function closeModal() {
  modalOverlay.classList.remove('show');
  modalOverlay.classList.add('hidden');
  const container = document.getElementById('modalContainer');
  container.innerHTML = ''; 
  if (currentAudio) {
      currentAudio.pause();
      currentAudio = null;
  }
  state.selectedFile = null;
  state.selectedFileTitle = null;
  renderFiles();
}

modalOverlay.addEventListener('click', (e) => {
    if (e.target === modalOverlay) closeModal();
});
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') {
    closeModal();
  }
});

loadFolders();

setInterval(() => {
  loadFolders({ keepSelection: true, refreshFiles: true });
}, 60_000);
