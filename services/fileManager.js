const fs = require('fs');
const path = require('path');

// Inherit the base path from server.js logic (or environment variable)
const RECORDS_PATH = process.env.RECORDS_PATH || '/data/trilingual_records';
// If running locally without docker and without env, fallback to a local desktop path for safety is handled in server.js usually.
// But here we rely on process.env.RECORDS_PATH. 
// In server.js: const baseDir = path.resolve(RECORDS_PATH);
// We will resolve it similarly.

const baseDir = path.resolve(RECORDS_PATH);

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

module.exports = { saveGeneratedFiles, buildBaseName, ensureTodayDirectory };
