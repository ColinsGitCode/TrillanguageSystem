const fs = require('fs');
const path = require('path');

// Inherit the base path from server.js logic (or environment variable)
const RECORDS_PATH = process.env.RECORDS_PATH || '/data/trilingual_records';
// If running locally without docker and without env, fallback to a local desktop path for safety is handled in server.js usually.
// But here we rely on process.env.RECORDS_PATH. 
// In server.js: const baseDir = path.resolve(RECORDS_PATH);
// We will resolve it similarly.

const baseDir = path.resolve(RECORDS_PATH);
const RECORDS_TIMEZONE = process.env.RECORDS_TIMEZONE || process.env.APP_TIMEZONE || process.env.TZ || 'Asia/Shanghai';
let timezoneWarningPrinted = false;

function getTodayFolderName() {
    try {
        const parts = new Intl.DateTimeFormat('en-US', {
            timeZone: RECORDS_TIMEZONE,
            year: 'numeric',
            month: '2-digit',
            day: '2-digit'
        }).formatToParts(new Date());
        const year = parts.find((part) => part.type === 'year')?.value;
        const month = parts.find((part) => part.type === 'month')?.value;
        const day = parts.find((part) => part.type === 'day')?.value;
        if (year && month && day) {
            return `${year}${month}${day}`;
        }
    } catch (err) {
        if (!timezoneWarningPrinted) {
            timezoneWarningPrinted = true;
            console.warn(`[FileManager] Invalid RECORDS_TIMEZONE="${RECORDS_TIMEZONE}", fallback to system local date.`);
        }
    }

    const today = new Date();
    const year = today.getFullYear();
    const month = String(today.getMonth() + 1).padStart(2, '0');
    const day = String(today.getDate()).padStart(2, '0');
    return `${year}${month}${day}`;
}

function resolveFolder(folderName) {
    const safeName = folderName || '';
    const folderPath = path.resolve(path.join(baseDir, safeName));
    if (!folderPath.startsWith(baseDir)) return null;
    if (!fs.existsSync(folderPath) || !fs.statSync(folderPath).isDirectory()) return null;
    return folderPath;
}

function readMetaInfo(metaPath) {
    try {
        if (!fs.existsSync(metaPath)) return null;
        const raw = fs.readFileSync(metaPath, 'utf-8');
        const data = JSON.parse(raw);
        if (!data || typeof data !== 'object') return null;
        return {
            phrase: typeof data.phrase === 'string' ? data.phrase.trim() : '',
            cardType: typeof data.card_type === 'string' ? data.card_type.trim().toLowerCase() : '',
            sourceMode: typeof data.source_mode === 'string' ? data.source_mode.trim().toLowerCase() : ''
        };
    } catch (err) {
        return null;
    }
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

function getDisplayMeta(folderPath, baseName) {
    const metaPath = path.join(folderPath, `${baseName}.meta.json`);
    const meta = readMetaInfo(metaPath);
    const title = meta?.phrase || readMarkdownTitle(path.join(folderPath, `${baseName}.md`)) || baseName;
    const cardType = meta?.cardType === 'grammar_ja' ? 'grammar_ja' : 'trilingual';
    return { title, cardType };
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
        const meta = getDisplayMeta(folderPath, baseName);
        return {
            file,
            title: meta.title,
            cardType: meta.cardType
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
    const rawBase = String(baseName || '');
    const trimmedBase = rawBase.trim();
    if (!trimmedBase) throw new Error('Base name required');

    // 兼容历史脏数据：老文件名可能包含前导空格，删除时同时匹配 raw/trimmed。
    const baseVariants = Array.from(new Set([rawBase, trimmedBase].filter(Boolean)));
    const candidates = new Set();
    baseVariants.forEach((base) => {
        candidates.add(`${base}.md`);
        candidates.add(`${base}.html`);
        candidates.add(`${base}.meta.json`);
    });

    const audioRegexes = baseVariants.map(
        (base) => new RegExp(`^${escapeRegex(base)}_[\\w-]+\\.(wav|mp3|m4a)$`, 'i')
    );
    const files = fs.readdirSync(folderPath, { withFileTypes: true })
        .filter((entry) => entry.isFile())
        .map((entry) => entry.name);

    const deleted = [];
    for (const name of files) {
        if (candidates.has(name) || audioRegexes.some((re) => re.test(name))) {
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
    const folderName = getTodayFolderName();
    
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
        .trim()
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
    const cardType = String(options.cardType || 'trilingual').toLowerCase() === 'grammar_ja'
        ? 'grammar_ja'
        : 'trilingual';
    const sourceMode = String(options.sourceMode || '').trim().toLowerCase();
    const meta = {
        phrase: displayPhrase,
        created_at: new Date().toISOString(),
        card_type: cardType,
        source_mode: sourceMode || null
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
