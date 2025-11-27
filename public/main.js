const folderListEl = document.getElementById('folderList');
const fileListEl = document.getElementById('fileList');
const folderCountEl = document.getElementById('folderCount');
const fileCountEl = document.getElementById('fileCount');
const modalOverlay = document.getElementById('modalOverlay');
const modalFrame = document.getElementById('modalFrame');
const modalTitle = document.getElementById('modalTitle');

const state = {
  folders: [],
  files: [],
  selectedFolder: null,
  selectedFile: null,
};

function setStatus(text) {
  console.log(text);
}

async function loadFolders() {
  try {
    setStatus('加载文件夹列表中…');
    const response = await fetch('/api/folders');
    if (!response.ok) throw new Error('无法获取文件夹列表');
    const data = await response.json();
    state.folders = data.folders || [];
    folderCountEl.textContent = state.folders.length;
    renderFolders();
    if (state.folders.length && !state.selectedFolder) {
      await selectFolder(state.folders[0]);
    } else {
      setStatus('选择一个文件夹以查看 HTML 清单');
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
  state.folders.forEach((name) => {
    const btn = document.createElement('button');
    btn.textContent = name;
    btn.className = state.selectedFolder === name ? 'active' : '';
    btn.addEventListener('click', () => selectFolder(name));
    folderListEl.appendChild(btn);
  });
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
    state.files = data.files || [];
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
  state.files.forEach((file) => {
    const btn = document.createElement('button');
    btn.textContent = file;
    btn.className = state.selectedFile === file ? 'active' : '';
    btn.addEventListener('click', () => selectFile(file));
    fileListEl.appendChild(btn);
  });
}

function selectFile(file) {
  if (!state.selectedFolder) return;
  state.selectedFile = file;
  renderFiles();
  const src = `/api/folders/${encodeURIComponent(state.selectedFolder)}/files/${encodeURIComponent(file)}`;
  openModal(src, file);
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
