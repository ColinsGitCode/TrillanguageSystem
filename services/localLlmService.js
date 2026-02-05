require('dotenv').config();

const LLM_BASE_URL = process.env.LLM_BASE_URL || 'http://localhost:11434/v1'; // Default to Ollama port
const LLM_API_KEY = process.env.LLM_API_KEY || 'EMPTY';
const LLM_MODEL = process.env.LLM_MODEL || 'qwen2.5-coder:latest'; 
const LLM_OCR_MODEL = process.env.LLM_OCR_MODEL || LLM_MODEL;
const LLM_OUTPUT_MODE = (process.env.LLM_OUTPUT_MODE || 'json').toLowerCase();

const MAX_TOKENS = Number(process.env.LLM_MAX_TOKENS || 2048);
const OCR_MAX_TOKENS = Number(process.env.LLM_OCR_MAX_TOKENS || 512);
const TEMPERATURE = Number(process.env.LLM_TEMPERATURE || 0.2);

function parseJsonFromText(rawText) {
  if (!rawText) throw new Error('Empty response text');
  let cleanText = rawText.trim();
  if (cleanText.startsWith('```')) {
    cleanText = cleanText.replace(/^```(json)?/, '').replace(/```$/, '');
  }
  
  // Try to find JSON object if mixed with other text
  const firstBrace = cleanText.indexOf('{');
  const lastBrace = cleanText.lastIndexOf('}');
  if (firstBrace !== -1 && lastBrace === -1) {
      throw new Error('Failed to parse JSON response: output appears truncated. Try reducing prompt size or increasing model context.');
  }
  if (firstBrace !== -1 && lastBrace !== -1) {
      cleanText = cleanText.substring(firstBrace, lastBrace + 1);
  }

  try {
    return JSON.parse(cleanText);
  } catch (error) {
    if (String(error?.message || '').includes('Unexpected end of JSON input')) {
      throw new Error('Failed to parse JSON response: output appears truncated. Try reducing prompt size or increasing model context.');
    }
    console.error('JSON Parse Error:', error);
    console.error('Raw Text:', rawText);
    throw new Error('Failed to parse JSON response: ' + error.message);
  }
}

/**
 * Generate content using Local LLM (OpenAI Compatible)
 * Returns { content: Object, usage: Object }
 */
function extractTokenLimits(errorText) {
  if (!errorText) return null;
  const message = String(errorText);
  const match = message.match(/maximum context length is\s+(\d+)\s+tokens.*request has\s+(\d+)\s+input tokens/i);
  if (match) {
    return { context: Number(match[1]), input: Number(match[2]) };
  }
  return null;
}

async function requestCompletion(prompt, maxTokens, outputMode = 'json') {
  const body = {
    model: LLM_MODEL,
    messages: [{ role: 'user', content: prompt }],
    temperature: TEMPERATURE,
    max_tokens: maxTokens
  };
  if (outputMode === 'json') {
    body.response_format = { type: "json_object" }; // Force JSON if supported (Ollama/vLLM)
  }

  const response = await fetch(`${LLM_BASE_URL}/chat/completions`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${LLM_API_KEY}`
    },
    body: JSON.stringify(body)
  });

  if (!response.ok) {
    const errText = await response.text();
    const error = new Error(`Local LLM Error (${response.status}): ${errText}`);
    error.status = response.status;
    error.raw = errText;
    throw error;
  }

  return response.json();
}

function buildImageUrl(image) {
  if (!image) return null;
  if (/^https?:\/\//i.test(image) || image.startsWith('data:')) return image;
  return `data:image/jpeg;base64,${image}`;
}

function extractTextFromContent(content) {
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) {
    return content.map((part) => part?.text || '').join('');
  }
  return '';
}

async function recognizeImage(base64Image) {
  const imageUrl = buildImageUrl(base64Image);
  if (!imageUrl) throw new Error('No image provided');

  const prompt = 'Transcribe the text in this image exactly as is. Preserve original language and line breaks. No explanations.';

  const response = await fetch(`${LLM_BASE_URL}/chat/completions`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${LLM_API_KEY}`
    },
    body: JSON.stringify({
      model: LLM_OCR_MODEL,
      messages: [
        {
          role: 'user',
          content: [
            { type: 'text', text: prompt },
            { type: 'image_url', image_url: { url: imageUrl } }
          ]
        }
      ],
      temperature: 0,
      max_tokens: OCR_MAX_TOKENS
    })
  });

  if (!response.ok) {
    const errText = await response.text();
    const error = new Error(`Local LLM OCR Error (${response.status}): ${errText}`);
    error.status = response.status;
    error.raw = errText;
    throw error;
  }

  const data = await response.json();
  const content = data?.choices?.[0]?.message?.content;
  return extractTextFromContent(content).trim();
}

async function generateContent(prompt) {
  try {
    console.log(`[Local LLM] Sending request to ${LLM_BASE_URL}...`);

    let maxTokens = MAX_TOKENS;
    let data;

    const outputMode = LLM_OUTPUT_MODE;

    try {
      data = await requestCompletion(prompt, maxTokens, outputMode);
    } catch (error) {
      const limits = error?.status === 400 ? extractTokenLimits(error.raw) : null;
      if (!limits) throw error;

      const available = limits.context - limits.input - 64;
      if (available <= 0) {
        throw new Error('Local LLM Error (400): prompt too large for model context window.');
      }

      maxTokens = Math.max(128, Math.min(maxTokens, available));
      console.warn(`[Local LLM] Retrying with max_tokens=${maxTokens} (context ${limits.context}, input ${limits.input}).`);
      data = await requestCompletion(prompt, maxTokens, outputMode);
    }

    const text = extractTextFromContent(data?.choices?.[0]?.message?.content || '');
    const usage = data.usage;

    console.log('[Local LLM] Response received.');
    console.log('[Local LLM] Usage:', usage);

    if (outputMode === 'markdown') {
      return {
        content: {
          markdown_content: String(text || '').trim(),
          html_content: '',
          audio_tasks: []
        },
        usage: {
          input: usage?.prompt_tokens || 0,
          output: usage?.completion_tokens || 0,
          total: usage?.total_tokens || 0
        }
      };
    }

    const content = parseJsonFromText(text);

    return {
      content,
      usage: {
        input: usage?.prompt_tokens || 0,
        output: usage?.completion_tokens || 0,
        total: usage?.total_tokens || 0
      }
    };

  } catch (error) {
    console.error('[Local LLM] Generation failed:', error);
    throw error;
  }
}

module.exports = { generateContent, recognizeImage };
