require('dotenv').config();

// ========== Gemini API 配置 ==========
const GEMINI_API_KEY = process.env.GEMINI_API_KEY || '';
const GEMINI_MODEL = process.env.GEMINI_MODEL || 'gemini-1.5-flash-latest';
const GEMINI_BASE_URL = process.env.GEMINI_BASE_URL || 'https://generativelanguage.googleapis.com/v1beta';

// ========== 备用配置（已封存，保留供参考） ==========
// const QWEN_BASE_URL = process.env.LLM_BASE_URL || 'http://10.48.3.40:15800/v1';
// const QWEN_API_KEY = process.env.LLM_API_KEY || 'EMPTY';
// const QWEN_MODEL = process.env.LLM_MODEL || 'qwen2_5_vl';

const MAX_TOKENS = Number(process.env.LLM_MAX_TOKENS || 2048);
const TEMPERATURE = Number(process.env.LLM_TEMPERATURE || 0.2);

/**
 * 构建 Gemini API URL
 * @param {string} endpoint - API 端点（如 'generateContent'）
 * @returns {string} 完整的 URL
 */
function buildGeminiUrl(endpoint) {
    const baseUrl = GEMINI_BASE_URL.endsWith('/') ? GEMINI_BASE_URL.slice(0, -1) : GEMINI_BASE_URL;
    return `${baseUrl}/models/${GEMINI_MODEL}:${endpoint}?key=${GEMINI_API_KEY}`;
}

/**
 * 从 Gemini 响应中提取文本内容
 * @param {Object} data - Gemini API 响应数据
 * @returns {string} 提取的文本
 */
function extractGeminiContent(data) {
    try {
        // Gemini 响应结构: { candidates: [{ content: { parts: [{ text: "..." }] } }] }
        const candidate = data?.candidates?.[0];
        if (!candidate) {
            throw new Error('No candidate in response');
        }

        const parts = candidate?.content?.parts;
        if (!Array.isArray(parts)) {
            throw new Error('Invalid response structure');
        }

        // 合并所有文本部分
        const text = parts
            .filter(part => part.text)
            .map(part => part.text)
            .join('');

        if (!text) {
            throw new Error('No text content in response');
        }

        return text;
    } catch (error) {
        console.error('[Gemini] Content extraction error:', error);
        throw new Error('Failed to extract content from Gemini response');
    }
}

/**
 * 从文本中解析 JSON（支持 markdown 代码块）
 * @param {string} rawText - 原始文本
 * @returns {Object} 解析后的 JSON 对象
 */
function parseJsonFromText(rawText) {
    if (!rawText || typeof rawText !== 'string') {
        throw new Error('LLM response missing text');
    }

    // 转义字符串内的控制字符
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
            if (ch === '\\') {
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
                    out += '\\n';
                    continue;
                }
                if (ch === '\r') {
                    out += '\\r';
                    continue;
                }
                if (ch === '\t') {
                    out += '\\t';
                    continue;
                }
            }
            out += ch;
        }
        return out;
    };

    const trimmed = rawText.trim();

    // 尝试直接解析
    try {
        return JSON.parse(trimmed);
    } catch (_) {
        // 尝试提取 markdown 代码块
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

        // 尝试提取第一个 JSON 对象
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
 * 调用 Gemini API 生成内容
 * @param {string} prompt - 构建好的提示词
 * @returns {Promise<Object>} 解析后的 JSON 响应
 */
async function generateContent(prompt) {
    if (!GEMINI_API_KEY) {
        throw new Error('GEMINI_API_KEY is not configured. Please set it in .env file.');
    }

    try {
        const url = buildGeminiUrl('generateContent');

        // Gemini API 请求体格式
        const requestBody = {
            contents: [
                {
                    parts: [
                        {
                            text: prompt
                        }
                    ]
                }
            ],
            generationConfig: {
                temperature: TEMPERATURE,
                maxOutputTokens: MAX_TOKENS,
                topP: 0.95,
                topK: 40
            },
            safetySettings: [
                {
                    category: 'HARM_CATEGORY_HATE_SPEECH',
                    threshold: 'BLOCK_NONE'
                },
                {
                    category: 'HARM_CATEGORY_SEXUALLY_EXPLICIT',
                    threshold: 'BLOCK_NONE'
                },
                {
                    category: 'HARM_CATEGORY_DANGEROUS_CONTENT',
                    threshold: 'BLOCK_NONE'
                },
                {
                    category: 'HARM_CATEGORY_HARASSMENT',
                    threshold: 'BLOCK_NONE'
                }
            ]
        };

        console.log('[Gemini] Sending request to:', GEMINI_MODEL);

        const response = await fetch(url, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify(requestBody),
        });

        const data = await response.json().catch(() => ({}));

        if (!response.ok) {
            const errorMsg = data?.error?.message || response.statusText;
            console.error('[Gemini] API Error:', data);
            throw new Error(`Gemini API request failed: ${response.status} ${errorMsg}`.trim());
        }

        // 提取文本内容
        const text = extractGeminiContent(data);

        console.log('[Gemini] Response received, length:', text.length);

        // 解析 JSON
        return parseJsonFromText(text);

    } catch (error) {
        console.error('[Gemini] API Error:', error);
        throw new Error(`Failed to generate content from Gemini: ${error.message}`);
    }
}

/**
 * 使用 Gemini 识别图片中的文字（OCR）
 * @param {string} base64Image - Base64 编码的图片（data:image/xxx;base64,...）
 * @returns {Promise<string>} 识别出的文字
 */
async function recognizeImage(base64Image) {
    if (!GEMINI_API_KEY) {
        throw new Error('GEMINI_API_KEY is not configured. Please set it in .env file.');
    }

    try {
        // 提取 MIME 类型和 base64 数据
        const matches = base64Image.match(/^data:(image\/[a-z]+);base64,(.+)$/i);
        if (!matches) {
            throw new Error('Invalid base64 image format');
        }

        const mimeType = matches[1];
        const imageData = matches[2];

        const url = buildGeminiUrl('generateContent');

        // Gemini 图片识别请求格式
        const requestBody = {
            contents: [
                {
                    parts: [
                        {
                            text: `Please extract ALL text from the image accurately. Requirements:
- Preserve the original language (Chinese/English/Japanese)
- Maintain line breaks and formatting
- Return ONLY the extracted text, no explanations
- If no text is found, return "NO_TEXT_FOUND"`
                        },
                        {
                            inlineData: {
                                mimeType: mimeType,
                                data: imageData
                            }
                        }
                    ]
                }
            ],
            generationConfig: {
                temperature: 0.1,
                maxOutputTokens: 1024,
                topP: 0.95,
                topK: 40
            }
        };

        console.log('[Gemini OCR] Sending image recognition request...');

        const response = await fetch(url, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify(requestBody),
        });

        const data = await response.json().catch(() => ({}));

        if (!response.ok) {
            const errorMsg = data?.error?.message || response.statusText;
            console.error('[Gemini OCR] API Error:', data);
            throw new Error(`Gemini OCR request failed: ${response.status} ${errorMsg}`.trim());
        }

        // 提取文本内容
        const text = extractGeminiContent(data);

        if (!text || text.trim() === 'NO_TEXT_FOUND') {
            throw new Error('No text found in image');
        }

        console.log('[Gemini OCR] Recognized text length:', text.length);

        return text.trim();

    } catch (error) {
        console.error('[Gemini OCR] Error:', error);
        throw new Error(`Failed to recognize image text: ${error.message}`);
    }
}

module.exports = { generateContent, recognizeImage };
