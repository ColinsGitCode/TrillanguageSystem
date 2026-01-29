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
 * @returns {string} Safe filename base.
 */
function buildBaseName(phrase) {
    const safe = String(phrase || '').replace(/[^a-z0-9]/gi, '_').toLowerCase();
    const base = safe || 'phrase';
    const stamp = new Date()
        .toISOString()
        .replace(/[:]/g, '')
        .replace(/\..*$/, '')
        .replace(/-/g, '')
        .replace('T', '_');
    return `${base}_${stamp}`;
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
    const { targetDir, folderName } = ensureTodayDirectory();
    const baseName = options.baseName || buildBaseName(phrase);
    const mdPath = path.join(targetDir, `${baseName}.md`);
    const htmlPath = path.join(targetDir, `${baseName}.html`);
    
    fs.writeFileSync(mdPath, content.markdown_content, 'utf-8');
    fs.writeFileSync(htmlPath, content.html_content, 'utf-8');
    
    return {
        folder: folderName,
        baseName,
        targetDir,
        files: [`${baseName}.md`, `${baseName}.html`],
        absPaths: { md: mdPath, html: htmlPath }
    };
}

module.exports = { saveGeneratedFiles, buildBaseName };
