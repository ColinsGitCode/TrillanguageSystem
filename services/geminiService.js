// ========================================
// ⚠️ ARCHIVED: Gemini API Integration
// ========================================
// 此模块已封存，不再主动维护
// 原因：转向使用本地LLM（Qwen等开源模型）
// 封存日期：2026-02-03
// 保留原因：作为备用方案和参考实现
// ========================================

const { GoogleGenerativeAI } = require("@google/generative-ai");
require('dotenv').config();

const API_KEY = process.env.GEMINI_API_KEY;
const MODEL_NAME = process.env.GEMINI_MODEL || "gemini-1.5-flash"; // updated default

const genAI = new GoogleGenerativeAI(API_KEY);
const model = genAI.getGenerativeModel({ model: MODEL_NAME });

// Configuration for generation
const GENERATION_CONFIG = {
  maxOutputTokens: Number(process.env.LLM_MAX_TOKENS || 2048),
  temperature: Number(process.env.LLM_TEMPERATURE || 0.2),
  responseMimeType: "application/json", // Force JSON mode
};

console.log('[Gemini Service] Initialized with model:', MODEL_NAME);

/**
 * Clean and parse JSON from text (handling markdown code blocks if present)
 */
function parseJsonFromText(rawText) {
  if (!rawText) throw new Error('Empty response text');
  
  let cleanText = rawText.trim();
  
  // Remove markdown code blocks if present
  if (cleanText.startsWith('```')) {
    cleanText = cleanText.replace(/^```(json)?/, '').replace(/```$/, '');
  }
  
  try {
    return JSON.parse(cleanText);
  } catch (error) {
    console.error('JSON Parse Error:', error);
    console.error('Raw Text:', rawText);
    throw new Error('Failed to parse JSON response: ' + error.message);
  }
}

/**
 * Generate content using Gemini API
 * Returns { content: Object, usage: Object }
 */
async function generateContent(prompt) {
  try {
    console.log('[Gemini] Sending prompt...');
    
    const result = await model.generateContent({
      contents: [{ role: 'user', parts: [{ text: prompt }] }],
      generationConfig: GENERATION_CONFIG,
    });

    const response = await result.response;
    const text = response.text();
    const usage = response.usageMetadata; // Extract usage

    console.log('[Gemini] Response received.');
    console.log('[Gemini] Tokens - Prompt:', usage?.promptTokenCount, 'Candidates:', usage?.candidatesTokenCount);

    const content = parseJsonFromText(text);

    return {
      content,
      usage: {
        input: usage?.promptTokenCount || 0,
        output: usage?.candidatesTokenCount || 0,
        total: usage?.totalTokenCount || 0
      }
    };

  } catch (error) {
    console.error('[Gemini] Generation failed:', error);
    throw error;
  }
}

/**
 * Recognize text from image
 */
async function recognizeImage(base64Image) {
  try {
    let mimeType = "image/jpeg";
    let base64Data = base64Image;

    if (typeof base64Image === 'string' && base64Image.startsWith('data:')) {
      const matches = base64Image.match(/^data:(image\/[a-zA-Z0-9.+-]+);base64,(.+)$/);
      if (matches) {
        mimeType = matches[1];
        base64Data = matches[2];
      } else {
        base64Data = base64Image.replace(/^data:image\/\w+;base64,/, "");
      }
    }
    
    const prompt = "Transcribe the text in this image exactly as is. Preserve original language.";
    
    const result = await model.generateContent([
      prompt,
      {
        inlineData: {
          data: base64Data,
          mimeType,
        },
      },
    ]);
    
    return result.response.text();
  } catch (error) {
    console.error('[Gemini OCR] Failed:', error);
    throw error;
  }
}

module.exports = { generateContent, recognizeImage };
