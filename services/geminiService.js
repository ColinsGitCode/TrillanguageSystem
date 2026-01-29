require('dotenv').config();

const BASE_URL = process.env.LLM_BASE_URL || process.env.OPENAI_BASE_URL || 'http://10.48.3.40:15800/v1';
const API_KEY = process.env.LLM_API_KEY || process.env.OPENAI_API_KEY || 'EMPTY';
const MODEL_NAME = process.env.LLM_MODEL || process.env.OPENAI_MODEL || 'qwen2_5_vl';
const MAX_TOKENS = Number(process.env.LLM_MAX_TOKENS || 2048);

function buildUrl(pathname) {
    const base = BASE_URL.endsWith('/') ? BASE_URL : `${BASE_URL}/`;
    const target = pathname.replace(/^\//, '');
    return new URL(target, base).toString();
}

function extractContent(data) {
    const message = data?.choices?.[0]?.message;
    const content = message?.content;
    if (Array.isArray(content)) {
        return content
            .map((part) => {
                if (typeof part === 'string') return part;
                if (part && typeof part === 'object') {
                    if (typeof part.text === 'string') return part.text;
                }
                return '';
            })
            .join('');
    }
    if (typeof content === 'string') return content;
    if (content && typeof content === 'object' && typeof content.text === 'string') {
        return content.text;
    }
  return '';
}

function parseJsonFromText(rawText) {
    if (!rawText || typeof rawText !== 'string') {
        throw new Error('LLM response missing text');
    }

    const escapeControlCharsInStrings = (input) => {
        let out = '';
        let inString = false;
        let escaped = false;
        for (let i = 0; i < input.length; i += 1) {
            const ch = input[i];
            if (escaped) {
                out += ch;
                escaped = false;
                continue;
            }
            if (ch === '\\\\') {
                out += ch;
                if (inString) {
                    escaped = true;
                }
                continue;
            }
            if (ch === '"') {
                inString = !inString;
                out += ch;
                continue;
            }
            if (inString) {
                if (ch === '\n') {
                    out += '\\\\n';
                    continue;
                }
                if (ch === '\r') {
                    out += '\\\\r';
                    continue;
                }
                if (ch === '\t') {
                    out += '\\\\t';
                    continue;
                }
            }
            out += ch;
        }
        return out;
    };

    const trimmed = rawText.trim();
    try {
        return JSON.parse(trimmed);
    } catch (_) {
        // try to strip markdown fences
        const fenceMatch = trimmed.match(/```(?:json)?\s*([\s\S]*?)\s*```/i);
        if (fenceMatch && fenceMatch[1]) {
            const fenced = fenceMatch[1].trim();
            try {
                return JSON.parse(fenced);
            } catch (_) {
                try {
                    return JSON.parse(escapeControlCharsInStrings(fenced));
                } catch (_) {
                    // fallthrough
                }
            }
        }
        // try to extract the first JSON object
        const start = trimmed.indexOf('{');
        const end = trimmed.lastIndexOf('}');
        if (start >= 0 && end > start) {
            const candidate = trimmed.slice(start, end + 1);
            try {
                return JSON.parse(candidate);
            } catch (_) {
                return JSON.parse(escapeControlCharsInStrings(candidate));
            }
        }
        throw new Error('LLM response is not valid JSON');
    }
}

/**
 * Calls Gemini API to generate content based on the prompt.
 * @param {string} prompt - The constructed prompt.
 * @returns {Promise<Object>} The parsed JSON response from Gemini.
 */
async function generateContent(prompt) {
    try {
        const headers = {
            'Content-Type': 'application/json',
        };
        if (API_KEY) {
            headers.Authorization = `Bearer ${API_KEY}`;
        }

        const response = await fetch(buildUrl('/chat/completions'), {
            method: 'POST',
            headers,
            body: JSON.stringify({
                model: MODEL_NAME,
                messages: [
                    { role: 'user', content: prompt },
                ],
                temperature: 0.2,
                max_tokens: Number.isFinite(MAX_TOKENS) ? MAX_TOKENS : 2048,
            }),
        });

        const data = await response.json().catch(() => ({}));
        if (!response.ok) {
            const message = data?.error?.message || response.statusText;
            throw new Error(`LLM request failed: ${response.status} ${message}`.trim());
        }

        const text = extractContent(data);
        if (!text) {
            throw new Error('LLM response missing content');
        }

        return parseJsonFromText(text);
    } catch (error) {
        console.error("LLM API Error:", error);
        throw new Error("Failed to generate content from LLM.");
    }
}

/**
 * Recognizes text from an image using multimodal LLM.
 * @param {string} base64Image - Base64 encoded image (data:image/xxx;base64,...)
 * @returns {Promise<string>} The recognized text.
 */
async function recognizeImage(base64Image) {
    try {
        const headers = {
            'Content-Type': 'application/json',
        };
        if (API_KEY) {
            headers.Authorization = `Bearer ${API_KEY}`;
        }

        const response = await fetch(buildUrl('/chat/completions'), {
            method: 'POST',
            headers,
            body: JSON.stringify({
                model: MODEL_NAME,
                messages: [{
                    role: 'user',
                    content: [
                        {
                            type: 'text',
                            text: '请识别图片中的文字内容。只返回识别出的原文，不要翻译、解释或添加任何其他内容。如果有多行文字，保持原有的换行格式。'
                        },
                        {
                            type: 'image_url',
                            image_url: { url: base64Image }
                        }
                    ]
                }],
                max_tokens: 512,
                temperature: 0.1,
            }),
        });

        const data = await response.json().catch(() => ({}));
        if (!response.ok) {
            const message = data?.error?.message || response.statusText;
            throw new Error(`OCR request failed: ${response.status} ${message}`.trim());
        }

        const text = extractContent(data);
        if (!text) {
            throw new Error('OCR response missing content');
        }

        return text.trim();
    } catch (error) {
        console.error("OCR API Error:", error);
        throw new Error("Failed to recognize image text.");
    }
}

module.exports = { generateContent, recognizeImage };
