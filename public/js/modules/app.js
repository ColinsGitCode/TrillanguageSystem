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
// 生成器逻辑 (Optimized)
// ==========================================

function initGenerator() {
    els.genBtn.addEventListener('click', async () => {
        const phrase = els.phraseInput.value.trim();
        if (!phrase) return;

        store.setState({ isGenerating: true });
        updateGenUI(true);
        startProgress(phrase);

        try {
            updateStep('init', '初始化...');
            await new Promise(r => setTimeout(r, 100));
            
            updateStep('prompt', '构建优化 Prompt...');
            updateStep('llm', 'AI 思考中...');
            
            const data = await api.generate(phrase, store.get('llmProvider'));
            
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
    player.stop();
    let displayTitle = title;
    const h1Match = markdown.match(/^#\s+(.+)$/m);
    if (h1Match) displayTitle = h1Match[1];

    const html = marked.parse(markdown);
    // 处理音频标签
    const processedHtml = html.replace(/<audio\b([^>]*?)\s+src=(['"])([^'"]+)\2([^>]*)>/gi, (match, pre, quote, src, post) => {
        return `<button class="audio-btn" data-src="${src}">▶</button>`;
    });

    const safeHtml = sanitizeHtml(processedHtml);

    const folderName = options.folder ?? null;
    const baseName = options.baseName ?? null;
    const canDelete = Boolean(folderName && baseName);
    els.modalContainer.innerHTML = `
        <div class="modern-card">
            <button class="mc-close" id="mcCloseBtn">×</button>
            <button class="mc-delete" id="mcDeleteBtn" ${canDelete ? '' : 'disabled'} title="删除此学习卡片">🗑</button>
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

    const closeBtn = document.getElementById('mcCloseBtn');
    if (closeBtn) closeBtn.onclick = closeModal;
    const deleteBtn = document.getElementById('mcDeleteBtn');
    if (deleteBtn) {
        deleteBtn.onclick = async () => {
            if (!canDelete) return;
            if (!confirm('确定删除此学习卡片及其所有文件吗？不可恢复。')) return;
            await api.deleteRecordByFile(folderName, baseName);
            await loadFolders({ keepSelection: true, refreshFiles: true, noCache: true });
            closeModal();
        };
    }

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
                    recordId: record.id,
                    folder: record.folder_name,
                    baseName: record.base_filename
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
