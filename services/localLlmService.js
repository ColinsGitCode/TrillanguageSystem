require('dotenv').config();

/**
 * 本地 LLM 服务 - 支持 OpenAI 兼容的本地模型（如 Qwen）
 */

// ========== 本地 LLM 配置 ==========
const LLM_BASE_URL = process.env.LLM_BASE_URL || 'http://localhost:15800/v1';
const LLM_API_KEY = process.env.LLM_API_KEY || 'EMPTY';
const LLM_MODEL = process.env.LLM_MODEL || 'qwen2_5_vl';

// 共享配置
const MAX_TOKENS = Number(process.env.LLM_MAX_TOKENS || 2048);
const TEMPERATURE = Number(process.env.LLM_TEMPERATURE || 0.2);

/**
 * 从文本中解析 JSON（支持 markdown 代码块）
 * 与 geminiService.js 的实现保持一致
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
 * 调用本地 LLM API 生成内容（OpenAI 兼容格式）
 * @param {string} prompt - 构建好的提示词
 * @returns {Promise<Object>} 解析后的 JSON 响应
 */
async function generateContent(prompt) {
  if (!LLM_BASE_URL) {
    throw new Error('LLM_BASE_URL is not configured. Please set it in .env file.');
  }

  try {
    const url = `${LLM_BASE_URL}/chat/completions`;

    // OpenAI 兼容格式
    const requestBody = {
      model: LLM_MODEL,
      messages: [
        {
          role: 'user',
          content: prompt
        }
      ],
      temperature: TEMPERATURE,
      max_tokens: MAX_TOKENS,
      stream: false
    };

    console.log('[Local LLM] Sending request to:', url);

    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${LLM_API_KEY}`
      },
      body: JSON.stringify(requestBody),
    });

    const data = await response.json().catch(() => ({}));

    if (!response.ok) {
      const errorMsg = data?.error?.message || response.statusText;
      console.error('[Local LLM] API Error:', data);
      throw new Error(`Local LLM API request failed: ${response.status} ${errorMsg}`.trim());
    }

    // 提取文本内容（OpenAI 格式）
    const text = data?.choices?.[0]?.message?.content;

    if (!text) {
      throw new Error('No content in response');
    }

    console.log('[Local LLM] Response received, length:', text.length);

    // 解析 JSON
    return parseJsonFromText(text);

  } catch (error) {
    console.error('[Local LLM] Error:', error);
    throw new Error(`Failed to generate content from Local LLM: ${error.message}`);
  }
}

/**
 * 使用本地 LLM 识别图片（如果支持 vision）
 * @param {string} base64Image - Base64 编码的图片（data:image/xxx;base64,...）
 * @returns {Promise<string>} 识别出的文字
 */
async function recognizeImage(base64Image) {
  // 检查模型是否支持 vision
  if (!LLM_MODEL.includes('vl')) {
    throw new Error('Local LLM does not support image recognition. Please use Gemini API or a vision-capable model.');
  }

  try {
    const url = `${LLM_BASE_URL}/chat/completions`;

    // OpenAI Vision API 格式
    const requestBody = {
      model: LLM_MODEL,
      messages: [
        {
          role: 'user',
          content: [
            {
              type: 'text',
              text: `Please extract ALL text from the image accurately. Requirements:
- Preserve the original language (Chinese/English/Japanese)
- Maintain line breaks and formatting
- Return ONLY the extracted text, no explanations
- If no text is found, return "NO_TEXT_FOUND"`
            },
            {
              type: 'image_url',
              image_url: {
                url: base64Image
              }
            }
          ]
        }
      ],
      temperature: 0.1,
      max_tokens: 1024
    };

    console.log('[Local LLM OCR] Sending image recognition request...');

    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${LLM_API_KEY}`
      },
      body: JSON.stringify(requestBody),
    });

    const data = await response.json().catch(() => ({}));

    if (!response.ok) {
      const errorMsg = data?.error?.message || response.statusText;
      throw new Error(`Local LLM OCR failed: ${response.status} ${errorMsg}`);
    }

    const text = data?.choices?.[0]?.message?.content || '';

    if (!text || text.trim() === 'NO_TEXT_FOUND') {
      throw new Error('No text found in image');
    }

    console.log('[Local LLM OCR] Recognized text length:', text.length);
    return text.trim();

  } catch (error) {
    console.error('[Local LLM OCR] Error:', error);
    throw new Error(`Failed to recognize image: ${error.message}`);
  }
}

module.exports = { generateContent, recognizeImage };
