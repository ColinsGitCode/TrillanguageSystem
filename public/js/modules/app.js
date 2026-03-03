/**
 * 主应用入口
 */
import { api } from './api.js';
import { store } from './store.js';
import { player } from './audio-player.js';
import { escapeHtml, sanitizeHtml, formatTime, formatDate, debounce } from './utils.js';
import { initInfoModal, createInfoBtn, bindInfoButtons } from './info-modal.js';

// DOM Elements
const els = {
    folderList: document.getElementById('folderList'),
    fileList: document.getElementById('fileList'),
    folderCount: document.getElementById('folderCount'),
    fileCount: document.getElementById('fileCount'),
    
    // Generator
    phraseInput: document.getElementById('phraseInput'),
    genBtn: document.getElementById('genBtn'),
    cardTypeHint: document.getElementById('cardTypeHint'),
    
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
    contextMenu: document.getElementById('contextMenu'),

    // Setup
    setupOverlay: document.getElementById('setupOverlay'),
    setupCard: document.getElementById('setupCard')
};

let fileListState = null;
const reviewState = {
    activeCampaign: null,
    reviewer: localStorage.getItem('review_reviewer') || 'owner'
};
let selectionFabCleanup = null;
let activeCardContext = null;

const generationQueueState = {
    tasks: [],
    running: false,
    nextSeq: 1,
    maxRetries: 2,
    maxTasks: 100,
    refreshScheduled: false,
    retryTimerId: null,
    panelEl: null,
    summaryEl: null,
    listEl: null,
    toastEl: null,
    collapseBtn: null,
    clearDoneBtn: null,
    retryFailedBtn: null
};
const QUEUE_SNAPSHOT_STORAGE_KEY = 'generation_queue_snapshot_v1';
const TODAY_FOLDER_TASK_ENTRIES = new Set(['main-input', 'selection', 'ocr-input']);
const CARD_HIGHLIGHT_STORAGE_PREFIX = 'card_highlight_v1';
const SELECTION_GENERATE_MAX_CHARS = 200;
const SELECTION_HIGHLIGHT_MAX_CHARS = 2000;

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
    initCardTypeSelector();
    initGenerator();
    initModal();
    initGenerationQueuePanel();
    initHistory();
    initInfoModal(); // Initialize Info Modal
    ensureFileListState();
    initGeminiSetup();
    // 加载初始数据
    loadFolders();

    // 自动刷新
    setInterval(() => loadFolders({ keepSelection: true, refreshFiles: true }), 60000);
}

// ==========================================
// Gemini CLI 初始化设置
// ==========================================

let setupPollTimer = null;

async function initGeminiSetup() {
    try {
        const status = await api.getGeminiAuthStatus();
        if (!status.enabled || status.authenticated) return;
        renderSetupOverlay(status);
        startSetupPolling();
    } catch (err) {
        console.error('Gemini setup status failed:', err);
    }
}

function renderSetupOverlay(status = {}) {
    if (!els.setupOverlay || !els.setupCard) return;
    els.setupOverlay.classList.remove('hidden');
    els.setupCard.innerHTML = `
      <div class="setup-header">
        <div>
          <h2 class="setup-title">初始化设置 · Gemini CLI 认证</h2>
          <p class="setup-subtitle">首次使用需要登录 Google 账号以启用 Gemini CLI。</p>
        </div>
      </div>
      <ol class="setup-steps">
        <li>点击“开始认证”生成登录链接</li>
        <li>浏览器完成登录后复制授权码</li>
        <li>粘贴授权码并提交</li>
      </ol>
      <div class="setup-actions">
        <button class="btn-secondary" id="setupStartBtn">开始认证</button>
        <button class="btn-text" id="setupRefreshBtn">刷新状态</button>
      </div>
      <div class="setup-status" id="setupStatus">等待开始认证。</div>
      <div class="setup-auth hidden" id="setupAuthBlock">
        <div class="setup-field">
          <label>登录链接</label>
          <div class="setup-input-row">
            <input id="setupAuthUrl" readonly placeholder="点击开始认证获取链接" />
            <button class="btn-primary" id="setupOpenBtn">打开</button>
          </div>
        </div>
        <div class="setup-field">
          <label>授权码</label>
          <div class="setup-input-row">
            <input id="setupAuthCode" placeholder="粘贴授权码" />
            <button class="btn-secondary" id="setupSubmitBtn">提交</button>
          </div>
        </div>
        <div class="setup-help">如果提示授权码失效，请重新点击“开始认证”获取新链接。</div>
      </div>
    `;

    bindSetupEvents();
    if (status.url) {
        updateSetupAuthBlock(status.url);
        updateSetupStatus('已生成登录链接，请完成授权。');
    }
}

function bindSetupEvents() {
    const startBtn = document.getElementById('setupStartBtn');
    const refreshBtn = document.getElementById('setupRefreshBtn');
    const openBtn = document.getElementById('setupOpenBtn');
    const submitBtn = document.getElementById('setupSubmitBtn');

    if (startBtn) startBtn.onclick = handleSetupStart;
    if (refreshBtn) refreshBtn.onclick = handleSetupRefresh;
    if (openBtn) openBtn.onclick = handleSetupOpen;
    if (submitBtn) submitBtn.onclick = handleSetupSubmit;
}

function updateSetupStatus(text) {
    const statusEl = document.getElementById('setupStatus');
    if (statusEl) statusEl.textContent = text;
}

function updateSetupAuthBlock(url) {
    const block = document.getElementById('setupAuthBlock');
    const input = document.getElementById('setupAuthUrl');
    if (block) block.classList.remove('hidden');
    if (input) input.value = url || '';
}

async function handleSetupStart() {
    updateSetupStatus('正在生成登录链接...');
    try {
        const data = await api.startGeminiAuth();
        if (data.url) {
            updateSetupAuthBlock(data.url);
            updateSetupStatus('登录链接已生成，请完成授权并提交授权码。');
        } else if (data.authenticated) {
            finishSetup();
        }
    } catch (err) {
        updateSetupStatus(`启动失败：${err.message}`);
    }
}

async function handleSetupRefresh() {
    updateSetupStatus('正在刷新状态...');
    try {
        const data = await api.getGeminiAuthStatus();
        if (data.authenticated) {
            finishSetup();
            return;
        }
        if (data.url) updateSetupAuthBlock(data.url);
        updateSetupStatus(data.url ? '等待授权码提交。' : '请点击开始认证生成链接。');
    } catch (err) {
        updateSetupStatus(`刷新失败：${err.message}`);
    }
}

function handleSetupOpen() {
    const input = document.getElementById('setupAuthUrl');
    if (input && input.value) {
        window.open(input.value, '_blank', 'noopener');
    }
}

async function handleSetupSubmit() {
    const input = document.getElementById('setupAuthCode');
    const code = input ? input.value.trim() : '';
    if (!code) {
        updateSetupStatus('请输入授权码。');
        return;
    }
    updateSetupStatus('正在提交授权码...');
    try {
        const result = await api.submitGeminiAuth(code);
        if (result.status === 'success') {
            finishSetup();
        } else if (result.status === 'retry') {
            updateSetupAuthBlock(result.url);
            updateSetupStatus('授权码失效，请重新登录获取新授权码。');
        } else {
            updateSetupStatus('授权处理中，请稍后刷新状态。');
        }
    } catch (err) {
        updateSetupStatus(`提交失败：${err.message}`);
    }
}

function startSetupPolling() {
    if (setupPollTimer) return;
    setupPollTimer = setInterval(async () => {
        try {
            const status = await api.getGeminiAuthStatus();
            if (status.authenticated) {
                finishSetup();
                return;
            }
            if (status.url) updateSetupAuthBlock(status.url);
        } catch (err) {
            console.error('Gemini auth polling failed:', err);
        }
    }, 3000);
}

function finishSetup() {
    if (setupPollTimer) {
        clearInterval(setupPollTimer);
        setupPollTimer = null;
    }
    if (els.setupOverlay) els.setupOverlay.classList.add('hidden');
    updateSetupStatus('认证完成。');
}

// ==========================================
// 文件夹与文件浏览
// ==========================================

function parseDateFolderKey(name) {
    const match = name.match(/^(\d{4})(\d{2})(\d{2})$/);
    if (!match) return null;

    const year = Number(match[1]);
    const month = Number(match[2]);
    const day = Number(match[3]);
    const date = new Date(year, month - 1, day);

    if (
        Number.isNaN(date.getTime()) ||
        date.getFullYear() !== year ||
        date.getMonth() !== month - 1 ||
        date.getDate() !== day
    ) {
        return null;
    }

    return year * 10000 + month * 100 + day;
}

function pickDefaultFolder(folders) {
    if (!Array.isArray(folders) || !folders.length) return null;

    let latestDateFolder = null;
    let latestDateKey = -1;

    folders.forEach(name => {
        const key = parseDateFolderKey(name);
        if (key !== null && key > latestDateKey) {
            latestDateKey = key;
            latestDateFolder = name;
        }
    });

    if (latestDateFolder) return latestDateFolder;
    return [...folders].sort((a, b) => b.localeCompare(a))[0];
}

function formatFolderDisplayName(name) {
    const match = String(name || '').match(/^(\d{4})(\d{2})(\d{2})$/);
    if (!match) return name;
    return `${match[1]}.${match[2]}.${match[3]}`;
}

async function loadFolders(options = {}) {
    const { keepSelection = false, refreshFiles = false, targetSelect = null, noCache = false } = options;
    const state = store.get();
    
    try {
        const data = await api.getFolders(noCache);
        const folders = data.folders || [];
        const hasValidSelected = Boolean(state.selectedFolder && folders.includes(state.selectedFolder));
        
        store.setState({ folders });
        els.folderCount.textContent = folders.length;
        
        renderFolders();

        let folderToSelect = pickDefaultFolder(folders);
        if (targetSelect && folders.includes(targetSelect)) {
            folderToSelect = targetSelect;
        } else if (keepSelection && hasValidSelected) {
            folderToSelect = state.selectedFolder;
        }

        const shouldSelectFolder = Boolean(folderToSelect) && (targetSelect || !keepSelection || !hasValidSelected);
        if (shouldSelectFolder) {
            await selectFolder(folderToSelect, { noCache });
        } else if (refreshFiles && hasValidSelected) {
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
    folders.forEach(name => {
        const match = name.match(/^(\d{4})(\d{2})(\d{2})$/);
        if (match) {
            const key = `${match[1]}${match[2]}`;
            const label = `${match[1]}.${match[2]}`;
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
            btn.textContent = formatFolderDisplayName(name);
            btn.title = name;
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
            .map((f) => {
                if (typeof f === 'string') {
                    return { file: f, title: f.replace(/\.html$/i, ''), cardType: 'trilingual' };
                }
                return {
                    ...f,
                    cardType: normalizeCardType(f.cardType || f.card_type || 'trilingual')
                };
            })
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
        const cardType = normalizeCardType(item.cardType || item.card_type || 'trilingual');
        btn.className = `list-item-btn card-type-${cardType === 'grammar_ja' ? 'grammar' : 'trilingual'}`;
        const cornerText = cardType === 'grammar_ja' ? '语法卡' : '三语卡';
        const cornerClass = cardType === 'grammar_ja' ? 'corner-grammar' : 'corner-trilingual';
        btn.innerHTML = `
          <span class="file-item-corner ${cornerClass}">${cornerText}</span>
          <span class="file-item-title">${escapeHtml(item.title || '')}</span>
        `;
        if (store.get('selectedFile') === item.file) {
            btn.classList.add('active');
        }
        btn.onclick = () => selectFile(item.file, item.title, cardType);
        els.fileList.appendChild(btn);
    });
    ensureFileListState();
    els.fileList.appendChild(fileListState);
}

async function selectFile(file, title, cardType = 'trilingual') {
    const folder = store.get('selectedFolder');
    if (!folder) return;

    store.setState({ selectedFile: file, selectedFileTitle: title });
    renderFiles(store.get('files'));

    try {
        const baseName = file.replace(/\.html$/i, '');
        // Fetch content and metadata in parallel
        const [mdContent, recordData] = await Promise.all([
            api.getFileContent(folder, `${baseName}.md`),
            api.getRecordByFile(folder, baseName).catch(e => {
                console.warn('Fetch record meta failed:', e);
                return null;
            })
        ]);

        const metrics = recordData ? recordData.record : null;
        const modalCardType = normalizeCardType(
            cardType || metrics?.card_type || metrics?.observability?.metadata?.cardType || 'trilingual'
        );
        renderCardModal(mdContent, title || baseName, { folder, baseName, metrics, cardType: modalCardType });
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

    autoSwitchModelWhenLocalOffline();

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

    async function autoSwitchModelWhenLocalOffline() {
        if (store.get('modelMode') !== 'local') return;
        try {
            const health = await api.checkHealth();
            const localService = (health.services || []).find((svc) => String(svc.name || '').includes('Local LLM'));
            if (localService && localService.status !== 'online') {
                store.setState({ modelMode: 'gemini' });
                updateModelUI('gemini');
                showGenerationQueueToast('检测到本地 LLM 离线，已自动切换到 GEMINI');
            }
        } catch (err) {
            // health 探测失败时维持用户当前选择，避免误切模式
        }
    }
}

function normalizeCardType(cardType) {
    return String(cardType || 'trilingual').trim().toLowerCase() === 'grammar_ja'
        ? 'grammar_ja'
        : 'trilingual';
}

function getCardTypeLabel(cardType) {
    return normalizeCardType(cardType) === 'grammar_ja' ? '日语语法卡片' : '三语学习卡片';
}

function initCardTypeSelector() {
    const buttons = document.querySelectorAll('.card-type-btn');
    const hint = els.cardTypeHint;
    if (!buttons.length || !hint) return;

    const updateCardTypeUI = (rawType) => {
        const cardType = normalizeCardType(rawType);
        store.setState({ cardType });
        buttons.forEach((btn) => btn.classList.toggle('active', btn.dataset.cardType === cardType));
        hint.textContent = getCardTypeLabel(cardType);
        hint.className = `selector-hint ${cardType === 'grammar_ja' ? 'mode-grammar' : 'mode-gemini'}`;
        els.genBtn.textContent = cardType === 'grammar_ja' ? 'Generate Grammar Card' : 'Generate';
    };

    updateCardTypeUI(store.get('cardType'));

    buttons.forEach((btn) => {
        btn.addEventListener('click', () => {
            updateCardTypeUI(btn.dataset.cardType);
        });
    });
}

// ==========================================
// 生成器逻辑 (Optimized)
// ==========================================

function initGenerator() {
    els.genBtn.addEventListener('click', async () => {
        const phrase = els.phraseInput.value.trim();
        if (!phrase) {
            showGenerationQueueToast('请输入短语或句子');
            return;
        }
        const cardType = normalizeCardType(store.get('cardType'));

        const accepted = enqueueBackgroundGenerationTask(phrase, phrase, {
            folder: store.get('selectedFolder') || '',
            baseName: '',
            generationId: null,
            entry: 'main-input',
            cardType,
            sourceMode: 'input'
        });
        if (!accepted) return;

        // 保持页面与卡片阅读上下文不变，仅清空输入以便继续排队。
        els.phraseInput.value = '';
        els.phraseInput.focus();
        hideProgress();
        stopTimer();
    });
}

function updateGenUI(isGenerating) {
    els.genBtn.disabled = isGenerating;
    const idleText = normalizeCardType(store.get('cardType')) === 'grammar_ja'
        ? 'Generate Grammar Card'
        : 'Generate';
    els.genBtn.textContent = isGenerating ? 'Generating...' : idleText;
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

    // 对比模式也保存文件，刷新列表
    const targetFolder = gemini?.result?.folder || local?.result?.folder;
    if (targetFolder) {
        loadFolders({ targetSelect: targetFolder, refreshFiles: true, noCache: true });
    }
}

function renderCompareModal(phrase, geminiResult, localResult, comparison) {
    const geminiOk = geminiResult?.success;
    const localOk = localResult?.success;
    const geminiFolder = geminiResult?.result?.folder || store.get('selectedFolder');
    const localFolder = localResult?.result?.folder || store.get('selectedFolder');
    const geminiBase = geminiResult?.result?.baseName;
    const localBase = localResult?.result?.baseName;

    const renderFallbackContent = (result) => {
        const raw = result?.observability?.metadata?.rawOutput || '';
        if (raw) {
            return `<pre class="raw-fallback">${escapeHtml(raw)}</pre>`;
        }
        return `<div class="empty-hint">暂无内容</div>`;
    };

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

    const geminiContent = geminiOk
        ? (geminiResult.output?.markdown_content
            ? renderMarkdownWithAudioButtons(geminiResult.output?.markdown_content || '', { folder: geminiFolder })
            : renderFallbackContent(geminiResult))
        : `<div class="error-box">${escapeHtml(geminiResult?.error || 'Generation failed')}</div>`;
    const localContent = localOk
        ? (localResult.output?.markdown_content
            ? renderMarkdownWithAudioButtons(localResult.output?.markdown_content || '', { folder: localFolder })
            : renderFallbackContent(localResult))
        : `<div class="error-box">${escapeHtml(localResult?.error || 'Generation failed')}</div>`;

    const geminiIntel = geminiOk
        ? buildIntelHud(geminiResult.observability || {}, { idSuffix: 'gemini', providerLabel: 'GEMINI', modelLabel: geminiResult.observability?.metadata?.model })
        : `<div class="error-box">${escapeHtml(geminiResult?.error || 'Intel unavailable')}</div>`;
    const localIntel = localOk
        ? buildIntelHud(localResult.observability || {}, { idSuffix: 'local', providerLabel: 'LOCAL', modelLabel: localResult.observability?.metadata?.model })
        : `<div class="error-box">${escapeHtml(localResult?.error || 'Intel unavailable')}</div>`;

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

                <div class="panel-tabs sub-tabs compare-tabs" style="margin:0; border:none; background: #f3f4f6; border-radius: 8px; padding: 4px;">
                    <button class="tab-btn active" data-target="compareContent" style="font-size:12px; padding: 4px 12px;">CONTENT</button>
                    <button class="tab-btn" data-target="compareIntel" style="font-size:12px; padding: 4px 12px; color: var(--neon-purple);">INTEL</button>
                </div>
            </div>

            <div class="mc-body compare-body">
                ${comparisonSection}

                <div id="compareContent" class="compare-pane" style="display:block;">
                    <div class="compare-columns compare-content-grid">
                        <div class="compare-column">
                            <div class="compare-column-header" style="background: linear-gradient(135deg, var(--neon-blue), var(--neon-purple)); color: white;">
                                <span class="model-icon">🤖</span>
                                <span>GEMINI</span>
                                ${geminiBase && geminiFolder ? `<button class="compare-delete" data-folder="${geminiFolder}" data-base="${geminiBase}" title="删除该学习卡片">🗑️</button>` : ''}
                                ${!geminiOk ? '<span style="font-size:11px; opacity:0.8;">⚠ FAILED</span>' : ''}
                            </div>
                            <div class="compare-card-body">
                                ${geminiContent}
                            </div>
                        </div>
                        <div class="compare-column">
                            <div class="compare-column-header" style="background: linear-gradient(135deg, var(--neon-amber), var(--neon-green)); color: white;">
                                <span class="model-icon">🏠</span>
                                <span>LOCAL LLM</span>
                                ${localBase && localFolder ? `<button class="compare-delete" data-folder="${localFolder}" data-base="${localBase}" title="删除该学习卡片">🗑️</button>` : ''}
                                ${!localOk ? '<span style="font-size:11px; opacity:0.8;">⚠ FAILED</span>' : ''}
                            </div>
                            <div class="compare-card-body">
                                ${localContent}
                            </div>
                        </div>
                    </div>
                </div>

                <div id="compareIntel" class="compare-pane" style="display:none;">
                    <div class="compare-columns compare-intel-grid">
                        <div class="compare-column">
                            <div class="compare-column-header" style="background: linear-gradient(135deg, var(--neon-blue), var(--neon-purple)); color: white;">
                                <span class="model-icon">🤖</span>
                                <span>GEMINI</span>
                                ${geminiBase && geminiFolder ? `<button class="compare-delete" data-folder="${geminiFolder}" data-base="${geminiBase}" title="删除该学习卡片">🗑️</button>` : ''}
                            </div>
                            ${geminiIntel}
                        </div>
                        <div class="compare-column">
                            <div class="compare-column-header" style="background: linear-gradient(135deg, var(--neon-amber), var(--neon-green)); color: white;">
                                <span class="model-icon">🏠</span>
                                <span>LOCAL LLM</span>
                                ${localBase && localFolder ? `<button class="compare-delete" data-folder="${localFolder}" data-base="${localBase}" title="删除该学习卡片">🗑️</button>` : ''}
                            </div>
                            ${localIntel}
                        </div>
                    </div>
                </div>
            </div>
        </div>
    `;

    els.modalContainer.innerHTML = html;
    document.getElementById('mcCloseBtn').onclick = closeModal;

    const tabs = els.modalContainer.querySelectorAll('.compare-tabs .tab-btn');
    tabs.forEach(btn => {
        btn.onclick = () => {
            tabs.forEach(t => t.classList.remove('active'));
            btn.classList.add('active');
            const targetId = btn.dataset.target;
            const contentPane = els.modalContainer.querySelector('#compareContent');
            const intelPane = els.modalContainer.querySelector('#compareIntel');
            if (targetId === 'compareIntel') {
                contentPane.style.display = 'none';
                intelPane.style.display = 'block';
                requestAnimationFrame(() => {
                    renderIntelCharts(geminiResult?.observability || {}, 'gemini');
                    renderIntelCharts(localResult?.observability || {}, 'local');
                });
            } else {
                intelPane.style.display = 'none';
                contentPane.style.display = 'block';
            }
        };
    });

    bindAudioButtons(els.modalContainer);
    const deleteButtons = els.modalContainer.querySelectorAll('.compare-delete');
    deleteButtons.forEach(btn => {
        btn.onclick = async (e) => {
            e.stopPropagation();
            const folder = btn.dataset.folder;
            const base = btn.dataset.base;
            if (!folder || !base) return;
            if (!confirm('确定删除该学习卡片及其相关文件吗？此操作不可恢复。')) return;
            btn.disabled = true;
            try {
                await api.deleteRecordByFile(folder, base);
                btn.textContent = 'DELETED';
                const column = btn.closest('.compare-column');
                if (column) {
                    const body = column.querySelector('.compare-card-body');
                    if (body) body.innerHTML = '<div class="empty-hint">已删除</div>';
                    const intel = column.querySelector('.compare-intel-panel');
                    if (intel) intel.innerHTML = '<div class="empty-hint">已删除</div>';
                }
                loadFolders({ targetSelect: folder, refreshFiles: true, noCache: true });
            } catch (err) {
                alert('Delete failed: ' + err.message);
                btn.disabled = false;
            }
        };
    });

    els.modalOverlay.classList.remove('hidden');
    setTimeout(() => {
        els.modalOverlay.classList.add('show');
        bindInfoButtons(els.modalContainer);
        bindIntelViewers(els.modalContainer);
    }, 10);
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

function renderCompareContent() {
    return '';
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

function normalizeLoanwordAnnotations(markdown) {
    if (!markdown || typeof markdown !== 'string') return markdown || '';
    if (markdown.includes('loanword-block')) return markdown;

    const looksKana = (s) => /[\u30A0-\u30FF]/.test(String(s || ''));
    const looksLatin = (s) => /[A-Za-z]/.test(String(s || ''));
    const parsePairs = (raw) => String(raw || '')
        .split(/[，,、；;]+/)
        .map(s => s.trim())
        .filter(Boolean)
        .map((chunk) => {
            const match = chunk.match(/^([^=]+?)\s*=\s*(.+)$/);
            if (!match) return { en: chunk, ja: '' };
            let left = match[1].trim();
            let right = match[2].trim();
            if (looksKana(left) && looksLatin(right)) {
                const tmp = left;
                left = right;
                right = tmp;
            }
            return { en: left, ja: right };
        });

    const renderBlock = (items) => {
        if (!items.length) return '';
        const tags = items
            .map(({ en, ja }) => {
                const safeEn = escapeHtml(String(en || '').trim());
                const safeJa = escapeHtml(String(ja || '').trim());
                if (!safeEn && !safeJa) return '';
                return safeJa
                    ? `<span class="loanword-tag">${safeEn} → ${safeJa}</span>`
                    : `<span class="loanword-tag">${safeEn}</span>`;
            })
            .filter(Boolean)
            .join(' ');
        if (!tags) return '';
        return `<div class="loanword-block"><span class="loanword-label">外来语标注</span><span class="loanword-line">${tags}</span></div>`;
    };

    const lines = markdown.split(/\r?\n/);
    const output = [];

    lines.forEach((line) => {
        const inlineMatch = line.match(/^(\s*-\s+)(.*?)\s+[-—–]\s*外来语标注[:：]\s*(.+)$/i);
        if (inlineMatch) {
            const prefix = inlineMatch[1];
            const translated = inlineMatch[2].trim();
            const pairs = parsePairs(inlineMatch[3]);
            output.push(`${prefix}${translated}`);
            const block = renderBlock(pairs);
            if (block) output.push(block);
            return;
        }

        const standaloneMatch = line.match(/^\s*-\s*外来语标注[:：]\s*(.*)$/i);
        if (standaloneMatch) {
            const raw = (standaloneMatch[1] || '').trim();
            const pairs = parsePairs(raw || '无');
            const block = renderBlock(pairs);
            output.push(block || line);
            return;
        }

        output.push(line);
    });

    return output.join('\n');
}

function renderMarkdownWithAudioButtons(markdown, options = {}) {
    const folder = options.folder || '';
    const normalized = normalizeLoanwordAnnotations(markdown || '');
    const html = marked.parse(normalized);
    const processedHtml = html.replace(/<audio\b([^>]*?)\s+src=(['"])([^'"]+)\2([^>]*)>/gi, (match, pre, quote, src) => {
        const folderAttr = folder ? ` data-folder="${folder}"` : '';
        return `<button class="audio-btn" data-src="${src}"${folderAttr}>▶</button>`;
    });
    return sanitizeHtml(processedHtml);
}

function bindAudioButtons(container, defaultFolder = null) {
    const fallback = defaultFolder || store.get('selectedFolder');
    container.querySelectorAll('.audio-btn').forEach(btn => {
        const src = btn.dataset.src;
        const folder = btn.dataset.folder || fallback;
        if (!src || !folder) return;
        const url = `/api/folders/${encodeURIComponent(folder)}/files/${encodeURIComponent(src)}`;
        btn.onclick = () => player.play(url, btn);
    });
}

// ==========================================
// 后台生成队列（静默串行，不打断浏览）
// ==========================================

function initGenerationQueuePanel() {
    const panel = document.createElement('div');
    panel.id = 'generationQueuePanel';
    panel.className = 'gen-queue-panel hidden';
    panel.innerHTML = `
      <div class="gen-queue-head">
        <div class="gen-queue-title">TASK QUEUE</div>
        <div class="gen-queue-actions">
          <button type="button" class="gen-queue-btn" data-action="retry-failed">重试失败</button>
          <button type="button" class="gen-queue-btn" data-action="clear-done">清理完成</button>
          <button type="button" class="gen-queue-btn" data-action="toggle">收起</button>
        </div>
      </div>
      <div class="gen-queue-summary">空闲</div>
      <div class="gen-queue-list"></div>
      <div class="gen-queue-toast hidden"></div>
    `;
    document.body.appendChild(panel);

    generationQueueState.panelEl = panel;
    generationQueueState.summaryEl = panel.querySelector('.gen-queue-summary');
    generationQueueState.listEl = panel.querySelector('.gen-queue-list');
    generationQueueState.toastEl = panel.querySelector('.gen-queue-toast');
    generationQueueState.retryFailedBtn = panel.querySelector('[data-action="retry-failed"]');
    generationQueueState.clearDoneBtn = panel.querySelector('[data-action="clear-done"]');
    generationQueueState.collapseBtn = panel.querySelector('[data-action="toggle"]');

    generationQueueState.retryFailedBtn.onclick = () => {
        let retried = 0;
        generationQueueState.tasks.forEach((task) => {
            if (task.status === 'failed') {
                task.status = 'queued';
                task.error = '';
                task.retryAfter = 0;
                retried += 1;
            }
        });
        if (retried) {
            showGenerationQueueToast(`已重试 ${retried} 个失败任务`);
            renderGenerationQueuePanel();
            processGenerationQueue();
        }
    };

    generationQueueState.clearDoneBtn.onclick = () => {
        const before = generationQueueState.tasks.length;
        generationQueueState.tasks = generationQueueState.tasks.filter(
            (task) => task.status !== 'success' && task.status !== 'cancelled'
        );
        const removed = before - generationQueueState.tasks.length;
        if (removed > 0) {
            showGenerationQueueToast(`已清理 ${removed} 个已完成任务`);
            renderGenerationQueuePanel();
        }
        if (!generationQueueState.tasks.length) {
            panel.classList.add('hidden');
        }
    };

    generationQueueState.collapseBtn.onclick = () => {
        const collapsed = panel.classList.toggle('collapsed');
        generationQueueState.collapseBtn.textContent = collapsed ? '展开' : '收起';
    };

    persistGenerationQueueSnapshot();
}

function showGenerationQueueToast(message) {
    const toast = generationQueueState.toastEl;
    if (!toast) return;
    toast.textContent = message;
    toast.classList.remove('hidden');
    clearTimeout(showGenerationQueueToast.timerId);
    showGenerationQueueToast.timerId = setTimeout(() => {
        toast.classList.add('hidden');
    }, 2200);
}

function renderGenerationQueuePanel() {
    const panel = generationQueueState.panelEl;
    if (!panel) return;

    const tasks = generationQueueState.tasks;
    const queued = tasks.filter((task) => task.status === 'queued').length;
    const running = tasks.filter((task) => task.status === 'running').length;
    const failed = tasks.filter((task) => task.status === 'failed').length;
    const success = tasks.filter((task) => task.status === 'success').length;

    const runningTask = tasks.find((task) => task.status === 'running');
    const runningType = runningTask ? (normalizeCardType(runningTask.cardType) === 'grammar_ja' ? '语法' : '三语') : '';
    const runningText = runningTask
        ? `执行中 #${runningTask.seq} [${runningType}]: ${escapeHtml(runningTask.phraseNormalized)}`
        : '空闲';

    generationQueueState.summaryEl.innerHTML =
        `待执行 <b>${queued}</b> · 运行 <b>${running}</b> · 成功 <b>${success}</b> · 失败 <b>${failed}</b><br>${runningText}`;

    const preview = tasks.slice(-8).reverse();
    generationQueueState.listEl.innerHTML = preview.length
        ? preview.map((task) => {
            const statusLabel = {
                queued: 'QUEUED',
                running: 'RUNNING',
                success: 'DONE',
                failed: 'FAILED',
                cancelled: 'CANCELLED'
            }[task.status] || task.status.toUpperCase();
            const cardType = normalizeCardType(task.cardType || 'trilingual');
            const cardTypeLabel = cardType === 'grammar_ja' ? '语法' : '三语';

            const cls = `status-${task.status}`;
            const errorText = task.error ? `<div class="gen-queue-item-error">${escapeHtml(task.error)}</div>` : '';
            return `
              <div class="gen-queue-item ${cls}">
                <div class="gen-queue-item-head">
                  <span class="gen-queue-item-id">#${task.seq}</span>
                  <span class="gen-queue-item-status">${statusLabel}</span>
                  <span class="gen-queue-item-type">${cardTypeLabel}</span>
                </div>
                <div class="gen-queue-item-text">${escapeHtml(task.phraseNormalized)}</div>
                ${errorText}
              </div>
            `;
        }).join('')
        : '<div class="gen-queue-empty">暂无任务</div>';

    generationQueueState.retryFailedBtn.disabled = failed === 0;
    generationQueueState.clearDoneBtn.disabled = success === 0;

    if (tasks.length > 0 || generationQueueState.running) {
        panel.classList.remove('hidden');
    }

    persistGenerationQueueSnapshot();
}

function persistGenerationQueueSnapshot() {
    const tasks = generationQueueState.tasks || [];
    const summary = {
        total: tasks.length,
        queued: tasks.filter((task) => task.status === 'queued').length,
        running: tasks.filter((task) => task.status === 'running').length,
        success: tasks.filter((task) => task.status === 'success').length,
        failed: tasks.filter((task) => task.status === 'failed').length,
        cancelled: tasks.filter((task) => task.status === 'cancelled').length
    };

    const activeTask = tasks.find((task) => task.status === 'running') || null;
    const snapshot = {
        version: 1,
        updatedAt: Date.now(),
        running: Boolean(generationQueueState.running),
        summary,
        activeTask: activeTask ? {
            id: activeTask.id,
            seq: activeTask.seq,
            phrase: activeTask.phraseNormalized,
            status: activeTask.status,
            attempts: activeTask.attempts || 0,
            provider: activeTask.provider || '',
            cardType: normalizeCardType(activeTask.cardType || 'trilingual'),
            sourceMode: activeTask.sourceMode || '',
            targetFolder: activeTask.targetFolder || '',
            enableCompare: Boolean(activeTask.enableCompare)
        } : null,
        recentTasks: tasks.slice(-20).map((task) => ({
            id: task.id,
            seq: task.seq,
            phrase: task.phraseNormalized,
            status: task.status,
            attempts: task.attempts || 0,
            provider: task.provider || '',
            cardType: normalizeCardType(task.cardType || 'trilingual'),
            sourceMode: task.sourceMode || '',
            targetFolder: task.targetFolder || '',
            enableCompare: Boolean(task.enableCompare),
            error: task.error || '',
            createdAt: task.createdAt || 0,
            finishedAt: task.finishedAt || 0,
            retryAfter: task.retryAfter || 0
        }))
    };

    try {
        localStorage.setItem(QUEUE_SNAPSHOT_STORAGE_KEY, JSON.stringify(snapshot));
    } catch (err) {
        console.warn('[Queue] persist snapshot failed:', err.message);
    }
}

function hasActiveDuplicateTask(phraseNormalized, cardType = 'trilingual') {
    const normalizedType = normalizeCardType(cardType);
    return generationQueueState.tasks.some(
        (task) =>
            (task.status === 'queued' || task.status === 'running' || task.status === 'failed') &&
            task.phraseNormalized === phraseNormalized &&
            normalizeCardType(task.cardType) === normalizedType
    );
}

function enqueueBackgroundGenerationTask(phraseRaw, phraseNormalized, source = {}) {
    if (!phraseNormalized) return false;

    if (generationQueueState.tasks.length >= generationQueueState.maxTasks) {
        showGenerationQueueToast(`队列已满（${generationQueueState.maxTasks}）`);
        return false;
    }

    const taskCardType = normalizeCardType(source.cardType || store.get('cardType') || 'trilingual');
    if (hasActiveDuplicateTask(phraseNormalized, taskCardType)) {
        showGenerationQueueToast('该短语已在队列中');
        return false;
    }

    const modelMode = store.get('modelMode');
    const provider = modelMode === 'gemini' ? 'gemini' : 'local';
    const enableCompare = modelMode === 'compare';
    const sourceEntry = String(source.entry || '').trim().toLowerCase();
    const inferredSourceMode = String(
        source.sourceMode ||
        (sourceEntry === 'selection'
            ? 'selection'
            : sourceEntry === 'ocr-input'
                ? 'ocr'
                : 'input')
    ).trim().toLowerCase();
    const explicitTargetFolder = String(source.targetFolder || '').trim();
    const selectedFolder = String(store.get('selectedFolder') || '').trim();
    // 交互式生成默认写入“今日目录”，避免误写到历史目录。
    const taskTargetFolder =
        explicitTargetFolder ||
        (TODAY_FOLDER_TASK_ENTRIES.has(sourceEntry) ? '' : selectedFolder);

    const task = {
        id: `queue_${Date.now()}_${generationQueueState.nextSeq}`,
        seq: generationQueueState.nextSeq++,
        phraseRaw,
        phraseNormalized,
        source,
        provider,
        enableCompare,
        cardType: taskCardType,
        sourceMode: inferredSourceMode || null,
        targetFolder: taskTargetFolder,
        llmModel: null,
        status: 'queued',
        attempts: 0,
        error: '',
        retryAfter: 0,
        createdAt: Date.now(),
        finishedAt: 0
    };

    generationQueueState.tasks.push(task);
    if (generationQueueState.retryTimerId) {
        clearTimeout(generationQueueState.retryTimerId);
        generationQueueState.retryTimerId = null;
    }
    renderGenerationQueuePanel();
    processGenerationQueue();
    showGenerationQueueToast(`已加入队列 #${task.seq}`);
    return true;
}

async function runGenerationTaskFromQueue(task) {
    const response = await api.generate(task.phraseNormalized, task.provider, task.enableCompare, {
        targetFolder: task.targetFolder || '',
        llmModel: task.llmModel || undefined,
        cardType: normalizeCardType(task.cardType || 'trilingual'),
        sourceMode: task.sourceMode || undefined
    });

    const folder = task.enableCompare
        ? (response.gemini?.result?.folder || response.local?.result?.folder || response.input?.result?.folder || task.targetFolder || '')
        : (response.result?.folder || task.targetFolder || '');

    task.resultFolder = folder;
    task.responseSummary = task.enableCompare
        ? (response.comparison?.winner ? `winner=${response.comparison.winner}` : 'compare_done')
        : 'single_done';
}

function scheduleQueueFolderRefresh() {
    if (generationQueueState.refreshScheduled) return;
    generationQueueState.refreshScheduled = true;
    setTimeout(async () => {
        generationQueueState.refreshScheduled = false;
        try {
            await loadFolders({ keepSelection: true, refreshFiles: true, noCache: true });
        } catch (err) {
            console.warn('[Queue] refresh folders failed:', err.message);
        }
    }, 900);
}

function processGenerationQueue() {
    if (generationQueueState.running) return;
    const now = Date.now();
    const nextTask = generationQueueState.tasks.find(
        (task) => task.status === 'queued' && (!task.retryAfter || task.retryAfter <= now)
    );
    if (!nextTask) {
        const nextRetryAt = generationQueueState.tasks
            .filter((task) => task.status === 'queued' && task.retryAfter > now)
            .reduce((min, task) => Math.min(min, task.retryAfter), Number.POSITIVE_INFINITY);

        if (Number.isFinite(nextRetryAt) && !generationQueueState.retryTimerId) {
            const waitMs = Math.max(80, nextRetryAt - now);
            generationQueueState.retryTimerId = setTimeout(() => {
                generationQueueState.retryTimerId = null;
                processGenerationQueue();
            }, waitMs);
        }
        return;
    }

    if (generationQueueState.retryTimerId) {
        clearTimeout(generationQueueState.retryTimerId);
        generationQueueState.retryTimerId = null;
    }

    generationQueueState.running = true;
    nextTask.status = 'running';
    nextTask.error = '';
    nextTask.attempts += 1;
    renderGenerationQueuePanel();

    runGenerationTaskFromQueue(nextTask)
        .then(() => {
            nextTask.status = 'success';
            nextTask.finishedAt = Date.now();
            scheduleQueueFolderRefresh();
            showGenerationQueueToast(`任务 #${nextTask.seq} 已完成`);
        })
        .catch((err) => {
            const message = String(err?.message || 'generation failed');
            const retryAfterMs = Number(err?.retryAfterMs || 0);
            const isRateLimited = Number(err?.status) === 429 || /rate limit/i.test(message);
            if (nextTask.attempts <= generationQueueState.maxRetries) {
                const baseDelay = Math.min(10000, 800 * Math.pow(2, nextTask.attempts - 1));
                const delay = isRateLimited && retryAfterMs > 0
                    ? Math.min(20000, Math.max(baseDelay, retryAfterMs + 250))
                    : baseDelay;
                nextTask.status = 'queued';
                nextTask.retryAfter = Date.now() + delay;
                nextTask.error = `重试中 (${nextTask.attempts}/${generationQueueState.maxRetries + 1}, ${Math.ceil(delay / 1000)}s 后): ${message}`;
            } else {
                nextTask.status = 'failed';
                nextTask.error = message;
                nextTask.finishedAt = Date.now();
                showGenerationQueueToast(`任务 #${nextTask.seq} 失败`);
            }
        })
        .finally(() => {
            generationQueueState.running = false;
            renderGenerationQueuePanel();
            setTimeout(processGenerationQueue, 120);
        });
}

// ==========================================
// 文本选取 → 入后台任务队列
// ==========================================

function normalizeSelectionPhrase(text) {
    const cjk = '\u3040-\u30FF\u3400-\u9FFF々〆ヵヶ';
    let cleaned = String(text || '');
    cleaned = cleaned
        .replace(/\u25B6/g, ' ')
        .replace(/[ \t\r\n]+/g, ' ')
        .replace(/^[-•\s]+/, '')
        .replace(/^例句\s*\d+\s*[：:]\s*/i, '')
        .replace(/^[“"'\s]+|[”"'\s]+$/g, '');

    cleaned = cleaned
        .replace(new RegExp(`([${cjk}])\\s+([${cjk}])`, 'g'), '$1$2')
        .replace(new RegExp(`([${cjk}])\\s+([、。！？：；，．])`, 'g'), '$1$2')
        .replace(new RegExp(`([（(])\\s+([${cjk}])`, 'g'), '$1$2')
        .replace(new RegExp(`([${cjk}])\\s+([）)])`, 'g'), '$1$2')
        .replace(/\s{2,}/g, ' ')
        .trim();

    return cleaned;
}

function collectVisibleSelectionText(node, pieces) {
    if (!node) return;
    if (node.nodeType === Node.TEXT_NODE) {
        pieces.push(node.nodeValue || '');
        return;
    }
    if (node.nodeType !== Node.ELEMENT_NODE && node.nodeType !== Node.DOCUMENT_FRAGMENT_NODE) {
        return;
    }

    if (node.nodeType === Node.ELEMENT_NODE) {
        const el = node;
        const tag = el.tagName.toLowerCase();

        if (['script', 'style', 'audio', 'button', 'rt', 'rp'].includes(tag)) return;
        if (
            el.classList?.contains('audio-btn') ||
            el.classList?.contains('selection-gen-fab') ||
            el.classList?.contains('loanword-block') ||
            el.classList?.contains('loanword-label') ||
            el.classList?.contains('loanword-line') ||
            el.classList?.contains('loanword-tag')
        ) {
            return;
        }

        if (tag === 'br') {
            pieces.push('\n');
            return;
        }

        if (tag === 'ruby') {
            Array.from(el.childNodes).forEach((child) => {
                if (child.nodeType === Node.ELEMENT_NODE) {
                    const childTag = child.tagName.toLowerCase();
                    if (childTag === 'rt' || childTag === 'rp') return;
                }
                collectVisibleSelectionText(child, pieces);
            });
            return;
        }

        const blockLike = ['div', 'p', 'li', 'ul', 'ol', 'section', 'article', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6'];
        if (blockLike.includes(tag)) pieces.push(' ');
        Array.from(el.childNodes).forEach((child) => collectVisibleSelectionText(child, pieces));
        if (blockLike.includes(tag)) pieces.push(' ');
        return;
    }

    Array.from(node.childNodes || []).forEach((child) => collectVisibleSelectionText(child, pieces));
}

function extractRubyBaseText(rubyEl) {
    if (!rubyEl) return '';
    const parts = [];
    Array.from(rubyEl.childNodes).forEach((child) => {
        if (child.nodeType === Node.ELEMENT_NODE) {
            const tag = child.tagName.toLowerCase();
            if (tag === 'rt' || tag === 'rp') return;
        }
        collectVisibleSelectionText(child, parts);
    });
    return normalizeSelectionPhrase(parts.join(' '));
}

function buildSelectionCandidateFromContainer(container, options = {}) {
    const { maxLength = SELECTION_HIGHLIGHT_MAX_CHARS } = options;
    const sel = window.getSelection();
    if (!sel || sel.rangeCount === 0) return null;

    const range = sel.getRangeAt(0);
    const startInside = container.contains(range.startContainer);
    const endInside = container.contains(range.endContainer);
    if (!startInside || !endInside) return null;
    if (range.collapsed) return null;

    const fragment = range.cloneContents();
    const pieces = [];
    collectVisibleSelectionText(fragment, pieces);
    const rawText = pieces.join(' ').trim();
    let normalized = normalizeSelectionPhrase(rawText);

    // 用户可能只选中了 rt 注音，尝试回退到 ruby 主体文本。
    if (!normalized) {
        const anchorEl =
            range.startContainer.nodeType === Node.ELEMENT_NODE
                ? range.startContainer
                : range.startContainer.parentElement;
        const rubyEl = anchorEl?.closest?.('ruby');
        if (rubyEl && container.contains(rubyEl)) {
            normalized = extractRubyBaseText(rubyEl);
        }
    }

    if (!normalized) return null;
    if (normalized.length > maxLength) return null;
    return { rawText, normalized, range };
}

function initSelectionToGenerate(container) {
    if (selectionFabCleanup) {
        selectionFabCleanup();
        selectionFabCleanup = null;
    }

    const dock = document.createElement('div');
    dock.id = 'selectionActionDock';
    dock.className = 'selection-action-dock hidden';
    dock.innerHTML = `
      <button type="button" class="selection-action-btn action-generate" data-action="generate">\u2726 Generate Card</button>
      <button type="button" class="selection-action-btn action-generate-grammar" data-action="generate-grammar">📘 语法卡</button>
      <button type="button" class="selection-action-btn action-highlight" data-action="highlight">\ud83d\udd8d \u6807\u7ea2</button>
    `;
    document.body.appendChild(dock);
    const generateBtn = dock.querySelector('[data-action="generate"]');
    const generateGrammarBtn = dock.querySelector('[data-action="generate-grammar"]');
    const highlightBtn = dock.querySelector('[data-action="highlight"]');

    const hideDock = () => dock.classList.add('hidden');

    const onMouseUp = () => {
        setTimeout(() => checkSelection(container, dock), 10);
    };
    const onSelChange = () => checkSelection(container, dock);

    container.addEventListener('mouseup', onMouseUp);
    document.addEventListener('selectionchange', onSelChange);

    dock.addEventListener('mousedown', (e) => {
        e.preventDefault(); // 防止点击 FAB 时选区被清除
    });

    generateBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        const candidate = buildSelectionCandidateFromContainer(container, {
            maxLength: SELECTION_GENERATE_MAX_CHARS
        });
        if (!candidate) {
            hideDock();
            showGenerationQueueToast('选区超长或无效：生成任务最多支持 200 字');
            return;
        }

        enqueueBackgroundGenerationTask(candidate.rawText, candidate.normalized, {
            folder: activeCardContext?.folder || store.get('selectedFolder') || '',
            baseName: activeCardContext?.baseName || '',
            generationId: activeCardContext?.generationId || null,
            entry: 'selection',
            cardType: 'trilingual',
            sourceMode: 'selection'
        });

        hideDock();
        if (window.getSelection()) window.getSelection().removeAllRanges();
    });

    generateGrammarBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        const candidate = buildSelectionCandidateFromContainer(container, {
            maxLength: SELECTION_GENERATE_MAX_CHARS
        });
        if (!candidate) {
            hideDock();
            showGenerationQueueToast('选区超长或无效：生成任务最多支持 200 字');
            return;
        }

        enqueueBackgroundGenerationTask(candidate.rawText, candidate.normalized, {
            folder: activeCardContext?.folder || store.get('selectedFolder') || '',
            baseName: activeCardContext?.baseName || '',
            generationId: activeCardContext?.generationId || null,
            entry: 'selection',
            cardType: 'grammar_ja',
            sourceMode: 'selection'
        });

        hideDock();
        if (window.getSelection()) window.getSelection().removeAllRanges();
    });

    highlightBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        const candidate = buildSelectionCandidateFromContainer(container, {
            maxLength: SELECTION_HIGHLIGHT_MAX_CHARS
        });
        if (!candidate) {
            hideDock();
            return;
        }

        const applied = applyMarkerHighlight(container, candidate.range);
        hideDock();
        if (window.getSelection()) window.getSelection().removeAllRanges();

        if (applied) {
            persistCurrentCardHighlights(container);
        } else {
            showGenerationQueueToast('选区无法标红，请缩小选区后重试');
        }
    });

    selectionFabCleanup = () => {
        container.removeEventListener('mouseup', onMouseUp);
        document.removeEventListener('selectionchange', onSelChange);
        dock.remove();
    };
}

function checkSelection(container, dock) {
    const candidate = buildSelectionCandidateFromContainer(container, {
        maxLength: SELECTION_HIGHLIGHT_MAX_CHARS
    });
    if (candidate) {
        const range = candidate.range;
        const rect = range.getBoundingClientRect();
        dock.style.top = `${rect.top + window.scrollY - 44}px`;
        dock.style.left = `${rect.left + window.scrollX + rect.width / 2}px`;
        dock.classList.remove('hidden');
    } else {
        dock.classList.add('hidden');
    }
}

function applyMarkerHighlight(container, range) {
    if (!range || range.collapsed) return false;
    if (!container.contains(range.commonAncestorContainer)) return false;
    const comparePoints = (aNode, aOffset, bNode, bOffset) => {
        if (aNode === bNode) {
            if (aOffset === bOffset) return 0;
            return aOffset < bOffset ? -1 : 1;
        }
        const pointRange = document.createRange();
        pointRange.setStart(aNode, aOffset);
        pointRange.collapse(true);
        const cmp = pointRange.comparePoint(bNode, bOffset);
        if (cmp < 0) return 1;
        if (cmp > 0) return -1;
        return 0;
    };

    const isHighlightableTextNode = (textNode) => {
        if (!textNode || textNode.nodeType !== Node.TEXT_NODE) return false;
        if (!textNode.nodeValue || !textNode.nodeValue.trim()) return false;
        const parentEl = textNode.parentElement;
        if (!parentEl) return false;
        if (parentEl.closest('rt, rp, button, audio, source, script, style, .selection-action-dock')) return false;
        if (parentEl.closest('mark.study-highlight-red')) return false;
        return true;
    };

    const textNodes = [];
    const walker = document.createTreeWalker(container, NodeFilter.SHOW_TEXT);
    let current = walker.nextNode();
    while (current) {
        textNodes.push(current);
        current = walker.nextNode();
    }

    const fragments = [];
    textNodes.forEach((textNode) => {
        if (!isHighlightableTextNode(textNode)) return;

        const length = textNode.nodeValue.length;
        const endVsNodeStart = comparePoints(range.endContainer, range.endOffset, textNode, 0);
        if (endVsNodeStart <= 0) return; // range.end <= node.start
        const startVsNodeEnd = comparePoints(range.startContainer, range.startOffset, textNode, length);
        if (startVsNodeEnd >= 0) return; // range.start >= node.end

        let startOffset = 0;
        if (comparePoints(range.startContainer, range.startOffset, textNode, 0) > 0) {
            startOffset = range.startContainer === textNode ? range.startOffset : 0;
        }

        let endOffset = length;
        if (comparePoints(range.endContainer, range.endOffset, textNode, length) < 0) {
            endOffset = range.endContainer === textNode ? range.endOffset : length;
        }

        if (startOffset >= endOffset) return;
        fragments.push({ textNode, startOffset, endOffset });
    });

    if (!fragments.length) return false;

    let applied = false;
    fragments.forEach((fragment) => {
        const { textNode, startOffset, endOffset } = fragment;
        if (!textNode.parentNode) return;

        let selectedNode = textNode;
        const totalLength = selectedNode.nodeValue.length;
        const safeStart = Math.max(0, Math.min(startOffset, totalLength));
        const safeEnd = Math.max(safeStart, Math.min(endOffset, totalLength));
        if (safeStart >= safeEnd) return;

        if (safeStart > 0) {
            selectedNode = selectedNode.splitText(safeStart);
        }
        const selectedLength = safeEnd - safeStart;
        if (selectedLength < selectedNode.nodeValue.length) {
            selectedNode.splitText(selectedLength);
        }
        if (!selectedNode.parentNode) return;
        if (selectedNode.parentElement && selectedNode.parentElement.closest('mark.study-highlight-red')) return;

        const marker = document.createElement('mark');
        marker.className = 'study-highlight-red';
        selectedNode.parentNode.insertBefore(marker, selectedNode);
        marker.appendChild(selectedNode);
        applied = true;
    });

    return applied;
}

function buildCardHighlightStorageKey({ folder = '', baseName = '', generationId = 0, title = '' } = {}) {
    const keyParts = ['card'];
    if (folder && baseName) {
        keyParts.push(`f:${folder}`, `b:${baseName}`);
    } else if (generationId) {
        keyParts.push(`g:${generationId}`);
    } else {
        keyParts.push(`t:${String(title || '').trim()}`);
    }
    return `${CARD_HIGHLIGHT_STORAGE_PREFIX}:${keyParts.join('|')}`;
}

function computeTextHash(input) {
    const text = String(input || '');
    let hash = 2166136261;
    for (let i = 0; i < text.length; i += 1) {
        hash ^= text.charCodeAt(i);
        hash = Math.imul(hash, 16777619);
    }
    return (hash >>> 0).toString(16).padStart(8, '0');
}

function loadPersistedCardHighlights(storageKey, sourceHash) {
    if (!storageKey) return null;
    try {
        const raw = localStorage.getItem(storageKey);
        if (!raw) return null;
        const parsed = JSON.parse(raw);
        if (!parsed || parsed.version !== 1) return null;
        if (parsed.sourceHash !== sourceHash) return null;
        if (typeof parsed.html !== 'string' || !parsed.html.trim()) return null;
        return sanitizeHtml(parsed.html);
    } catch (err) {
        console.warn('[Highlight] load failed:', err.message);
        return null;
    }
}

function isSameCardContext(a, b) {
    if (!a || !b) return false;
    return (
        String(a.folder || '') === String(b.folder || '') &&
        String(a.baseName || '') === String(b.baseName || '') &&
        String(a.highlightSourceHash || '') === String(b.highlightSourceHash || '')
    );
}

function syncLocalHighlightCache(storageKey, sourceHash, html) {
    if (!storageKey || !sourceHash || typeof html !== 'string' || !html.trim()) return;
    try {
        localStorage.setItem(storageKey, JSON.stringify({
            version: 1,
            sourceHash,
            updatedAt: Date.now(),
            html
        }));
    } catch (err) {
        console.warn('[Highlight] sync local cache failed:', err.message);
    }
}

async function hydrateCardHighlightsFromServer(container, context) {
    if (!container || !context) return;
    const folder = String(context.folder || '').trim();
    const baseName = String(context.baseName || '').trim();
    const sourceHash = String(context.highlightSourceHash || '').trim();
    if (!folder || !baseName || !sourceHash) return;

    try {
        const res = await api.getCardHighlight(folder, baseName, sourceHash);
        const remote = res?.highlight || null;
        if (!remote || typeof remote.htmlContent !== 'string' || !remote.htmlContent.trim()) return;

        const latestContext = activeCardContext ? { ...activeCardContext } : null;
        if (!isSameCardContext(context, latestContext)) return;

        const sanitized = sanitizeHtml(remote.htmlContent);
        if (!sanitized.trim()) return;
        if (container.innerHTML !== sanitized) {
            container.innerHTML = sanitized;
            bindAudioButtons(els.modalContainer, folder);
        }
        syncLocalHighlightCache(context.highlightStorageKey, sourceHash, sanitized);
    } catch (err) {
        console.warn('[Highlight] hydrate from server failed:', err.message);
    }
}

function backfillCardHighlightsToServer(context, html) {
    if (!context || typeof html !== 'string' || !html.trim()) return;
    const folder = String(context.folder || '').trim();
    const baseName = String(context.baseName || '').trim();
    const sourceHash = String(context.highlightSourceHash || '').trim();
    if (!folder || !baseName || !sourceHash) return;
    api.saveCardHighlight({
        folder,
        base: baseName,
        sourceHash,
        html,
        generationId: context.generationId || null,
        version: 1,
        updatedBy: reviewState.reviewer || 'owner'
    }).catch((err) => {
        console.warn('[Highlight] backfill to server failed:', err.message);
    });
}

function persistCurrentCardHighlights(container) {
    if (!container) return;
    const storageKey = activeCardContext?.highlightStorageKey || '';
    const sourceHash = activeCardContext?.highlightSourceHash || '';
    const folder = activeCardContext?.folder || '';
    const baseName = activeCardContext?.baseName || '';
    const generationId = activeCardContext?.generationId || null;
    if (!storageKey || !sourceHash || !folder || !baseName) return;
    try {
        const payload = {
            version: 1,
            sourceHash,
            updatedAt: Date.now(),
            html: container.innerHTML
        };
        localStorage.setItem(storageKey, JSON.stringify(payload));
        api.saveCardHighlight({
            folder,
            base: baseName,
            sourceHash,
            html: container.innerHTML,
            generationId,
            version: 1,
            updatedBy: reviewState.reviewer || 'owner'
        }).catch((err) => {
            console.warn('[Highlight] persist to server failed:', err.message);
        });
    } catch (err) {
        console.warn('[Highlight] persist failed:', err.message);
    }
}

function clearPersistedCardHighlights(storageKey, options = {}) {
    const folder = activeCardContext?.folder || '';
    const baseName = activeCardContext?.baseName || '';
    const sourceHash = activeCardContext?.highlightSourceHash || '';
    const removeAllVersions = Boolean(options.removeAllVersions);
    if (!storageKey && !folder) return;
    try {
        if (storageKey) localStorage.removeItem(storageKey);
        if (folder && baseName) {
            api.deleteCardHighlight(folder, baseName, removeAllVersions ? '' : sourceHash).catch((err) => {
                console.warn('[Highlight] clear remote failed:', err.message);
            });
        }
    } catch (err) {
        console.warn('[Highlight] clear failed:', err.message);
    }
}

async function ensureActiveReviewCampaign(force = false) {
    if (!force && reviewState.activeCampaign) return reviewState.activeCampaign;
    try {
        const res = await api.getActiveReviewCampaign();
        reviewState.activeCampaign = res.campaign || null;
        return reviewState.activeCampaign;
    } catch (err) {
        console.warn('Load active review campaign failed:', err.message);
        return null;
    }
}

async function loadReviewPanel(options = {}) {
    const generationId = Number(options.generationId || 0);
    const container = document.getElementById('cardReview');
    if (!container) return;
    if (!generationId) {
        container.innerHTML = '<div class="review-empty">当前记录缺少 generationId，无法评审。</div>';
        return;
    }

    container.innerHTML = '<div class="review-empty">加载评审数据中...</div>';
    const campaign = await ensureActiveReviewCampaign();
    let campaignId = campaign?.id || null;
    let progress = null;
    if (campaignId) {
        try {
            const progressRes = await api.getReviewCampaignProgress(campaignId);
            progress = progressRes.progress || null;
            if (progress) reviewState.activeCampaign = progress;
        } catch (err) {
            console.warn('Load review progress failed:', err.message);
        }
    }

    let examples = [];
    try {
        const data = await api.getGenerationReviewExamples(generationId, {
            campaignId: campaignId || '',
            reviewer: reviewState.reviewer
        });
        examples = data.examples || [];
    } catch (err) {
        container.innerHTML = `<div class="review-empty">加载例句失败: ${escapeHtml(err.message)}</div>`;
        return;
    }

    const progressText = progress
        ? `${progress.reviewed_examples || 0}/${progress.total_examples || 0} (${progress.completion_rate || 0}%)`
        : '未创建评审批次';
    const hasPending = Number(progress?.pending_examples || 0) > 0;
    const isFinalized = progress?.status === 'finalized';

    container.innerHTML = `
      <div class="review-toolbar">
        <div class="review-meta">
          <div class="review-campaign-name">批次: ${escapeHtml(campaign?.name || '未创建')}${isFinalized ? ' <span class="review-badge finalized">已完成</span>' : ''}</div>
          <div class="review-campaign-progress">进度: ${escapeHtml(progressText)}</div>
        </div>
        <div class="review-actions">
          ${campaignId && !isFinalized
            ? `<button class="btn-secondary" id="reviewFinalizeBtn" ${hasPending ? 'disabled title="请先完成全部评分后再统一处理"' : ''}>统一处理并入池</button>
               <button class="btn-sampling" id="reviewSamplingBtn">采样处理</button>`
            : ''}
          ${campaignId && isFinalized
            ? `<button class="btn-rollback" id="reviewRollbackBtn">回滚</button>`
            : ''}
          ${!campaignId
            ? `<button class="btn-secondary" id="reviewCreateBtn">创建评审批次</button>`
            : ''}
          <button class="btn-text" id="reviewRefreshBtn">刷新</button>
        </div>
      </div>
      ${campaignId && hasPending && !isFinalized ? `<div class="review-hint">请先完成全部评分后再执行统一处理（剩余 ${progress.pending_examples} 条）。可使用"采样处理"跳过未评审样本。</div>` : ''}
      <div class="review-list" id="reviewExampleList">
        ${examples.length ? examples.map((ex) => renderReviewExampleCard(ex, campaignId)).join('') : '<div class="review-empty">当前卡片没有可评审例句。</div>'}
      </div>
    `;

    const createBtn = document.getElementById('reviewCreateBtn');
    if (createBtn) {
        createBtn.onclick = async () => {
            createBtn.disabled = true;
            try {
                await api.createReviewCampaign({
                    name: `campaign_${new Date().toISOString().slice(0, 10)}`,
                    createdBy: reviewState.reviewer
                });
                reviewState.activeCampaign = null;
                await loadReviewPanel({ generationId });
            } catch (err) {
                alert(`创建批次失败: ${err.message}`);
                createBtn.disabled = false;
            }
        };
    }

    const finalizeBtn = document.getElementById('reviewFinalizeBtn');
    if (finalizeBtn && campaignId) {
        finalizeBtn.onclick = async () => {
            if (hasPending) {
                alert(`当前批次仍有 ${progress.pending_examples} 条未评审，请先完成全部评分。`);
                return;
            }
            if (!confirm('确认对当前批次执行统一处理并更新注入资格？')) return;
            finalizeBtn.disabled = true;
            try {
                await api.finalizeReviewCampaign(campaignId);
                reviewState.activeCampaign = null;
                await loadReviewPanel({ generationId });
            } catch (err) {
                alert(`统一处理失败: ${err.message}`);
                finalizeBtn.disabled = false;
            }
        };
    }

    const samplingBtn = document.getElementById('reviewSamplingBtn');
    if (samplingBtn && campaignId) {
        samplingBtn.onclick = async () => {
            if (!confirm('采样处理将跳过未评审的样本，仅处理已评审部分。确认继续？')) return;
            samplingBtn.disabled = true;
            try {
                await api.finalizeReviewCampaign(campaignId, { allowPartial: true, minReviewRate: 0.3 });
                reviewState.activeCampaign = null;
                await loadReviewPanel({ generationId });
            } catch (err) {
                alert(`采样处理失败: ${err.message}`);
                samplingBtn.disabled = false;
            }
        };
    }

    const rollbackBtn = document.getElementById('reviewRollbackBtn');
    if (rollbackBtn && campaignId) {
        rollbackBtn.onclick = async () => {
            if (!confirm('回滚将重置所有注入资格为 pending，但保留原始评分数据。确认回滚？')) return;
            rollbackBtn.disabled = true;
            try {
                await api.rollbackReviewCampaign(campaignId);
                reviewState.activeCampaign = null;
                await loadReviewPanel({ generationId });
            } catch (err) {
                alert(`回滚失败: ${err.message}`);
                rollbackBtn.disabled = false;
            }
        };
    }

    const refreshBtn = document.getElementById('reviewRefreshBtn');
    if (refreshBtn) {
        refreshBtn.onclick = () => loadReviewPanel({ generationId });
    }

    container.querySelectorAll('.review-save-btn').forEach((btn) => {
        btn.onclick = async () => {
            const exampleId = Number(btn.dataset.exampleId || 0);
            if (!exampleId) return;

            const sentenceInput = container.querySelector(`input[name="sentence-${exampleId}"]:checked`);
            const translationInput = container.querySelector(`input[name="translation-${exampleId}"]:checked`);
            const ttsInput = container.querySelector(`input[name="tts-${exampleId}"]:checked`);
            const decisionSelect = container.querySelector(`select[name="decision-${exampleId}"]`);
            const commentInput = container.querySelector(`textarea[name="comment-${exampleId}"]`);

            if (!sentenceInput || !translationInput || !ttsInput) {
                alert('请先完成三项评分');
                return;
            }

            btn.disabled = true;
            const originalText = btn.textContent;
            btn.textContent = '保存中...';

            try {
                await api.submitExampleReview(exampleId, {
                    campaignId: campaignId || null,
                    reviewer: reviewState.reviewer,
                    scoreSentence: Number(sentenceInput.value),
                    scoreTranslation: Number(translationInput.value),
                    scoreTts: Number(ttsInput.value),
                    decision: decisionSelect?.value || 'neutral',
                    comment: commentInput?.value || ''
                });
                btn.textContent = '已保存';
                setTimeout(() => {
                    btn.textContent = originalText;
                    btn.disabled = false;
                }, 900);
            } catch (err) {
                alert(`保存失败: ${err.message}`);
                btn.textContent = originalText;
                btn.disabled = false;
            }
        };
    });
}

function renderScoreChoices(name, selectedValue = '') {
    const selected = String(selectedValue || '');
    return [1, 2, 3, 4, 5].map((score) => `
      <label class="review-score-item">
        <input type="radio" name="${name}" value="${score}" ${selected === String(score) ? 'checked' : ''} />
        <span>${score}</span>
      </label>
    `).join('');
}

function renderReviewExampleCard(example, campaignId) {
    const eligibility = example.eligibility || 'pending';
    const badgeClass = eligibility === 'approved'
        ? 'review-badge approved'
        : eligibility === 'rejected'
            ? 'review-badge rejected'
            : 'review-badge pending';
    return `
      <div class="review-item" data-example-id="${example.id}">
        <div class="review-item-head">
          <div>
            <div class="review-slot">${escapeHtml(example.sourceSlot || '')} · ${escapeHtml((example.lang || '').toUpperCase())}</div>
            <div class="review-text">${escapeHtml(example.sentenceText || '')}</div>
            <div class="review-translation">${escapeHtml(example.translationText || '')}</div>
          </div>
          <div class="${badgeClass}">${escapeHtml(eligibility)}</div>
        </div>
        <div class="review-score-grid">
          <div class="review-score-row">
            <span>原句</span>
            <div class="review-score-choices">${renderScoreChoices(`sentence-${example.id}`, example.scoreSentence)}</div>
          </div>
          <div class="review-score-row">
            <span>翻译</span>
            <div class="review-score-choices">${renderScoreChoices(`translation-${example.id}`, example.scoreTranslation)}</div>
          </div>
          <div class="review-score-row">
            <span>TTS</span>
            <div class="review-score-choices">${renderScoreChoices(`tts-${example.id}`, example.scoreTts)}</div>
          </div>
        </div>
        <div class="review-footer">
          <select name="decision-${example.id}" class="review-decision">
            <option value="neutral" ${example.decision === 'neutral' ? 'selected' : ''}>中立</option>
            <option value="approve" ${example.decision === 'approve' ? 'selected' : ''}>推荐注入</option>
            <option value="reject" ${example.decision === 'reject' ? 'selected' : ''}>不推荐注入</option>
          </select>
          <textarea name="comment-${example.id}" class="review-comment" placeholder="评论（可选）">${escapeHtml(example.comment || '')}</textarea>
          <button class="btn-secondary review-save-btn" data-example-id="${example.id}" ${campaignId ? '' : 'disabled'}>保存评分</button>
        </div>
      </div>
    `;
}

function buildIntelHud(metrics, options = {}) {
    const idSuffix = options.idSuffix ? `-${options.idSuffix}` : '';
    const providerLabel = (options.providerLabel || metrics.metadata?.provider || 'LOCAL').toUpperCase();
    const modelLabel = options.modelLabel || metrics.metadata?.model || 'UNKNOWN';
    const templateCompliance = metrics.quality?.templateCompliance ?? metrics.quality?.checks?.templateCompliance ?? 0;

    const toText = (val) => {
        if (val === null || val === undefined) return '';
        if (typeof val === 'string') return val;
        try { return JSON.stringify(val, null, 2); } catch (e) { return String(val); }
    };
    const promptRawText = toText(metrics.metadata?.promptText);
    const promptStructText = toText(metrics.metadata?.promptParsed);
    const outputRawText = toText(metrics.metadata?.rawOutput);
    let outputStructText = toText(metrics.metadata?.outputStructured);
    if (!outputStructText && outputRawText) {
        try { outputStructText = JSON.stringify(JSON.parse(outputRawText), null, 2); } catch (e) {}
    }
    const promptDefaultView = promptRawText ? 'raw' : 'structured';
    const outputDefaultView = outputRawText ? 'raw' : 'structured';

    const score = metrics.quality?.score || 0;
    const rank = score >= 90 ? 'S' : score >= 80 ? 'A' : score >= 70 ? 'B' : score >= 60 ? 'C' : 'D';
    const rankColor = score >= 80 ? 'var(--neon-green)' : score >= 60 ? 'var(--neon-amber)' : 'var(--neon-red)';
    const tokens = metrics.tokens || { input: 0, output: 0 };

    return `
        <div class="intel-hud-grid compare-intel-panel">
            <div class="hud-card-score" style="border-left-color: ${rankColor};">
                <div>
                    <div class="intel-label">QUALITY GRADE ${createInfoBtn('QUALITY_GRADE')}</div>
                    <div class="score-value-container">
                        <div class="score-main" style="color: ${rankColor}; text-shadow: 0 0 20px ${rankColor}66;">${score}</div>
                        <div class="score-rank">RANK ${rank}</div>
                    </div>
                </div>
                <div class="score-meta">
                    <div class="meta-row">
                        <span class="meta-label">PROVIDER</span>
                        <span class="meta-val" style="color: var(--neon-purple);">${providerLabel}</span>
                    </div>
                    <div class="meta-row">
                        <span class="meta-label">MODEL</span>
                        <span class="meta-val">${modelLabel}</span>
                    </div>
                    <div class="meta-row">
                        <span class="meta-label">LATENCY</span>
                        <span class="meta-val">${metrics.performance?.totalTime || 0}ms</span>
                    </div>
                </div>
            </div>

            <div class="hud-card">
                <div class="hud-title">
                    <span>DIMENSIONS ${createInfoBtn('DIMENSIONS')}</span>
                    <span style="color: var(--neon-green);">4-AXIS</span>
                </div>
                <div style="display:flex; flex-direction:column; gap:10px; margin-top:12px;">
                    ${renderDimensionBar('Completeness', metrics.quality?.dimensions?.completeness || 0, 40, 'var(--neon-green)', '完整性 - 内容结构完整度')}
                    ${renderDimensionBar('Accuracy', metrics.quality?.dimensions?.accuracy || 0, 30, 'var(--neon-blue)', '准确性 - 翻译和定义准确度')}
                    ${renderDimensionBar('Example Quality', metrics.quality?.dimensions?.exampleQuality || 0, 20, 'var(--neon-purple)', '例句质量 - 例句自然度和多样性')}
                    ${renderDimensionBar('Formatting', metrics.quality?.dimensions?.formatting || 0, 10, 'var(--neon-amber)', '格式化 - HTML 和音频标签正确性')}
                </div>
            </div>

            <div class="hud-card">
                <div class="hud-title">
                    <span>GENERATION CONFIG ${createInfoBtn('GENERATION_CONFIG')}</span>
                    <span style="color: var(--neon-amber);">PARAMS</span>
                </div>
                <div style="font-family:'JetBrains Mono'; font-size:11px; margin-top:12px; display:flex; flex-direction:column; gap:6px;">
                    <div style="display:flex; justify-content:space-between;"><span style="color:var(--sci-text-muted);">Temperature:</span><span>${metrics.metadata?.temperature || 0.7}</span></div>
                    <div style="display:flex; justify-content:space-between;"><span style="color:var(--sci-text-muted);">Max Tokens:</span><span>${metrics.metadata?.maxOutputTokens || 2048}</span></div>
                    <div style="display:flex; justify-content:space-between;"><span style="color:var(--sci-text-muted);">Top P:</span><span>${metrics.metadata?.topP || 0.95}</span></div>
                    <div style="display:flex; justify-content:space-between;"><span style="color:var(--sci-text-muted);">Template:</span><span>${templateCompliance}</span></div>
                </div>
            </div>

            <div class="hud-card">
                <div class="hud-title">
                    <span>CHRONO SEQUENCE ${createInfoBtn('CHRONO_SEQUENCE')}</span>
                    <span style="color: var(--neon-blue);">T-MINUS</span>
                </div>
                <div id="hudTimeline${idSuffix}" class="chart-box"></div>
            </div>

            <div class="hud-card">
                <div class="hud-title">
                    <span>TOKEN FLUX ${createInfoBtn('TOKEN_FLUX')}</span>
                    <span style="color: var(--neon-purple);">USAGE</span>
                </div>
                <div id="hudTokens${idSuffix}" class="chart-box"></div>
                <div class="token-stat-row">
                    <span class="tooltip-inline">IN: ${tokens.input}</span>
                    <span class="tooltip-inline">OUT: ${tokens.output}</span>
                </div>
                <div class="token-cost-tag">COST: $${(metrics.cost?.total || 0).toFixed(6)}</div>
            </div>

            <div class="hud-card hud-card-wide">
                <div class="hud-title">
                    <span>DIMENSIONAL SCAN ${createInfoBtn('DIMENSIONAL_SCAN')}</span>
                    <span style="color: var(--neon-green);">RADAR</span>
                </div>
                <div id="hudRadar${idSuffix}" class="chart-box" style="height: 200px;"></div>
            </div>

            <div class="hud-card hud-card-wide">
                <div class="hud-title">
                    <span>📄 PROMPT TEXT ${createInfoBtn('PROMPT_TEXT')}</span>
                    <span style="color: var(--sci-text-muted); font-size:11px;">RAW / STRUCT</span>
                </div>
                <div class="intel-viewer" data-viewer="prompt">
                    <div class="viewer-tabs">
                        <button class="viewer-tab ${promptDefaultView === 'raw' ? 'active' : ''}" data-view="raw">RAW</button>
                        <button class="viewer-tab ${promptDefaultView === 'structured' ? 'active' : ''}" data-view="structured">STRUCT</button>
                        <button class="viewer-copy" type="button">COPY</button>
                    </div>
                    <div class="viewer-body">
                        <pre class="viewer-panel ${promptDefaultView === 'raw' ? 'active' : ''}" data-view="raw">${escapeHtml(promptRawText || 'N/A')}</pre>
                        <pre class="viewer-panel ${promptDefaultView === 'structured' ? 'active' : ''}" data-view="structured">${escapeHtml(promptStructText || 'N/A')}</pre>
                    </div>
                </div>
            </div>

            <div class="hud-card hud-card-wide">
                <div class="hud-title">
                    <span>📤 LLM OUTPUT ${createInfoBtn('LLM_OUTPUT')}</span>
                    <span style="color: var(--sci-text-muted); font-size:11px;">RAW / STRUCT</span>
                </div>
                <div class="intel-viewer" data-viewer="output">
                    <div class="viewer-tabs">
                        <button class="viewer-tab ${outputDefaultView === 'raw' ? 'active' : ''}" data-view="raw">RAW</button>
                        <button class="viewer-tab ${outputDefaultView === 'structured' ? 'active' : ''}" data-view="structured">STRUCT</button>
                        <button class="viewer-copy" type="button">COPY</button>
                    </div>
                    <div class="viewer-body">
                        <pre class="viewer-panel ${outputDefaultView === 'raw' ? 'active' : ''}" data-view="raw">${escapeHtml(outputRawText || 'N/A')}</pre>
                        <pre class="viewer-panel ${outputDefaultView === 'structured' ? 'active' : ''}" data-view="structured">${escapeHtml(outputStructText || 'N/A')}</pre>
                    </div>
                </div>
            </div>

            <div class="hud-card" style="display:flex; flex-direction:column; gap:8px;">
                <div class="hud-title">
                    <span>EXPORT ${createInfoBtn('EXPORT_DATA')}</span>
                    <span style="color: var(--neon-amber);">DATA</span>
                </div>
                <button onclick="exportMetrics('json')" style="padding:8px; background:rgba(16,185,129,0.1); border:1px solid rgba(16,185,129,0.3); border-radius:4px; color:#059669; font-family:'JetBrains Mono'; font-size:11px; cursor:pointer;">📊 EXPORT JSON</button>
                <button onclick="exportMetrics('csv')" style="padding:8px; background:rgba(59,130,246,0.1); border:1px solid rgba(59,130,246,0.3); border-radius:4px; color:#2563eb; font-family:'JetBrains Mono'; font-size:11px; cursor:pointer;">📈 EXPORT CSV</button>
            </div>
        </div>
    `;
}

function renderCardModal(markdown, title, options = {}) {
    let displayTitle = title;
    const h1Match = markdown.match(/^#\s+(.+)$/m);
    if (h1Match) displayTitle = h1Match[1];
    const folder = options.folder || store.get('selectedFolder') || '';
    const generationId = Number(options.metrics?.id || options.generationId || 0);
    const cardType = normalizeCardType(
        options.cardType ||
        options.metrics?.card_type ||
        options.metrics?.observability?.metadata?.cardType ||
        'trilingual'
    );
    const cardTypeMetaLabel = cardType === 'grammar_ja' ? 'JA GRAMMAR' : 'TRILINGUAL';
    const cardTypeTabLabel = cardType === 'grammar_ja' ? '语法卡片' : '三语卡片';
    const highlightSourceHash = computeTextHash(markdown);
    const highlightStorageKey = buildCardHighlightStorageKey({
        folder,
        baseName: options.baseName || '',
        generationId,
        title: displayTitle
    });
    activeCardContext = {
        folder,
        baseName: options.baseName || '',
        generationId,
        cardType,
        highlightStorageKey,
        highlightSourceHash
    };

    const safeHtml = renderMarkdownWithAudioButtons(markdown, { folder });
    const persistedHtml = loadPersistedCardHighlights(highlightStorageKey, highlightSourceHash);
    const cardContentHtml = persistedHtml || safeHtml;
    if (persistedHtml) {
        backfillCardHighlightsToServer({ ...activeCardContext }, persistedHtml);
    }

    // 尝试获取 observability 数据 (优先使用传入的 options.metrics)
    let rawMetrics = options.metrics || null;
    const allowLatest = options.useLatestObservability === true;
    if (!rawMetrics && allowLatest) {
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
        const metadata = { ...(obs.metadata || {}) };
        if (!metadata.promptParsed && obs.prompt_parsed) metadata.promptParsed = obs.prompt_parsed;
        if (!metadata.promptText && obs.prompt_full) metadata.promptText = obs.prompt_full;
        if (!metadata.rawOutput && obs.llm_output) {
            let rawOutput = obs.llm_output;
            if (typeof rawOutput === 'string') {
                try {
                    rawOutput = JSON.stringify(JSON.parse(rawOutput), null, 2);
                } catch (e) {}
            }
            metadata.rawOutput = rawOutput;
        }
        if (!metadata.model && rawMetrics.llm_model) metadata.model = rawMetrics.llm_model;
        if (!metadata.provider && rawMetrics.llm_provider) metadata.provider = rawMetrics.llm_provider;

        metrics = {
            id: rawMetrics.id,
            quality: { score: obs.quality_score },
            tokens: { input: obs.tokens_input, output: obs.tokens_output, total: obs.tokens_total },
            cost: { total: obs.cost_total, input: obs.cost_input, output: obs.cost_output, currency: obs.cost_currency },
            performance: { totalTime: obs.performance_total_ms, phases: obs.performance_phases },
            metadata
        };
        if (obs.quality_dimensions) metrics.quality.dimensions = obs.quality_dimensions;
        if (obs.quality_warnings) metrics.quality.warnings = obs.quality_warnings;
        if (obs.quality_checks) metrics.quality.checks = obs.quality_checks;
    }
    
    // Fallback defaults
    metrics = metrics || {
        quality: { score: 0 },
        performance: { totalTime: 0, phases: {} },
        tokens: { total: 0, input: 0, output: 0 },
        cost: { total: 0 }
    };

    const tokens = metrics.tokens || { input: 0, output: 0 };
    const providerLabel = (metrics.metadata?.provider || rawMetrics?.llm_provider || store.get('llmProvider') || 'local').toUpperCase();
    const modelLabel = metrics.metadata?.model || rawMetrics?.llm_model || 'UNKNOWN';

    const toText = (val) => {
        if (val === null || val === undefined) return '';
        if (typeof val === 'string') return val;
        try { return JSON.stringify(val, null, 2); } catch (e) { return String(val); }
    };
    const promptRawText = toText(metrics.metadata?.promptText);
    const promptStructText = toText(metrics.metadata?.promptParsed);
    const outputRawText = toText(metrics.metadata?.rawOutput);
    let outputStructText = toText(metrics.metadata?.outputStructured);
    if (!outputStructText && outputRawText) {
        try { outputStructText = JSON.stringify(JSON.parse(outputRawText), null, 2); } catch (e) {}
    }
    const promptDefaultView = promptRawText ? 'raw' : 'structured';
    const outputDefaultView = outputRawText ? 'raw' : 'structured';
    
    // Calculate Rank
    const score = metrics.quality?.score || 0;
    const templateCompliance = metrics.quality?.templateCompliance ?? metrics.quality?.checks?.templateCompliance ?? 0;
    const rank = score >= 90 ? 'S' : score >= 80 ? 'A' : score >= 70 ? 'B' : score >= 60 ? 'C' : 'D';
    const rankColor = score >= 80 ? 'var(--neon-green)' : score >= 60 ? 'var(--neon-amber)' : 'var(--neon-red)';

    els.modalContainer.innerHTML = `
        <div class="modern-card glass-panel" style="background: #ffffff;">
            <button class="mc-delete" id="mcDeleteBtn" title="Delete Record">🗑️</button>
            <button class="mc-close" id="mcCloseBtn">×</button>

            <div class="mc-header" style="border-bottom: 1px solid var(--sci-border);">
                <div style="flex:1;">
                    <h1 class="mc-phrase font-display" style="color: var(--sci-text-main);">${escapeHtml(displayTitle)}</h1>
                    <div class="mc-meta font-mono" style="color: var(--neon-blue);">
                        <span>${cardTypeMetaLabel}</span>
                        <span>::</span>
                        <span>${new Date().getFullYear()}</span>
                    </div>
                </div>

                <div class="panel-tabs sub-tabs" style="margin:0; border:none; background: #f3f4f6; border-radius: 8px; padding: 4px;">
                    <button class="tab-btn active" data-target="cardContent" style="font-size:12px; padding: 4px 12px;">CONTENT</button>
                    <button class="tab-btn" data-target="cardIntel" style="font-size:12px; padding: 4px 12px; color: var(--neon-purple);">INTEL</button>
                    ${generationId ? '<button class="tab-btn" data-target="cardReview" style="font-size:12px; padding: 4px 12px; color: #0f766e;">REVIEW</button>' : ''}
                </div>
            </div>

            <!-- Content Tab -->
            <div id="cardContent" class="mc-body mc-content" style="display:block;">
                <div class="hud-ticker" style="margin-bottom: 10px;">CARD TYPE · ${cardTypeTabLabel}</div>
                ${cardContentHtml}
            </div>

            <!-- Intel Tab (HUD) -->
            <div id="cardIntel" class="mc-body intel-hud-grid" style="display:none;">

                <!-- 1. Core Reactor -->
                <div class="hud-card-score" style="border-left-color: ${rankColor};">
                    <div>
                        <div class="intel-label">QUALITY GRADE ${createInfoBtn('QUALITY_GRADE')}</div>
                        <div class="score-value-container">
                            <div class="score-main" style="color: ${rankColor}; text-shadow: 0 0 20px ${rankColor}66;">${score}</div>
                            <div class="score-rank">RANK ${rank}</div>
                        </div>
                    </div>
                    <div class="score-meta">
                        <div class="meta-row">
                            <span class="meta-label">PROVIDER</span>
                            <span class="meta-val" style="color: var(--neon-purple);">${providerLabel}</span>
                        </div>
                        <div class="meta-row">
                            <span class="meta-label">MODEL</span>
                            <span class="meta-val">${modelLabel}</span>
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
                    <div class="hud-title">
                        <span>DIMENSIONS ${createInfoBtn('DIMENSIONS')}</span>
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
                    <div class="hud-title">
                        <span>GENERATION CONFIG ${createInfoBtn('GENERATION_CONFIG')}</span>
                        <span style="color: var(--neon-amber);">PARAMS</span>
                    </div>
                    <div style="font-family:'JetBrains Mono'; font-size:11px; margin-top:12px; display:flex; flex-direction:column; gap:6px;">
                        <div style="display:flex; justify-content:space-between;"><span style="color:var(--sci-text-muted);">Temperature:</span><span>${metrics.metadata?.temperature || 0.7}</span></div>
                        <div style="display:flex; justify-content:space-between;"><span style="color:var(--sci-text-muted);">Max Tokens:</span><span>${metrics.metadata?.maxOutputTokens || 2048}</span></div>
                        <div style="display:flex; justify-content:space-between;"><span style="color:var(--sci-text-muted);">Top P:</span><span>${metrics.metadata?.topP || 0.95}</span></div>
                        <div style="display:flex; justify-content:space-between;"><span style="color:var(--sci-text-muted);">Template:</span><span>${templateCompliance}</span></div>
                    </div>
                </div>

                <!-- 4. Chrono Waterfall -->
                <div class="hud-card">
                    <div class="hud-title">
                        <span>CHRONO SEQUENCE ${createInfoBtn('CHRONO_SEQUENCE')}</span>
                        <span style="color: var(--neon-blue);">T-MINUS</span>
                    </div>
                    <div id="hudTimeline" class="chart-box"></div>
                </div>

                <!-- 5. Token Flux -->
                <div class="hud-card">
                    <div class="hud-title">
                        <span>TOKEN FLUX ${createInfoBtn('TOKEN_FLUX')}</span>
                        <span style="color: var(--neon-purple);">USAGE</span>
                    </div>
                    <div id="hudTokens" class="chart-box"></div>
                    <div class="token-stat-row">
                        <span class="tooltip-inline">IN: ${tokens.input}</span>
                        <span class="tooltip-inline">OUT: ${tokens.output}</span>
                    </div>
                    <div class="token-cost-tag">COST: $${(metrics.cost?.total || 0).toFixed(6)}</div>
                </div>

                <!-- 6. Radar Chart -->
                <div class="hud-card hud-card-wide">
                    <div class="hud-title">
                        <span>DIMENSIONAL SCAN ${createInfoBtn('DIMENSIONAL_SCAN')}</span>
                        <span style="color: var(--neon-green);">RADAR</span>
                    </div>
                    <div id="hudRadar" class="chart-box" style="height: 200px;"></div>
                </div>

                <!-- 7. Prompt Viewer -->
                <div class="hud-card hud-card-wide">
                    <div class="hud-title">
                        <span>📄 PROMPT TEXT ${createInfoBtn('PROMPT_TEXT')}</span>
                        <span style="color: var(--sci-text-muted); font-size:11px;">RAW / STRUCT</span>
                    </div>
                    <div class="intel-viewer" data-viewer="prompt">
                        <div class="viewer-tabs">
                            <button class="viewer-tab ${promptDefaultView === 'raw' ? 'active' : ''}" data-view="raw">RAW</button>
                            <button class="viewer-tab ${promptDefaultView === 'structured' ? 'active' : ''}" data-view="structured">STRUCT</button>
                            <button class="viewer-copy" type="button">COPY</button>
                        </div>
                        <div class="viewer-body">
                            <pre class="viewer-panel ${promptDefaultView === 'raw' ? 'active' : ''}" data-view="raw">${escapeHtml(promptRawText || 'N/A')}</pre>
                            <pre class="viewer-panel ${promptDefaultView === 'structured' ? 'active' : ''}" data-view="structured">${escapeHtml(promptStructText || 'N/A')}</pre>
                        </div>
                    </div>
                </div>

                <!-- 8. Output Viewer -->
                <div class="hud-card hud-card-wide">
                    <div class="hud-title">
                        <span>📤 LLM OUTPUT ${createInfoBtn('LLM_OUTPUT')}</span>
                        <span style="color: var(--sci-text-muted); font-size:11px;">RAW / STRUCT</span>
                    </div>
                    <div class="intel-viewer" data-viewer="output">
                        <div class="viewer-tabs">
                            <button class="viewer-tab ${outputDefaultView === 'raw' ? 'active' : ''}" data-view="raw">RAW</button>
                            <button class="viewer-tab ${outputDefaultView === 'structured' ? 'active' : ''}" data-view="structured">STRUCT</button>
                            <button class="viewer-copy" type="button">COPY</button>
                        </div>
                        <div class="viewer-body">
                            <pre class="viewer-panel ${outputDefaultView === 'raw' ? 'active' : ''}" data-view="raw">${escapeHtml(outputRawText || 'N/A')}</pre>
                            <pre class="viewer-panel ${outputDefaultView === 'structured' ? 'active' : ''}" data-view="structured">${escapeHtml(outputStructText || 'N/A')}</pre>
                        </div>
                    </div>
                </div>

                <!-- 9. Export Controls -->
                <div class="hud-card" style="display:flex; flex-direction:column; gap:8px;">
                    <div class="hud-title">
                        <span>EXPORT ${createInfoBtn('EXPORT_DATA')}</span>
                        <span style="color: var(--neon-amber);">DATA</span>
                    </div>
                    <button onclick="exportMetrics('json')" style="padding:8px; background:rgba(16,185,129,0.1); border:1px solid rgba(16,185,129,0.3); border-radius:4px; color:#059669; font-family:'JetBrains Mono'; font-size:11px; cursor:pointer;">📊 EXPORT JSON</button>
                    <button onclick="exportMetrics('csv')" style="padding:8px; background:rgba(59,130,246,0.1); border:1px solid rgba(59,130,246,0.3); border-radius:4px; color:#2563eb; font-family:'JetBrains Mono'; font-size:11px; cursor:pointer;">📈 EXPORT CSV</button>
                </div>

            </div>

            ${generationId ? '<div id="cardReview" class="mc-body" style="display:none;"></div>' : ''}
        </div>
    `;

    // 绑定删除按钮
    const deleteBtn = document.getElementById('mcDeleteBtn');
    if (deleteBtn) {
        deleteBtn.onclick = async () => {
            if (confirm('Are you sure you want to delete this record? This cannot be undone.')) {
                try {
                    if (options.metrics && options.metrics.id) {
                        try {
                            await api.deleteRecord(options.metrics.id);
                        } catch (err) {
                            // 历史数据可能存在 DB 记录缺失，回退到按 folder/base 删除文件。
                            const canFallback = options.folder && options.baseName;
                            const notFound = /record not found/i.test(String(err?.message || ''));
                            if (canFallback && notFound) {
                                await api.deleteRecordByFile(options.folder, options.baseName);
                            } else {
                                throw err;
                            }
                        }
                    } else if (options.folder && options.baseName) {
                        await api.deleteRecordByFile(options.folder, options.baseName);
                    } else {
                        throw new Error('Cannot identify record to delete');
                    }
                    clearPersistedCardHighlights(activeCardContext?.highlightStorageKey || '', { removeAllVersions: true });
                    closeModal();
                    loadFolders({ keepSelection: true, refreshFiles: true, noCache: true });
                } catch (e) {
                    alert('Delete failed: ' + e.message);
                }
            }
        };
    }

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
            const reviewTab = els.modalContainer.querySelector('#cardReview');
            
            if (targetId === 'cardIntel') {
                intelTab.style.display = 'grid';
                requestAnimationFrame(() => renderIntelCharts(metrics));
            } else {
                intelTab.style.display = 'none';
            }

            if (reviewTab) {
                if (targetId === 'cardReview') {
                    reviewTab.style.display = 'block';
                    loadReviewPanel({ generationId });
                } else {
                    reviewTab.style.display = 'none';
                }
            }
        };
    });

    // 绑定音频按钮
    bindAudioButtons(els.modalContainer, options.folder || store.get('selectedFolder'));

    // 绑定文本选取 → 生成
    const cardContent = els.modalContainer.querySelector('#cardContent');
    if (cardContent) {
        initSelectionToGenerate(cardContent);
        hydrateCardHighlightsFromServer(cardContent, { ...activeCardContext });
    }

    els.modalOverlay.classList.remove('hidden');
    setTimeout(() => {
        els.modalOverlay.classList.add('show');
        bindInfoButtons(els.modalContainer);
        bindIntelViewers(els.modalContainer);
    }, 10);

    if (generationId) {
        loadReviewPanel({ generationId });
    }
}

function bindIntelViewers(container) {
    const viewers = container.querySelectorAll('.intel-viewer');
    viewers.forEach(viewer => {
        const tabs = viewer.querySelectorAll('.viewer-tab');
        const panels = viewer.querySelectorAll('.viewer-panel');
        const copyBtn = viewer.querySelector('.viewer-copy');

        tabs.forEach(tab => {
            tab.onclick = () => {
                const view = tab.dataset.view;
                tabs.forEach(t => t.classList.toggle('active', t === tab));
                panels.forEach(p => p.classList.toggle('active', p.dataset.view === view));
            };
        });

        if (copyBtn) {
            copyBtn.onclick = async () => {
                const active = viewer.querySelector('.viewer-panel.active');
                const text = active ? active.textContent : '';
                try {
                    await navigator.clipboard.writeText(text || '');
                    const prev = copyBtn.textContent;
                    copyBtn.textContent = 'COPIED';
                    setTimeout(() => { copyBtn.textContent = prev; }, 1200);
                } catch (e) {
                    alert('Copy failed');
                }
            };
        }
    });
}

// 渲染质量维度条
function renderDimensionBar(label, value, maxValue, color, tooltip = '') {
    const percentage = (value / maxValue) * 100;
    const barColor = percentage >= 80 ? color : percentage >= 60 ? 'var(--neon-amber)' : 'var(--neon-red)';
    // const tooltipAttr = tooltip ? `class="tooltip-trigger" data-tooltip="${tooltip}"` : '';
    return `
        <div>
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
                `Template Compliance,${data.quality?.templateCompliance ?? data.quality?.checks?.templateCompliance ?? 0}`,
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
function renderIntelCharts(metrics, suffix = '') {
    if (!window.d3) return; 
    const idSuffix = suffix ? `-${suffix}` : '';

    // 1. Timeline
    {
        const container = document.getElementById(`hudTimeline${idSuffix}`);
        if (!container) return;
        container.innerHTML = '';
        const width = container.clientWidth;
        const height = container.clientHeight;
        let phases = metrics.performance?.phases || {};
        if (typeof phases === 'string') {
            try { phases = JSON.parse(phases || '{}'); } catch (e) { phases = {}; }
        }
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
        const container = document.getElementById(`hudTokens${idSuffix}`);
        if (!container) return;
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
        const container = document.getElementById(`hudRadar${idSuffix}`);
        if (!container) return;
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
    if (selectionFabCleanup) {
        selectionFabCleanup();
        selectionFabCleanup = null;
    }
    activeCardContext = null;
    window.getSelection().removeAllRanges();
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
                <span>${normalizeCardType(r.card_type) === 'grammar_ja' ? '📘 语法' : '🧩 三语'}</span>
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
                renderCardModal(mdContent, record.phrase, {
                    folder: record.folder_name,
                    baseName: record.base_filename,
                    metrics: record,
                    cardType: record.card_type || record.observability?.metadata?.cardType || 'trilingual'
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
        loadFolders({ keepSelection: true, refreshFiles: true, noCache: true });
        els.contextMenu.classList.add('hidden');
    } catch (err) {
        alert('删除失败: ' + err.message);
    }
}

// 启动应用
init();
