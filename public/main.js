const folderListEl = document.getElementById('folderList');
const fileListEl = document.getElementById('fileList');
const folderCountEl = document.getElementById('folderCount');
const fileCountEl = document.getElementById('fileCount');
const modalOverlay = document.getElementById('modalOverlay');
const modalFrame = document.getElementById('modalFrame');
const modalTitle = document.getElementById('modalTitle');

// Generation Elements
const phraseInput = document.getElementById('phraseInput');
const genBtn = document.getElementById('genBtn');
const genStatus = document.getElementById('genStatus');

const state = {
  folders: [],
  files: [],
  selectedFolder: null,
  selectedFile: null,
  selectedFileTitle: null,
};

function setStatus(text) {
  console.log(text);
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

// Generation Logic
genBtn.addEventListener('click', async () => {
    const phrase = phraseInput.value.trim();
    if (!phrase) return;

    genBtn.disabled = true;
    genBtn.textContent = '...';
    genStatus.textContent = 'Generating... (may take 10s)';
    genStatus.style.color = '#7dd3fc';

    try {
        const res = await fetch('/api/generate', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ phrase })
        });

        const data = await res.json();
        
        if (!res.ok) {
            const detail = data.details && Array.isArray(data.details) ? data.details.join('；') : '';
            const message = detail ? `${data.error}（${detail}）` : data.error;
            throw new Error(message || 'Generation failed');
        }

        const savedHtml = data.result.files.find((file) => file.endsWith('.html')) || data.result.files[0];
        genStatus.textContent = `已保存：${data.result.folder}/${savedHtml}`;
        genStatus.style.color = '#7dd3fc';
        phraseInput.value = '';

        // Refresh folders and select the new one (today's folder)
        const newFolder = data.result.folder;
        // Reload folders, select the target folder, and refresh its files
        await loadFolders({ targetSelect: newFolder });

    } catch (error) {
        console.error(error);
        genStatus.textContent = 'Error: ' + error.message;
        genStatus.style.color = '#f87171';
    } finally {
        genBtn.disabled = false;
        genBtn.textContent = 'Generate';
        // Clear status after 5s
        setTimeout(() => { 
            if (genStatus.textContent.startsWith('已保存：')) genStatus.textContent = ''; 
        }, 5000);
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

    // Selection Logic Priority:
    // 1. targetSelect (if specified and exists)
    // 2. prevSelectedFolder (if keepSelection is true and exists)
    // 3. First folder (default)

    let folderToSelect = state.folders[0];

    if (targetSelect && state.folders.includes(targetSelect)) {
        folderToSelect = targetSelect;
    } else if (keepSelection && prevSelectedFolder && state.folders.includes(prevSelectedFolder)) {
        folderToSelect = prevSelectedFolder;
    }

    if (targetSelect || !keepSelection || (keepSelection && !prevSelectedFolder)) {
         await selectFolder(folderToSelect);
    } else if (refreshFiles) {
         // Just refresh current
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

function selectFile(file, title) {
  if (!state.selectedFolder) return;
  state.selectedFile = file;
  state.selectedFileTitle = title || file;
  renderFiles();
  const src = `/api/folders/${encodeURIComponent(state.selectedFolder)}/files/${encodeURIComponent(file)}`;
  openModal(src, title || file);
  setStatus('已加载文件');
}

function openModal(src, fileName) {
  modalFrame.src = src;
  modalTitle.textContent = fileName || 'HTML 文件内容';
  modalOverlay.classList.remove('hidden');
  modalOverlay.classList.add('show');
}

function closeModal() {
  modalOverlay.classList.remove('show');
  modalOverlay.classList.add('hidden');
  modalFrame.src = '';
  state.selectedFile = null;
  state.selectedFileTitle = null;
  renderFiles();
}

modalOverlay.addEventListener('click', () => closeModal());
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') {
    closeModal();
  }
});

const modalContent = modalOverlay.querySelector('.modal-content');
modalContent.addEventListener('click', (e) => e.stopPropagation());

loadFolders();

setInterval(() => {
  loadFolders({ keepSelection: true, refreshFiles: true });
}, 60_000);
