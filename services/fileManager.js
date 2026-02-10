const fs = require('fs');
const path = require('path');

// Inherit the base path from server.js logic (or environment variable)
const RECORDS_PATH = process.env.RECORDS_PATH || '/data/trilingual_records';
// If running locally without docker and without env, fallback to a local desktop path for safety is handled in server.js usually.
// But here we rely on process.env.RECORDS_PATH. 
// In server.js: const baseDir = path.resolve(RECORDS_PATH);
// We will resolve it similarly.

const baseDir = path.resolve(RECORDS_PATH);

function resolveFolder(folderName) {
    const safeName = folderName || '';
    const folderPath = path.resolve(path.join(baseDir, safeName));
    if (!folderPath.startsWith(baseDir)) return null;
    if (!fs.existsSync(folderPath) || !fs.statSync(folderPath).isDirectory()) return null;
    return folderPath;
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

function listHtmlFilesInFolder(folderName) {
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

function readFileInFolder(folderName, filename) {
    const folderPath = resolveFolder(folderName);
    if (!folderPath) throw new Error('Folder not found');
    const safeFile = filename || '';
    const filePath = path.resolve(path.join(folderPath, safeFile));
    if (!filePath.startsWith(folderPath)) throw new Error('Invalid file path');
    if (!fs.existsSync(filePath) || !fs.statSync(filePath).isFile()) {
        throw new Error('File not found');
    }
    const ext = path.extname(filePath).toLowerCase();
    if (['.md', '.html', '.json', '.txt'].includes(ext)) {
        return fs.readFileSync(filePath, 'utf-8');
    }
    return fs.readFileSync(filePath);
}

function escapeRegex(value) {
    return String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function deleteRecordFiles(folderName, baseName) {
    const folderPath = resolveFolder(folderName);
    if (!folderPath) throw new Error('Folder not found');
    const safeBase = String(baseName || '').trim();
    if (!safeBase) throw new Error('Base name required');

    const candidates = new Set([
        `${safeBase}.md`,
        `${safeBase}.html`,
        `${safeBase}.meta.json`,
    ]);

    const audioRegex = new RegExp(`^${escapeRegex(safeBase)}_[\\w-]+\\.(wav|mp3|m4a)$`, 'i');
    const files = fs.readdirSync(folderPath, { withFileTypes: true })
        .filter((entry) => entry.isFile())
        .map((entry) => entry.name);

    const deleted = [];
    for (const name of files) {
        if (candidates.has(name) || audioRegex.test(name)) {
            const filePath = path.join(folderPath, name);
            try {
                fs.unlinkSync(filePath);
                deleted.push(filePath);
            } catch (err) {
                console.warn(`[Delete] Failed to remove file: ${filePath}`, err.message);
            }
        }
    }

    return deleted;
}

/**
 * Ensures the target directory for today exists (YYYYMMDD).
 * @returns {string} The full path to today's directory.
 */
function ensureTodayDirectory() {
    const today = new Date();
    const year = today.getFullYear();
    const month = String(today.getMonth() + 1).padStart(2, '0');
    const day = String(today.getDate()).padStart(2, '0');
    const folderName = `${year}${month}${day}`;
    
    const targetDir = path.join(baseDir, folderName);
    
    if (!fs.existsSync(targetDir)) {
        fs.mkdirSync(targetDir, { recursive: true });
    }
    
    return { targetDir, folderName };
}

/**
 * Ensures a specific folder exists under records path.
 * @param {string} folderName - Target folder name (for example: YYYYMMDD).
 * @returns {{targetDir: string, folderName: string}} Ensured folder info.
 */
function ensureFolderDirectory(folderName) {
    const safeName = String(folderName || '').trim();
    if (!safeName) {
        return ensureTodayDirectory();
    }

    if (!/^[\w.-]+$/.test(safeName)) {
        throw new Error('Invalid folder name');
    }

    const targetDir = path.resolve(path.join(baseDir, safeName));
    if (!targetDir.startsWith(baseDir)) {
        throw new Error('Invalid folder path');
    }

    if (!fs.existsSync(targetDir)) {
        fs.mkdirSync(targetDir, { recursive: true });
    }
    if (!fs.statSync(targetDir).isDirectory()) {
        throw new Error('Target path is not a directory');
    }

    return { targetDir, folderName: safeName };
}

/**
 * Builds a safe base filename for generated assets.
 * @param {string} phrase - The input phrase.
 * @param {string} targetDir - Folder used to check for duplicates.
 * @returns {string} Safe filename base.
 */
function buildBaseName(phrase, targetDir) {
    const raw = String(phrase || '').trim().replace(/\s+/g, ' ');
    let base = raw
        .replace(/[\\/:*?"<>|]/g, '')
        .replace(/[\u0000-\u001F]/g, '')
        .replace(/\s+$/g, '')
        .replace(/^\.+$/g, '');
    if (!base || base === '.' || base === '..') {
        base = 'phrase';
    }

    if (!targetDir || !fs.existsSync(targetDir)) {
        return base;
    }

    const files = fs.readdirSync(targetDir, { withFileTypes: true })
        .filter((entry) => entry.isFile())
        .map((entry) => entry.name);

    const hasConflict = (candidate) => {
        const lowerCandidate = candidate.toLowerCase();
        return files.some((file) => {
            const lowerFile = file.toLowerCase();
            return (
                lowerFile === `${lowerCandidate}.md` ||
                lowerFile === `${lowerCandidate}.html` ||
                lowerFile.startsWith(`${lowerCandidate}_`)
            );
        });
    };

    if (!hasConflict(base)) {
        return base;
    }

    let index = 2;
    let candidate = `${base} (${index})`;
    while (hasConflict(candidate)) {
        index += 1;
        candidate = `${base} (${index})`;
    }
    return candidate;
}

/**
 * Saves generated content to files.
 * @param {string} phrase - The input phrase (used for filename).
 * @param {Object} content - The JSON object containing markdown and html.
 * @param {Object} options - Additional options.
 * @param {string} options.baseName - Pre-built filename base.
 * @returns {Object} Result paths.
 */
function saveGeneratedFiles(phrase, content, options = {}) {
    const ensured = options.targetDir ? null : ensureTodayDirectory();
    const targetDir = options.targetDir || ensured.targetDir;
    const folderName = options.folderName || ensured.folderName;
    const baseName = options.baseName || buildBaseName(phrase, targetDir);
    const mdPath = path.join(targetDir, `${baseName}.md`);
    const htmlPath = path.join(targetDir, `${baseName}.html`);
    
    fs.writeFileSync(mdPath, content.markdown_content, 'utf-8');
    fs.writeFileSync(htmlPath, content.html_content, 'utf-8');
    const metaPath = path.join(targetDir, `${baseName}.meta.json`);
    const displayPhrase = String(phrase || '').trim();
    const meta = {
        phrase: displayPhrase,
        created_at: new Date().toISOString(),
    };
    fs.writeFileSync(metaPath, JSON.stringify(meta, null, 2), 'utf-8');
    
    return {
        folder: folderName,
        baseName,
        targetDir,
        files: [`${baseName}.md`, `${baseName}.html`],
        absPaths: { md: mdPath, html: htmlPath, meta: metaPath }
    };
}

module.exports = {
    saveGeneratedFiles,
    buildBaseName,
    ensureTodayDirectory,
    ensureFolderDirectory,
    listFoldersWithHtml,
    listHtmlFilesInFolder,
    readFileInFolder,
    deleteRecordFiles,
};
