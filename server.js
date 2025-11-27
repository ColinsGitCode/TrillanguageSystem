const express = require('express');
const path = require('path');
const fs = require('fs');

const app = express();
const PORT = process.env.PORT || 3010;
const RECORDS_PATH = process.env.RECORDS_PATH || '/data/trilingual_records';

const baseDir = path.resolve(RECORDS_PATH);

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

app.use(express.static(path.join(__dirname, 'public')));

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
  res.sendFile(filePath);
});

app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.listen(PORT, () => {
  console.log(`Viewer running on port ${PORT}`);
  console.log(`Serving records from ${baseDir}`);
});
