/**
 * 主应用入口
 */
import { api } from './api.js';
import { store } from './store.js';
import { player } from './audio-player.js';
import { escapeHtml, sanitizeHtml, formatTime, formatDate, debounce } from './utils.js';

// DOM Elements
const els = {
    folderList: document.getElementById('folderList'),
    fileList: document.getElementById('fileList'),
    folderCount: document.getElementById('folderCount'),
    fileCount: document.getElementById('fileCount'),
    
    // Generator
    phraseInput: document.getElementById('phraseInput'),
    genBtn: document.getElementById('genBtn'),
    
    // Image OCR
    imageDropZone: document.getElementById('imageDropZone'),
    imagePreview: document.getElementById('imagePreview'),
    ocrBtn: document.getElementById('ocrBtn'),
    clearImageBtn: document.getElementById('clearImageBtn'),
    
    // Progress
    progressBar: document.getElementById('progressBar'),
    progressStatus: document.getElementById('progressStatus'),
    promptText: document.getElementById('promptText'),
    progressTimer: document.getElementById('progressTimer'),
    
    // Modal
    modalOverlay: document.getElementById('modalOverlay'),
    modalContainer: document.getElementById('modalContainer'),
    
    // History
    historyList: document.getElementById('historyList'),
    historyCount: document.getElementById('historyCount'),
    historySearch: document.getElementById('historySearch'),
    historyProviderFilter: document.getElementById('historyProviderFilter'),
    historyPrevBtn: document.getElementById('historyPrevBtn'),
    historyNextBtn: document.getElementById('historyNextBtn'),
    historyPageInfo: document.getElementById('historyPageInfo'),

    // Context Menu
    contextMenu: document.getElementById('contextMenu')
};

let fileListState = null;

// Timer State
let timerInterval = null;
let timerStartTime = null;

// ==========================================
// 初始化与事件绑定
// ==========================================

function init() {
    initTabs();
    initImageHandlers();
    initModelSelector();
    initGenerator();
    initModal();
    initHistory();
    ensureFileListState();
    // 加载初始数据
    loadFolders();

    // 自动刷新
    setInterval(() => loadFolders({ keepSelection: true, refreshFiles: true }), 60000);
}

// ==========================================
// 文件夹与文件浏览
// ==========================================

async function loadFolders(options = {}) {
    const { keepSelection = false, refreshFiles = false, targetSelect = null, noCache = false } = options;
    const state = store.get();
    
    try {
        const data = await api.getFolders(noCache);
        const folders = data.folders || [];
        
        store.setState({ folders });
        els.folderCount.textContent = folders.length;
        
        renderFolders();

        let folderToSelect = folders[0];
        if (targetSelect && folders.includes(targetSelect)) {
            folderToSelect = targetSelect;
        } else if (keepSelection && state.selectedFolder && folders.includes(state.selectedFolder)) {
            folderToSelect = state.selectedFolder;
        }

        if ((targetSelect || !keepSelection || (keepSelection && !state.selectedFolder)) && folderToSelect) {
            await selectFolder(folderToSelect, { noCache });
        } else if (refreshFiles && state.selectedFolder) {
            await loadFiles(state.selectedFolder, { noCache });
        }
    } catch (err) {
        console.error('Load folders failed:', err);
    }
}

function renderFolders() {
    const folders = store.get('folders');
    const selected = store.get('selectedFolder');
    els.folderList.innerHTML = '';

    if (!folders.length) {
        els.folderList.innerHTML = '<p class="muted">无文件夹</p>';
        return;
    }

    // 分组逻辑 (YYYYMM)
    const groups = new Map();
    const misc = [];
    const monthNames = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

    folders.forEach(name => {
        const match = name.match(/^(\d{4})(\d{2})(\d{2})$/);
        if (match) {
            const key = `${match[1]}${match[2]}`;
            const label = `${match[1]}.${monthNames[Number(match[2]) - 1]}`;
            if (!groups.has(key)) groups.set(key, { label, items: [] });
            groups.get(key).items.push(name);
        } else {
            misc.push(name);
        }
    });

    // 渲染分组
    const renderGroup = (label, items) => {
        const wrap = document.createElement('div');
        wrap.className = 'month-group';
        wrap.innerHTML = `<div class="month-label">${label}</div>`;
        const grid = document.createElement('div');
        grid.className = 'folder-grid';
        
        items.sort((a, b) => b.localeCompare(a)).forEach(name => {
            const btn = document.createElement('button');
            btn.textContent = name;
            if (name === selected) btn.classList.add('active');
            btn.onclick = () => selectFolder(name);
            grid.appendChild(btn);
        });
        wrap.appendChild(grid);
        els.folderList.appendChild(wrap);
    };

    Array.from(groups.keys()).sort((a, b) => b.localeCompare(a)).forEach(key => {
        const g = groups.get(key);
        renderGroup(g.label, g.items);
    });

    if (misc.length) {
        renderGroup('其它', misc.sort());
    }
}

async function selectFolder(name, options = {}) {
    store.setState({ selectedFolder: name, selectedFile: null });
    renderFolders(); // 更新高亮
    await loadFiles(name, options);
}

async function loadFiles(folder, options = {}) {
    const { noCache = false } = options;
    try {
        const data = await api.getFiles(folder, noCache);
        const files = (data.files || [])
            .map(f => typeof f === 'string' ? { file: f, title: f.replace(/\.html$/i, '') } : f)
            .filter(f => f && f.file);
            
        store.setState({ files });
        els.fileCount.textContent = files.length;
        
        if (!files.length) {
            renderFiles([]);
            setFileListState('empty', '暂无文件');
            return;
        }

        setFileListState();
        renderFiles(files);
    } catch (err) {
        console.error('Load files failed:', err);
        renderFiles([]);
        setFileListState('error', '加载失败');
    }
}

function ensureFileListState() {
    if (fileListState) return fileListState;
    fileListState = document.createElement('div');
    fileListState.className = 'list-state hidden';
    els.fileList.appendChild(fileListState);
    return fileListState;
}

function setFileListState(type = '', message = '') {
    ensureFileListState();
    if (!type) {
        fileListState.textContent = '';
        fileListState.classList.add('hidden');
        fileListState.removeAttribute('data-state');
        return;
    }
    fileListState.textContent = message;
    fileListState.dataset.state = type;
    fileListState.classList.remove('hidden');
}

function renderFiles(files) {
    els.fileList.innerHTML = '';
    files.forEach(item => {
        const btn = document.createElement('button');
        btn.className = 'list-item-btn';
        btn.textContent = item.title;
        if (store.get('selectedFile') === item.file) {
            btn.classList.add('active');
        }
        btn.onclick = () => selectFile(item.file, item.title);
        els.fileList.appendChild(btn);
    });
    ensureFileListState();
    els.fileList.appendChild(fileListState);
}

async function selectFile(file, title) {
    const folder = store.get('selectedFolder');
    if (!folder) return;

    store.setState({ selectedFile: file, selectedFileTitle: title });
    renderFiles(store.get('files'));

    try {
        const baseName = file.replace(/\.html$/i, '');
        const mdContent = await api.getFileContent(folder, `${baseName}.md`);
        renderCardModal(mdContent, title || baseName, { folder, baseName });
    } catch (err) {
        console.error('Render card failed:', err);
        alert('无法加载文件内容');
    }
}

// ==========================================
// 模型选择器
// ==========================================

function initModelSelector() {
    const buttons = document.querySelectorAll('.model-btn');
    const hint = document.getElementById('modelHint');

    // 初始化选中状态
    const currentMode = store.get('modelMode');
    updateModelUI(currentMode);

    buttons.forEach(btn => {
        btn.addEventListener('click', () => {
            const mode = btn.dataset.mode;
            store.setState({ modelMode: mode });
            updateModelUI(mode);
        });
    });

    function updateModelUI(mode) {
        buttons.forEach(b => b.classList.toggle('active', b.dataset.mode === mode));

        const hints = {
            local: 'LOCAL LLM (Qwen)',
            gemini: 'GEMINI API',
            compare: '双模型对比 ⚡'
        };
        hint.textContent = hints[mode] || 'LOCAL LLM';
        hint.className = 'selector-hint mode-' + mode;
    }
}

// ==========================================
// 生成器逻辑 (Optimized)
// ==========================================

function initGenerator() {
    els.genBtn.addEventListener('click', async () => {
        const phrase = els.phraseInput.value.trim();
        if (!phrase) return;

        const mode = store.get('modelMode');
        const isCompare = mode === 'compare';

        store.setState({ isGenerating: true });
        updateGenUI(true);
        startProgress(phrase);

        try {
            updateStep('init', '初始化...');
            await new Promise(r => setTimeout(r, 100));

            updateStep('prompt', '构建优化 Prompt...');
            updateStep('llm', isCompare ? '双模型并行生成中...' : 'AI 思考中...');

            const provider = mode === 'gemini' ? 'gemini' : 'local';
            const data = await api.generate(phrase, provider, isCompare);

            // 对比模式处理
            if (isCompare) {
                handleCompareResult(data);
                updateStep('complete', '对比完成!', false);
                setTimeout(hideProgress, 3000);
                return;
            }

            // 单模式处理
            updateStep('parse', '解析结果...');

            // 保存可观测性数据
            if (data.observability) {
                localStorage.setItem('latest_observability', JSON.stringify(data.observability));
            }

            updateStep('render', '渲染 HTML...');
            updateStep('save', '保存文件...');

            if (data.audio?.results?.length) {
                updateStep('audio', '生成 TTS 音频...');
            }

            updateStep('complete', '完成!', false);

            els.phraseInput.value = '';
            clearImage();

            // 自动跳转到新结果并刷新
            await loadFolders({ targetSelect: data.result.folder, noCache: true });

            setTimeout(hideProgress, 3000);

        } catch (err) {
            els.progressStatus.textContent = `❌ ${err.message}`;
            els.progressStatus.style.color = 'var(--color-error)';
            setTimeout(hideProgress, 5000);
        } finally {
            store.setState({ isGenerating: false });
            updateGenUI(false);
            stopTimer();
        }
    });
}

function updateGenUI(isGenerating) {
    els.genBtn.disabled = isGenerating;
    els.genBtn.textContent = isGenerating ? 'Generating...' : 'Generate';
    els.ocrBtn.disabled = isGenerating || !store.get('imageBase64');
}

// ==========================================
// 对比模式处理
// ==========================================

function handleCompareResult(data) {
    console.log('[Compare] Result:', data);

    const { phrase, gemini, local, comparison } = data;

    // 构建对比弹窗
    renderCompareModal(phrase, gemini, local, comparison);

    // 清空输入
    els.phraseInput.value = '';
    clearImage();
}

function renderCompareModal(phrase, geminiResult, localResult, comparison) {
    const geminiOk = geminiResult?.success;
    const localOk = localResult?.success;

    let comparisonSection = '';
    if (comparison) {
        const winner = comparison.winner;
        const metrics = comparison.metrics;

        comparisonSection = `
            <div class="compare-summary">
                <h3 style="color: var(--neon-green); margin-bottom: 16px;">📊 对比分析</h3>
                <div class="winner-badge" style="background: ${winner === 'gemini' ? 'var(--neon-blue)' : winner === 'local' ? 'var(--neon-purple)' : 'var(--neon-amber)'}; color: white; padding: 12px; border-radius: 8px; text-align: center; margin-bottom: 16px;">
                    <div style="font-size: 14px; opacity: 0.9;">🏆 Winner</div>
                    <div style="font-size: 24px; font-weight: 600; font-family: 'JetBrains Mono';">${winner.toUpperCase()}</div>
                    <div style="font-size: 12px; margin-top: 4px; opacity: 0.8;">${comparison.recommendation}</div>
                </div>

                <div class="compare-metrics-grid">
                    ${renderCompareMetric('⚡ Speed', metrics.speed.gemini, metrics.speed.local, 'ms', true)}
                    ${renderCompareMetric('✨ Quality', metrics.quality.gemini, metrics.quality.local, '', false)}
                    ${renderCompareMetric('🔢 Tokens', metrics.tokens.gemini, metrics.tokens.local, '', false)}
                    ${renderCompareMetric('💰 Cost', metrics.cost.gemini.toFixed(6), metrics.cost.local.toFixed(6), '$', true)}
                </div>
            </div>
        `;
    }

    const html = `
        <div class="modern-card glass-panel compare-modal">
            <button class="mc-close" id="mcCloseBtn">×</button>

            <div class="mc-header" style="border-bottom: 1px solid var(--sci-border);">
                <div style="flex:1;">
                    <h1 class="mc-phrase font-display" style="color: var(--sci-text-main);">${escapeHtml(phrase)}</h1>
                    <div class="mc-meta font-mono" style="color: var(--neon-purple);">
                        <span>MODEL COMPARISON</span>
                        <span>::</span>
                        <span>DUAL OUTPUT</span>
                    </div>
                </div>
            </div>

            <div class="mc-body" style="padding: 24px;">
                ${comparisonSection}

                <div class="compare-columns">
                    <!-- GEMINI Column -->
                    <div class="compare-column">
                        <div class="compare-column-header" style="background: linear-gradient(135deg, var(--neon-blue), var(--neon-purple)); color: white;">
                            <span class="model-icon">🤖</span>
                            <span>GEMINI</span>
                            ${!geminiOk ? '<span style="font-size:11px; opacity:0.8;">⚠ FAILED</span>' : ''}
                        </div>
                        ${geminiOk ? renderCompareContent(geminiResult) : `<div class="error-box">${escapeHtml(geminiResult.error)}</div>`}
                    </div>

                    <!-- LOCAL Column -->
                    <div class="compare-column">
                        <div class="compare-column-header" style="background: linear-gradient(135deg, var(--neon-amber), var(--neon-green)); color: white;">
                            <span class="model-icon">🏠</span>
                            <span>LOCAL LLM</span>
                            ${!localOk ? '<span style="font-size:11px; opacity:0.8;">⚠ FAILED</span>' : ''}
                        </div>
                        ${localOk ? renderCompareContent(localResult) : `<div class="error-box">${escapeHtml(localResult.error)}</div>`}
                    </div>
                </div>
            </div>
        </div>
    `;

    els.modalContainer.innerHTML = html;
    document.getElementById('mcCloseBtn').onclick = closeModal;
    els.modalOverlay.classList.remove('hidden');
    setTimeout(() => els.modalOverlay.classList.add('show'), 10);
}

function renderCompareMetric(label, geminiVal, localVal, unit, lowerIsBetter) {
    const geminiNum = Number(geminiVal);
    const localNum = Number(localVal);
    const geminiWins = lowerIsBetter ? geminiNum < localNum : geminiNum > localNum;
    const localWins = lowerIsBetter ? localNum < geminiNum : localNum > geminiNum;

    return `
        <div class="metric-row">
            <div class="metric-label">${label}</div>
            <div class="metric-values">
                <div class="metric-val ${geminiWins ? 'winner' : ''}" style="color: var(--neon-blue);">
                    ${geminiWins ? '🏆 ' : ''}${geminiVal}${unit}
                </div>
                <div class="vs-divider">vs</div>
                <div class="metric-val ${localWins ? 'winner' : ''}" style="color: var(--neon-green);">
                    ${localWins ? '🏆 ' : ''}${localVal}${unit}
                </div>
            </div>
        </div>
    `;
}

function renderCompareContent(result) {
    const obs = result.observability || {};
    const output = result.output || {};
    const mdContent = output.markdown_content || 'N/A';

    // 简化版 Markdown 渲染
    const htmlContent = marked.parse(mdContent);
    const safeHtml = sanitizeHtml(htmlContent);

    return `
        <div class="compare-content-section">
            <div class="compare-section">
                <div class="section-title">📝 Generated Content</div>
                <div class="content-preview">
                    ${safeHtml}
                </div>
            </div>

            <div class="compare-section">
                <div class="section-title">📊 Metrics</div>
                <div class="metrics-mini">
                    <div class="mini-metric">
                        <span>Quality:</span>
                        <span style="color: var(--neon-green); font-weight: 600;">${obs.quality?.score || 0}</span>
                    </div>
                    <div class="mini-metric">
                        <span>Tokens:</span>
                        <span>${obs.tokens?.total || 0}</span>
                    </div>
                    <div class="mini-metric">
                        <span>Time:</span>
                        <span>${obs.performance?.totalTime || 0}ms</span>
                    </div>
                    <div class="mini-metric">
                        <span>Cost:</span>
                        <span>$${(obs.cost?.total || 0).toFixed(6)}</span>
                    </div>
                </div>
            </div>

            <div class="compare-section">
                <div class="section-title">📋 Prompt</div>
                <div class="prompt-preview">
                    ${escapeHtml((obs.metadata?.promptText || obs.prompt?.full || obs.prompt?.text || '').substring(0, 300))}...
                </div>
            </div>
        </div>
    `;
}

// ==========================================
// 进度条与计时器
// ==========================================

function startProgress(phrase) {
    els.progressBar.classList.remove('hidden');
    els.promptText.textContent = phrase;
    els.progressStatus.style.color = '';
    
    // Reset steps
    document.querySelectorAll('.step').forEach(el => {
        el.classList.remove('active', 'done');
    });

    startTimer();
}

function hideProgress() {
    els.progressBar.classList.add('hidden');
    stopTimer();
}

function updateStep(stepName, statusText, isActive = true) {
    const steps = ['init', 'ocr', 'prompt', 'llm', 'parse', 'render', 'save', 'audio', 'complete'];
    const idx = steps.indexOf(stepName);
    
    document.querySelectorAll('.step').forEach((el, i) => {
        el.classList.remove('active', 'done');
        if (i < idx) el.classList.add('done');
        if (i === idx && isActive) el.classList.add('active');
        if (i === idx && !isActive) el.classList.add('done');
    });
    
    els.progressStatus.textContent = statusText;
}

function startTimer() {
    stopTimer();
    timerStartTime = Date.now();
    els.progressTimer.classList.add('running');
    els.progressTimer.textContent = '00:00';
    timerInterval = setInterval(() => {
        els.progressTimer.textContent = formatTime(Date.now() - timerStartTime);
    }, 1000);
}

function stopTimer() {
    if (timerInterval) clearInterval(timerInterval);
    els.progressTimer.classList.remove('running');
}

// ==========================================
// 图片 OCR
// ==========================================

function initImageHandlers() {
    const { imageDropZone, ocrBtn, clearImageBtn } = els;

    imageDropZone.addEventListener('dragover', e => { e.preventDefault(); imageDropZone.classList.add('dragover'); });
    imageDropZone.addEventListener('dragleave', () => imageDropZone.classList.remove('dragover'));
    imageDropZone.addEventListener('drop', e => {
        e.preventDefault();
        imageDropZone.classList.remove('dragover');
        handleFile(e.dataTransfer?.files[0]);
    });
    
    document.addEventListener('paste', e => {
        const items = e.clipboardData?.items;
        if (items) {
            for (const item of items) {
                if (item.type.startsWith('image/')) {
                    handleFile(item.getAsFile());
                    break;
                }
            }
        }
    });

    clearImageBtn.onclick = clearImage;
    ocrBtn.onclick = async () => {
        const base64 = store.get('imageBase64');
        if (!base64) return;

        ocrBtn.disabled = true;
        ocrBtn.textContent = '识别中...';
        
        try {
            startProgress('[OCR]');
            updateStep('ocr', '识别文字...');
            
            const data = await api.ocr(base64);
            
            els.phraseInput.value = data.text;
            updateStep('ocr', '识别完成', false);
            setTimeout(hideProgress, 1000);
        } catch (err) {
            alert('OCR Failed: ' + err.message);
            hideProgress();
        } finally {
            ocrBtn.disabled = false;
            ocrBtn.textContent = '识别文字';
        }
    };
}

function handleFile(file) {
    if (!file || !file.type.startsWith('image/')) return;
    if (file.size > 4 * 1024 * 1024) {
        alert('图片过大 (>4MB)');
        return;
    }

    const reader = new FileReader();
    reader.onload = () => {
        store.setState({ imageBase64: reader.result });
        els.imagePreview.src = reader.result;
        els.imagePreview.classList.remove('hidden');
        els.imageDropZone.querySelector('.drop-hint').classList.add('hidden');
        els.ocrBtn.disabled = false;
        els.clearImageBtn.disabled = false;
    };
    reader.readAsDataURL(file);
}

function clearImage() {
    store.setState({ imageBase64: null });
    els.imagePreview.src = '';
    els.imagePreview.classList.add('hidden');
    els.imageDropZone.querySelector('.drop-hint').classList.remove('hidden');
    els.ocrBtn.disabled = true;
    els.clearImageBtn.disabled = true;
}

// ==========================================
// 卡片弹窗与音频
// ==========================================

function initModal() {
    els.modalOverlay.onclick = (e) => {
        if (e.target === els.modalOverlay) closeModal();
    };
    document.addEventListener('keydown', e => {
        if (e.key === 'Escape') closeModal();
    });
}

function renderCardModal(markdown, title, options = {}) {
    let displayTitle = title;
    const h1Match = markdown.match(/^#\s+(.+)$/m);
    if (h1Match) displayTitle = h1Match[1];

    const html = marked.parse(markdown);
    // 处理音频标签
    const processedHtml = html.replace(/<audio\b([^>]*?)\s+src=(['"])([^'"]+)\2([^>]*)>/gi, (match, pre, quote, src, post) => {
        return `<button class="audio-btn" data-src="${src}">▶</button>`;
    });

    const safeHtml = sanitizeHtml(processedHtml);

    // 尝试获取 observability 数据 (优先使用传入的 options.metrics，其次是 local storage)
    let rawMetrics = options.metrics;
    if (!rawMetrics) {
        try {
            const raw = localStorage.getItem('latest_observability');
            if (raw) rawMetrics = JSON.parse(raw);
        } catch (e) {}
    }
    
    // Normalize metrics: Handle case where metrics is the whole DB record
    let metrics = rawMetrics;
    if (rawMetrics && rawMetrics.observability) {
        // DB Record structure
        const obs = rawMetrics.observability;
        metrics = {
            quality: { score: obs.quality_score },
            tokens: { input: obs.tokens_input, output: obs.tokens_output, total: obs.tokens_total },
            cost: { total: obs.cost_total },
            performance: { totalTime: obs.performance_total_ms, phases: obs.performance_phases },
            metadata: obs.metadata
        };
    }
    
    // Fallback defaults
    metrics = metrics || {
        quality: { score: 0 },
        performance: { totalTime: 0, phases: {} },
        tokens: { total: 0, input: 0, output: 0 },
        cost: { total: 0 }
    };

    const tokens = metrics.tokens || { input: 0, output: 0 };
    
    // Calculate Rank
    const score = metrics.quality?.score || 0;
    const rank = score >= 90 ? 'S' : score >= 80 ? 'A' : score >= 70 ? 'B' : score >= 60 ? 'C' : 'D';
    const rankColor = score >= 80 ? 'var(--neon-green)' : score >= 60 ? 'var(--neon-amber)' : 'var(--neon-red)';

    els.modalContainer.innerHTML = `
        <div class="modern-card glass-panel" style="background: #ffffff;">
            <button class="mc-close" id="mcCloseBtn">×</button>

            <div class="mc-header" style="border-bottom: 1px solid var(--sci-border);">
                <div style="flex:1;">
                    <h1 class="mc-phrase font-display" style="color: var(--sci-text-main);">${escapeHtml(displayTitle)}</h1>
                    <div class="mc-meta font-mono" style="color: var(--neon-blue);">
                        <span>TRILINGUAL</span>
                        <span>::</span>
                        <span>${new Date().getFullYear()}</span>
                    </div>
                </div>

                <div class="panel-tabs sub-tabs" style="margin:0; border:none; background: #f3f4f6; border-radius: 8px; padding: 4px;">
                    <button class="tab-btn active" data-target="cardContent" style="font-size:12px; padding: 4px 12px;">CONTENT</button>
                    <button class="tab-btn" data-target="cardIntel" style="font-size:12px; padding: 4px 12px; color: var(--neon-purple);">INTEL</button>
                </div>
            </div>

            <!-- Content Tab -->
            <div id="cardContent" class="mc-body mc-content" style="display:block;">
                ${safeHtml}
            </div>

            <!-- Intel Tab (HUD) -->
            <div id="cardIntel" class="mc-body intel-hud-grid" style="display:none;">

                <!-- 1. Core Reactor -->
                <div class="hud-card-score tooltip-trigger" data-tooltip="综合质量评分 - 满分 100 分" style="border-left-color: ${rankColor};">
                    <div>
                        <div class="intel-label">QUALITY GRADE</div>
                        <div class="score-value-container">
                            <div class="score-main" style="color: ${rankColor}; text-shadow: 0 0 20px ${rankColor}66;">${score}</div>
                            <div class="score-rank">RANK ${rank}</div>
                        </div>
                    </div>
                    <div class="score-meta">
                        <div class="meta-row">
                            <span class="meta-label">PROVIDER</span>
                            <span class="meta-val" style="color: var(--neon-purple);">${(store.get('llmProvider') || 'LOCAL').toUpperCase()}</span>
                        </div>
                        <div class="meta-row">
                            <span class="meta-label">MODEL</span>
                            <span class="meta-val">${metrics.metadata?.model || 'UNKNOWN'}</span>
                        </div>
                        <div class="meta-row">
                            <span class="meta-label">LATENCY</span>
                            <span class="meta-val">${metrics.performance?.totalTime || 0}ms</span>
                        </div>
                    </div>
                    ${score < 70 ? `<div style="margin-top:12px; padding:8px; background:rgba(239,68,68,0.05); border:1px solid rgba(239,68,68,0.2); border-radius:4px; font-size:11px; color:#dc2626;">⚠ Quality below threshold. Check dimensions.</div>` : ''}
                </div>

                <!-- 2. Quality Dimensions (Enhanced) -->
                <div class="hud-card">
                    <div class="hud-title tooltip-trigger" data-tooltip="质量 4 维度评分 - 完整性/准确性/例句/格式">
                        <span>DIMENSIONS</span>
                        <span style="color: var(--neon-green);">4-AXIS</span>
                    </div>
                    <div style="display:flex; flex-direction:column; gap:10px; margin-top:12px;">
                        ${renderDimensionBar('Completeness', metrics.quality?.dimensions?.completeness || 0, 40, 'var(--neon-green)', '完整性 - 内容结构完整度')}
                        ${renderDimensionBar('Accuracy', metrics.quality?.dimensions?.accuracy || 0, 30, 'var(--neon-blue)', '准确性 - 翻译和定义准确度')}
                        ${renderDimensionBar('Example Quality', metrics.quality?.dimensions?.exampleQuality || 0, 20, 'var(--neon-purple)', '例句质量 - 例句自然度和多样性')}
                        ${renderDimensionBar('Formatting', metrics.quality?.dimensions?.formatting || 0, 10, 'var(--neon-amber)', '格式化 - HTML 和音频标签正确性')}
                    </div>
                </div>

                <!-- 3. Config Display -->
                <div class="hud-card">
                    <div class="hud-title tooltip-trigger" data-tooltip="生成配置参数 - 控制 AI 输出的随机性和长度">
                        <span>GENERATION CONFIG</span>
                        <span style="color: var(--neon-amber);">PARAMS</span>
                    </div>
                    <div style="font-family:'JetBrains Mono'; font-size:11px; margin-top:12px; display:flex; flex-direction:column; gap:6px;">
                        <div class="tooltip-trigger" data-tooltip="温度参数 - 控制输出随机性 (0-1)" style="display:flex; justify-content:space-between;"><span style="color:var(--sci-text-muted);">Temperature:</span><span>${metrics.metadata?.temperature || 0.7}</span></div>
                        <div class="tooltip-trigger" data-tooltip="最大输出长度 - 限制生成的 token 数量" style="display:flex; justify-content:space-between;"><span style="color:var(--sci-text-muted);">Max Tokens:</span><span>${metrics.metadata?.maxOutputTokens || 2048}</span></div>
                        <div class="tooltip-trigger" data-tooltip="Top-P 采样 - 核心采样概率阈值" style="display:flex; justify-content:space-between;"><span style="color:var(--sci-text-muted);">Top P:</span><span>${metrics.metadata?.topP || 0.95}</span></div>
                    </div>
                </div>

                <!-- 4. Chrono Waterfall -->
                <div class="hud-card">
                    <div class="hud-title tooltip-trigger" data-tooltip="时序分析 - 各阶段耗时分布">
                        <span>CHRONO SEQUENCE</span>
                        <span style="color: var(--neon-blue);">T-MINUS</span>
                    </div>
                    <div id="hudTimeline" class="chart-box"></div>
                </div>

                <!-- 5. Token Flux -->
                <div class="hud-card">
                    <div class="hud-title tooltip-trigger" data-tooltip="Token 使用情况 - 输入和输出 token 统计">
                        <span>TOKEN FLUX</span>
                        <span style="color: var(--neon-purple);">USAGE</span>
                    </div>
                    <div id="hudTokens" class="chart-box"></div>
                    <div class="token-stat-row">
                        <span class="tooltip-inline tooltip-trigger" data-tooltip="输入 tokens">IN: ${tokens.input}</span>
                        <span class="tooltip-inline tooltip-trigger" data-tooltip="输出 tokens">OUT: ${tokens.output}</span>
                    </div>
                    <div class="token-cost-tag tooltip-trigger" data-tooltip="本次生成成本 - 基于 token 使用量计费">COST: $${(metrics.cost?.total || 0).toFixed(6)}</div>
                </div>

                <!-- 6. Radar Chart -->
                <div class="hud-card hud-card-wide">
                    <div class="hud-title tooltip-trigger" data-tooltip="质量维度雷达图 - 可视化各维度表现">
                        <span>DIMENSIONAL SCAN</span>
                        <span style="color: var(--neon-green);">RADAR</span>
                    </div>
                    <div id="hudRadar" class="chart-box" style="height: 200px;"></div>
                </div>

                <!-- 7. Prompt Viewer (Collapsible) -->
                <div class="hud-card hud-card-wide">
                    <div class="hud-title tooltip-trigger" data-tooltip="完整 Prompt 文本 - 点击展开查看发送给 AI 的完整提示词" style="cursor:pointer;" onclick="this.parentElement.querySelector('.collapsible-content').classList.toggle('hidden')">
                        <span>📄 PROMPT TEXT</span>
                        <span style="color: var(--sci-text-muted); font-size:11px;">CLICK TO EXPAND</span>
                    </div>
                    <div class="collapsible-content hidden" style="margin-top:12px; max-height:200px; overflow-y:auto; background:#f9fafb; border:1px solid #e5e7eb; padding:12px; border-radius:4px; font-family:'JetBrains Mono'; font-size:11px; line-height:1.4; color:#4b5563; white-space:pre-wrap; word-wrap:break-word;">${escapeHtml(metrics.metadata?.promptText || 'N/A')}</div>
                    <button onclick="navigator.clipboard.writeText('${(metrics.metadata?.promptText || '').replace(/'/g, "\\'")}'); alert('Copied!')" style="margin-top:8px; padding:6px 12px; background:var(--neon-blue); border:none; border-radius:4px; color:#fff; font-family:'JetBrains Mono'; font-size:11px; cursor:pointer; transition:opacity 0.2s;" onmouseover="this.style.opacity='0.8'" onmouseout="this.style.opacity='1'">COPY</button>
                </div>

                <!-- 8. Output Viewer (Collapsible) -->
                <div class="hud-card hud-card-wide">
                    <div class="hud-title tooltip-trigger" data-tooltip="AI 原始输出 - 点击展开查看 AI 返回的原始 JSON 数据" style="cursor:pointer;" onclick="this.parentElement.querySelector('.collapsible-content').classList.toggle('hidden')">
                        <span>📤 LLM OUTPUT</span>
                        <span style="color: var(--sci-text-muted); font-size:11px;">CLICK TO EXPAND</span>
                    </div>
                    <div class="collapsible-content hidden" style="margin-top:12px; max-height:200px; overflow-y:auto; background:#f9fafb; border:1px solid #e5e7eb; padding:12px; border-radius:4px; font-family:'JetBrains Mono'; font-size:11px; line-height:1.4; color:#4b5563; white-space:pre-wrap; word-wrap:break-word;">${escapeHtml(metrics.metadata?.rawOutput || 'N/A')}</div>
                    <button onclick="navigator.clipboard.writeText('${(metrics.metadata?.rawOutput || '').replace(/'/g, "\\'")}'); alert('Copied!')" style="margin-top:8px; padding:6px 12px; background:var(--neon-purple); border:none; border-radius:4px; color:#fff; font-family:'JetBrains Mono'; font-size:11px; cursor:pointer; transition:opacity 0.2s;" onmouseover="this.style.opacity='0.8'" onmouseout="this.style.opacity='1'">COPY</button>
                </div>

                <!-- 9. Export Controls -->
                <div class="hud-card" style="display:flex; flex-direction:column; gap:8px;">
                    <div class="hud-title tooltip-trigger" data-tooltip="导出指标数据 - 以 JSON 或 CSV 格式保存">
                        <span>EXPORT</span>
                        <span style="color: var(--neon-amber);">DATA</span>
                    </div>
                    <button class="tooltip-trigger" data-tooltip="导出为 JSON 格式 - 包含完整结构化数据" onclick="exportMetrics('json')" style="padding:8px; background:rgba(16,185,129,0.1); border:1px solid rgba(16,185,129,0.3); border-radius:4px; color:#059669; font-family:'JetBrains Mono'; font-size:11px; cursor:pointer;">📊 EXPORT JSON</button>
                    <button class="tooltip-trigger" data-tooltip="导出为 CSV 格式 - 适合导入 Excel 分析" onclick="exportMetrics('csv')" style="padding:8px; background:rgba(59,130,246,0.1); border:1px solid rgba(59,130,246,0.3); border-radius:4px; color:#2563eb; font-family:'JetBrains Mono'; font-size:11px; cursor:pointer;">📈 EXPORT CSV</button>
                </div>

            </div>
        </div>
    `;

    // 绑定关闭按钮
    document.getElementById('mcCloseBtn').onclick = closeModal;

    // 绑定 Tab 切换 (带图表渲染触发)
    const tabs = els.modalContainer.querySelectorAll('.tab-btn');
    tabs.forEach(btn => {
        btn.onclick = () => {
            tabs.forEach(t => t.classList.remove('active'));
            btn.classList.add('active');
            
            const targetId = btn.dataset.target;
            els.modalContainer.querySelector('#cardContent').style.display = targetId === 'cardContent' ? 'block' : 'none';
            const intelTab = els.modalContainer.querySelector('#cardIntel');
            
            if (targetId === 'cardIntel') {
                intelTab.style.display = 'grid';
                requestAnimationFrame(() => renderIntelCharts(metrics));
            } else {
                intelTab.style.display = 'none';
            }
        };
    });

    // 绑定音频按钮
    const folder = store.get('selectedFolder');
    els.modalContainer.querySelectorAll('.audio-btn').forEach(btn => {
        const src = btn.dataset.src;
        if (src) {
            const url = `/api/folders/${encodeURIComponent(folder)}/files/${encodeURIComponent(src)}`;
            btn.onclick = () => player.play(url, btn);
        }
    });

    els.modalOverlay.classList.remove('hidden');
    setTimeout(() => els.modalOverlay.classList.add('show'), 10);
}

// 渲染质量维度条
function renderDimensionBar(label, value, maxValue, color, tooltip = '') {
    const percentage = (value / maxValue) * 100;
    const barColor = percentage >= 80 ? color : percentage >= 60 ? 'var(--neon-amber)' : 'var(--neon-red)';
    const tooltipAttr = tooltip ? `class="tooltip-trigger" data-tooltip="${tooltip}"` : '';
    return `
        <div ${tooltipAttr}>
            <div style="display:flex; justify-content:space-between; margin-bottom:4px; font-size:11px;">
                <span style="color:var(--sci-text-muted);">${label}</span>
                <span style="color:${barColor}; font-family:'JetBrains Mono';">${value}/${maxValue}</span>
            </div>
            <div style="background:#e5e7eb; height:6px; border-radius:3px; overflow:hidden;">
                <div style="background:${barColor}; height:100%; width:${percentage}%; box-shadow:0 0 8px ${barColor}; transition:width 0.3s;"></div>
            </div>
        </div>
    `;
}

// 导出指标数据
window.exportMetrics = function(format) {
    try {
        const raw = localStorage.getItem('latest_observability');
        if (!raw) {
            alert('No metrics data available');
            return;
        }
        const data = JSON.parse(raw);

        if (format === 'json') {
            const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = `metrics_${Date.now()}.json`;
            a.click();
            URL.revokeObjectURL(url);
        } else if (format === 'csv') {
            const csv = [
                'Field,Value',
                `Quality Score,${data.quality?.score || 0}`,
                `Completeness,${data.quality?.dimensions?.completeness || 0}`,
                `Accuracy,${data.quality?.dimensions?.accuracy || 0}`,
                `Example Quality,${data.quality?.dimensions?.exampleQuality || 0}`,
                `Formatting,${data.quality?.dimensions?.formatting || 0}`,
                `Tokens Input,${data.tokens?.input || 0}`,
                `Tokens Output,${data.tokens?.output || 0}`,
                `Tokens Total,${data.tokens?.total || 0}`,
                `Cost Total,${data.cost?.total || 0}`,
                `Latency Total,${data.performance?.totalTime || 0}`,
                `Provider,${data.metadata?.provider || 'N/A'}`,
                `Model,${data.metadata?.model || 'N/A'}`
            ].join('\n');

            const blob = new Blob([csv], { type: 'text/csv' });
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = `metrics_${Date.now()}.csv`;
            a.click();
            URL.revokeObjectURL(url);
        }
    } catch (err) {
        console.error('Export failed:', err);
        alert('Export failed: ' + err.message);
    }
};

// 渲染 Intel 面板图表
function renderIntelCharts(metrics) {
    if (!window.d3) return; 

    // 1. Timeline
    {
        const container = document.getElementById('hudTimeline');
        container.innerHTML = '';
        const width = container.clientWidth;
        const height = container.clientHeight;
        const phases = metrics.performance?.phases || {};
        const data = [
            { label: "PROMPT", start: 0, dur: phases.promptBuild || 10, color: "#3b82f6" },
            { label: "LLM", start: phases.promptBuild || 10, dur: phases.llmCall || 100, color: "#a855f7" },
            { label: "PARSE", start: (phases.promptBuild||10) + (phases.llmCall||100), dur: phases.jsonParse || 10, color: "#10b981" },
            { label: "TTS", start: (phases.promptBuild||10) + (phases.llmCall||100) + (phases.jsonParse||10), dur: phases.audioGenerate || 0, color: "#f59e0b" }
        ].filter(d => d.dur > 0);
        
        const total = metrics.performance?.totalTime || d3.max(data, d => d.start + d.dur) || 1000;
        const svg = d3.select(container).append("svg").attr("width", width).attr("height", height);
        
        const x = d3.scaleLinear().domain([0, total]).range([0, width]);
        const y = d3.scaleBand().domain(data.map(d => d.label)).range([0, height]).padding(0.4);

        svg.selectAll("rect")
           .data(data)
           .enter().append("rect")
           .attr("x", d => x(d.start))
           .attr("y", d => y(d.label))
           .attr("width", d => x(d.dur))
           .attr("height", y.bandwidth())
           .attr("rx", 4)
           .attr("fill", d => d.color)
           .style("filter", d => `drop-shadow(0 0 4px ${d.color})`);

        svg.selectAll("text")
           .data(data)
           .enter().append("text")
           .attr("x", d => x(d.start) + 4)
           .attr("y", d => y(d.label) + y.bandwidth()/2 + 4)
           .text(d => d.dur > 50 ? `${d.label} ${d.dur}ms` : '')
           .attr("font-size", "10px")
           .attr("fill", "#fff")
           .style("font-family", "JetBrains Mono");
    }

    // 2. Token Flux
    {
        const container = document.getElementById('hudTokens');
        container.innerHTML = '';
        const width = container.clientWidth;
        const height = container.clientHeight;
        const tokens = metrics.tokens || { input: 0, output: 0 };
        const total = (tokens.input + tokens.output) || 1;
        
        const svg = d3.select(container).append("svg").attr("width", width).attr("height", height);
        
        const data = [
            { type: "INPUT", val: tokens.input, color: "#3b82f6", x: 0, w: (tokens.input/total)*width },
            { type: "OUTPUT", val: tokens.output, color: "#a855f7", x: (tokens.input/total)*width, w: (tokens.output/total)*width }
        ];

        svg.append("rect").attr("width", width).attr("height", 24).attr("y", height/2 - 12)
           .attr("rx", 4).attr("fill", "rgba(255,255,255,0.05)");

        svg.selectAll("rect.bar")
           .data(data)
           .enter().append("rect")
           .attr("class", "bar")
           .attr("x", d => d.x)
           .attr("y", height/2 - 12)
           .attr("width", d => d.w)
           .attr("height", 24)
           .attr("fill", d => d.color)
           .attr("rx", 2);
           
        svg.selectAll("text")
           .data(data)
           .enter().append("text")
           .attr("x", d => d.x + d.w/2)
           .attr("y", height/2 + 4)
           .attr("text-anchor", "middle")
           .text(d => d.w > 30 ? d.type : '')
           .attr("font-size", "10px")
           .attr("fill", "rgba(255,255,255,0.8)")
           .style("font-family", "JetBrains Mono");
    }

    // 3. Radar
    {
        const container = document.getElementById('hudRadar');
        container.innerHTML = '';
        const width = container.clientWidth;
        const height = container.clientHeight;
        const margin = 30;
        const radius = Math.min(width, height)/2 - margin;
        
        const svg = d3.select(container).append("svg").attr("width", width).attr("height", height)
                      .append("g").attr("transform", `translate(${width/2},${height/2})`);
        
        const dims = metrics.quality?.dimensions || { completeness:0, accuracy:0, formatting:0 };
        const data = Object.entries(dims).map(([k,v]) => ({ axis: k.toUpperCase(), value: v }));
        const angleSlice = Math.PI * 2 / data.length;
        const rScale = d3.scaleLinear().range([0, radius]).domain([0, 100]);
        
        [25, 50, 75, 100].forEach(level => {
            svg.append("circle").attr("r", rScale(level)).attr("fill", "none")
               .attr("stroke", "rgba(255,255,255,0.1)").attr("stroke-dasharray", "4,4");
        });
        
        const axis = svg.selectAll(".axis").data(data).enter().append("g");
        axis.append("line")
            .attr("x1", 0).attr("y1", 0)
            .attr("x2", (d, i) => rScale(100) * Math.cos(angleSlice * i - Math.PI/2))
            .attr("y2", (d, i) => rScale(100) * Math.sin(angleSlice * i - Math.PI/2))
            .attr("stroke", "rgba(255,255,255,0.1)");
            
        axis.append("text")
            .attr("x", (d, i) => rScale(115) * Math.cos(angleSlice * i - Math.PI/2))
            .attr("y", (d, i) => rScale(115) * Math.sin(angleSlice * i - Math.PI/2))
            .text(d => d.axis)
            .style("text-anchor", "middle")
            .style("font-size", "10px")
            .style("fill", "#94a3b8")
            .style("font-family", "JetBrains Mono");
            
        const line = d3.lineRadial()
            .angle((d,i) => i*angleSlice)
            .radius(d => rScale(d.value))
            .curve(d3.curveLinearClosed);
            
        svg.append("path")
           .datum(data)
           .attr("d", line)
           .attr("fill", "rgba(16, 185, 129, 0.2)")
           .attr("stroke", "#10b981")
           .attr("stroke-width", 2)
           .style("filter", "drop-shadow(0 0 8px rgba(16, 185, 129, 0.4))");
    }
}

function closeModal() {
    els.modalOverlay.classList.remove('show');
    player.stop(); // 关闭卡片时停止播放
    setTimeout(() => els.modalOverlay.classList.add('hidden'), 300);
}

// ==========================================
// Tab 切换与历史记录
// ==========================================

function initTabs() {
    const tabs = document.querySelectorAll('.tab-btn');
    const contents = document.querySelectorAll('.tab-content');
    
    tabs.forEach(btn => {
        btn.onclick = () => {
            tabs.forEach(t => t.classList.remove('active'));
            contents.forEach(c => c.classList.remove('active'));
            
            btn.classList.add('active');
            const target = btn.dataset.tab;
            document.querySelector(`.tab-content[data-content="${target}"]`).classList.add('active');
            
            if (target === 'history' && !store.get('history').loaded) {
                loadHistory();
            }
        };
    });
}

// ==========================================
// 历史记录逻辑
// ==========================================

async function initHistory() {
    // 搜索与过滤
    const doSearch = debounce(() => {
        store.setState({ 
            history: { 
                ...store.get('history'), 
                searchQuery: els.historySearch.value,
                currentPage: 1 
            }
        });
        loadHistory();
    }, 500);

    els.historySearch.oninput = doSearch;
    
    els.historyProviderFilter.onchange = () => {
        store.setState({ 
            history: { 
                ...store.get('history'), 
                providerFilter: els.historyProviderFilter.value,
                currentPage: 1 
            }
        });
        loadHistory();
    };

    // 分页
    els.historyPrevBtn.onclick = () => changePage(-1);
    els.historyNextBtn.onclick = () => changePage(1);
    
    // 右键菜单
    document.addEventListener('click', () => els.contextMenu.classList.add('hidden'));
    
    // 绑定菜单删除事件
    document.querySelector('[data-action="delete"]').onclick = async () => {
        const id = els.contextMenu.dataset.targetId;
        if (id) await deleteHistoryRecord(id);
    };
}

async function loadHistory(options = {}) {
    const { noCache = false } = options;
    const hState = store.get('history');
    els.historyList.innerHTML = '<div class="loading-hint">加载中...</div>';

    try {
        const data = await api.getHistory({
            page: hState.currentPage,
            limit: hState.pageSize,
            search: hState.searchQuery,
            provider: hState.providerFilter
        }, noCache);

        const records = data.records || [];
        store.setState({
            history: {
                ...hState,
                records,
                totalCount: data.pagination.total,
                totalPages: data.pagination.totalPages,
                loaded: true
            }
        });

        renderHistory(records);
        updatePagination();

    } catch (err) {
        els.historyList.innerHTML = '<div class="error-hint">加载失败</div>';
    }
}

function renderHistory(records) {
    if (!records.length) {
        els.historyList.innerHTML = '<div class="empty-hint">暂无记录</div>';
        return;
    }

    els.historyList.innerHTML = records.map(r => `
        <div class="history-item" data-id="${r.id}">
            <div class="history-item-phrase">${escapeHtml(r.phrase)}</div>
            <div class="history-item-meta">
                <span>${r.llm_provider === 'gemini' ? '🤖' : '🏠'} ${r.llm_provider}</span>
                <span>${formatDate(r.created_at)}</span>
                <span class="quality-badge q-${Math.floor(r.quality_score/10)}0">${r.quality_score}</span>
            </div>
            ${r.zh_translation ? `<div class="history-trans">${escapeHtml(r.zh_translation)}</div>` : ''}
        </div>
    `).join('');
    
    // 绑定事件
    els.historyList.querySelectorAll('.history-item').forEach(item => {
        const id = item.dataset.id;
        
        // 左键详情
        item.onclick = async () => {
            try {
                const res = await api.getHistoryDetail(id);
                const record = res.record;
                const mdContent = await api.getFileContent(record.folder_name, record.base_filename + '.md');
                // 模拟选中文件夹以支持音频播放
                store.setState({ selectedFolder: record.folder_name });
                renderCardModal(mdContent, record.phrase, {
                    folder: record.folder_name,
                    baseName: record.base_filename,
                    metrics: record
                });
            } catch (err) {
                alert('无法加载记录详情');
            }
        };

        // 右键菜单
        item.oncontextmenu = (e) => {
            e.preventDefault();
            els.contextMenu.classList.remove('hidden');
            els.contextMenu.style.left = `${e.pageX}px`;
            els.contextMenu.style.top = `${e.pageY}px`;
            els.contextMenu.dataset.targetId = id;
        };
    });
    
    els.historyCount.textContent = store.get('history').totalCount;
}

function updatePagination() {
    const h = store.get('history');
    els.historyPageInfo.textContent = `${h.currentPage} / ${h.totalPages}`;
    els.historyPrevBtn.disabled = h.currentPage <= 1;
    els.historyNextBtn.disabled = h.currentPage >= h.totalPages;
}

async function changePage(delta) {
    const h = store.get('history');
    const newPage = h.currentPage + delta;
    if (newPage > 0 && newPage <= h.totalPages) {
        store.setState({ history: { ...h, currentPage: newPage } });
        await loadHistory();
    }
}

async function deleteHistoryRecord(id) {
    if (!confirm('确定删除此记录及其所有文件吗？不可恢复。')) return;
    
    try {
        await api.deleteRecord(id);
        // 刷新列表
        loadHistory({ noCache: true });
        loadFolders({ refreshFiles: true, noCache: true });
        els.contextMenu.classList.add('hidden');
    } catch (err) {
        alert('删除失败: ' + err.message);
    }
}

// 启动应用
init();