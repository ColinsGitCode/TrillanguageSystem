const fs = require('fs');
const path = require('path');

const PROMPT_MARKDOWN_PATH = path.join(__dirname, '../codex_prompt/phrase_3LANS_markdown.md');
const PROMPT_HTML_PATH = path.join(__dirname, '../codex_prompt/phrase_3LANS_html.md');

/**
 * Reads the Prompt template and injects arguments.
 * 
 * @param {Object} args - Key-value pairs to replace in the template (e.g., { phrase: "..." })
 * @returns {string} The formatted prompt string.
 */
function buildPrompt(args) {
    if (!fs.existsSync(PROMPT_MARKDOWN_PATH)) {
        throw new Error(`Prompt template not found at ${PROMPT_MARKDOWN_PATH}`);
    }
    if (!fs.existsSync(PROMPT_HTML_PATH)) {
        throw new Error(`Prompt template not found at ${PROMPT_HTML_PATH}`);
    }

    const markdownTemplate = fs.readFileSync(PROMPT_MARKDOWN_PATH, 'utf-8');
    const htmlTemplate = fs.readFileSync(PROMPT_HTML_PATH, 'utf-8');
    let template = `${markdownTemplate}\n\n${htmlTemplate}`;

    // 1. Inject Arguments
    // The template uses specific logic, but here we append a strict JSON output instruction
    // to ensure the AI returns data we can parse programmatically.
    
    const phrase = args.phrase || '';
    const filenameBase = args.filenameBase || '';
    
    // Replace any {{ phrase }} placeholder in templates.
    if (phrase) {
        template = template.replace(/{{\s*phrase\s*}}/g, phrase);
    }

    const systemInstruction = `
    
    ---
    **SYSTEM EXECUTION INSTRUCTION**
    
    Current Task: Generate content for the phrase: "${phrase}".
    Base filename to use for all generated assets: "${filenameBase}".
    
    CRITICAL OUTPUT FORMAT REQUIREMENT:
    You MUST return ONLY a valid JSON object. Do not include markdown code blocks (like \`\`\`json) or any other text.
    The JSON structure must be:
    {
      "markdown_content": "The full markdown content as per rules...",
      "audio_tasks": [
        { "text": "English sentence 1", "lang": "en", "filename_suffix": "_en_1" },
        { "text": "Japanese sentence 1", "lang": "ja", "filename_suffix": "_ja_1" }
        // ... include all examples
      ]
    }
    audio_tasks is optional. If omitted, it will be derived from markdown_content.

    Security constraints:
    - Do NOT include <script>, <iframe>, <object>, or <embed> tags.
    - Do NOT reference external JS/CSS/fonts. Use inline CSS only.

    The markdown_content value must be a valid JSON string (escape any quotes and newlines).
    `;

    return template + systemInstruction;
}

module.exports = { buildPrompt };
