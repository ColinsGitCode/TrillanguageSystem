const fs = require('fs');
const path = require('path');
require('dotenv').config();
const { normalizeAudioExtension } = require('./audioFormat');

const EN_TTS_ENDPOINT = process.env.TTS_EN_ENDPOINT || process.env.TTS_API_ENDPOINT;
const JA_TTS_ENDPOINT = process.env.TTS_JA_ENDPOINT || process.env.TTS_API_ENDPOINT;
const JA_SBV2_ENDPOINT = process.env.TTS_JA_SBV2_ENDPOINT || '';
const EN_TTS_TYPE = (process.env.TTS_EN_TYPE || 'piper').toLowerCase();
const JA_TTS_TYPE = (process.env.TTS_JA_TYPE || 'voicevox').toLowerCase();

const EN_TTS_MODEL = process.env.TTS_EN_MODEL || process.env.OPENAI_TTS_MODEL || 'hexgrad/Kokoro-82M';
const EN_TTS_API_KEY = process.env.TTS_EN_API_KEY || process.env.OPENAI_API_KEY || '';
const JA_SBV2_MODEL_ID = process.env.TTS_JA_SBV2_MODEL_ID || '';
const JA_SBV2_MODEL_NAME = process.env.TTS_JA_SBV2_MODEL_NAME || '';
const JA_SBV2_SPEAKER_ID = process.env.TTS_JA_SBV2_SPEAKER_ID || '';
const JA_SBV2_SPEAKER_NAME = process.env.TTS_JA_SBV2_SPEAKER_NAME || '';
const JA_SBV2_STYLE = process.env.TTS_JA_SBV2_STYLE || '';

const EN_DEFAULT_VOICE = process.env.TTS_EN_VOICE || process.env.PIPER_VOICE || '';
const EN_DEFAULT_SPEED = Number(process.env.TTS_EN_SPEED || process.env.PIPER_SPEED || 1.0);
const JA_DEFAULT_SPEAKER = Number(process.env.VOICEVOX_SPEAKER || process.env.TTS_JA_SPEAKER || 2);

function sanitizeSuffix(value) {
  const raw = String(value || '');
  const cleaned = raw.replace(/[^a-z0-9_-]/gi, '_');
  return cleaned.startsWith('_') ? cleaned : `_${cleaned}`;
}

function resolveAudioFilename(baseName, suffix, extension = 'wav') {
  const safeSuffix = sanitizeSuffix(suffix);
  return `${baseName}${safeSuffix}.${extension}`;
}

function resolveOpenAiSpeechEndpoint() {
  if (!EN_TTS_ENDPOINT) {
    throw new Error('TTS_EN_ENDPOINT 未配置');
  }
  const trimmed = EN_TTS_ENDPOINT.trim();
  if (/\/v1\/audio\/speech\/?$/.test(trimmed)) {
    return trimmed;
  }
  return `${trimmed.replace(/\/$/, '')}/v1/audio/speech`;
}

async function requestPiperAudio(task) {
  if (!EN_TTS_ENDPOINT) {
    throw new Error('TTS_EN_ENDPOINT 未配置');
  }

  const payload = {
    text: task.text,
    speed: task.speed || EN_DEFAULT_SPEED,
  };

  if (task.voice || EN_DEFAULT_VOICE) {
    payload.voice = task.voice || EN_DEFAULT_VOICE;
  }

  const response = await fetch(EN_TTS_ENDPOINT, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });

  if (!response.ok) {
    const errText = await response.text().catch(() => '');
    throw new Error(`Piper 请求失败: ${response.status} ${errText}`.trim());
  }

  const buffer = Buffer.from(await response.arrayBuffer());
  return {
    buffer,
    contentType: response.headers.get('content-type'),
    ttsProvider: 'piper',
    ttsModel: EN_TTS_MODEL,
    ttsVoice: payload.voice || null,
    status: 'generated',
  };
}

async function requestOpenAiSpeechAudio(task) {
  const endpoint = resolveOpenAiSpeechEndpoint();
  const responseFormat = normalizeAudioExtension(task.response_format || task.extension, 'en');
  const model = task.model || EN_TTS_MODEL;
  const voice = task.voice || EN_DEFAULT_VOICE || 'af_bella';
  const payload = {
    model,
    input: task.text,
    voice,
    response_format: responseFormat,
    speed: task.speed || EN_DEFAULT_SPEED,
  };

  const headers = { 'Content-Type': 'application/json' };
  if (EN_TTS_API_KEY && EN_TTS_API_KEY !== 'EMPTY') {
    headers.Authorization = `Bearer ${EN_TTS_API_KEY}`;
  }

  const response = await fetch(endpoint, {
    method: 'POST',
    headers,
    body: JSON.stringify(payload),
  });

  if (!response.ok) {
    const errText = await response.text().catch(() => '');
    throw new Error(`Kokoro 请求失败: ${response.status} ${errText}`.trim());
  }

  const buffer = Buffer.from(await response.arrayBuffer());
  return {
    buffer,
    contentType: response.headers.get('content-type'),
    ttsProvider: EN_TTS_TYPE === 'openai' ? 'openai' : 'kokoro',
    ttsModel: model,
    ttsVoice: voice,
    status: 'generated',
  };
}

async function requestVoicevoxAudio(task) {
  if (!JA_TTS_ENDPOINT) {
    throw new Error('TTS_JA_ENDPOINT 未配置');
  }

  const speaker = Number(task.speaker || task.voice || JA_DEFAULT_SPEAKER);
  const baseUrl = JA_TTS_ENDPOINT.replace(/\/$/, '');
  const queryUrl = new URL(`${baseUrl}/audio_query`);
  queryUrl.searchParams.set('text', task.text);
  queryUrl.searchParams.set('speaker', String(speaker));

  const queryRes = await fetch(queryUrl, { method: 'POST' });
  if (!queryRes.ok) {
    const errText = await queryRes.text().catch(() => '');
    throw new Error(`VOICEVOX audio_query 失败: ${queryRes.status} ${errText}`.trim());
  }

  const queryJson = await queryRes.json();
  const synthUrl = new URL(`${baseUrl}/synthesis`);
  synthUrl.searchParams.set('speaker', String(speaker));

  const synthRes = await fetch(synthUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(queryJson),
  });

  if (!synthRes.ok) {
    const errText = await synthRes.text().catch(() => '');
    throw new Error(`VOICEVOX synthesis 失败: ${synthRes.status} ${errText}`.trim());
  }

  const buffer = Buffer.from(await synthRes.arrayBuffer());
  return {
    buffer,
    contentType: synthRes.headers.get('content-type'),
    ttsProvider: 'voicevox',
    ttsModel: 'voicevox',
    ttsVoice: `speaker:${speaker}`,
    status: 'generated',
  };
}

function addOptionalSearchParam(url, name, value) {
  const normalized = String(value ?? '').trim();
  if (normalized) url.searchParams.set(name, normalized);
}

function resolveStyleBertVits2Voice({ speakerId, speakerName, style }) {
  const parts = [];
  if (String(speakerName || '').trim()) parts.push(`speaker:${String(speakerName).trim()}`);
  else parts.push(`speaker:${String(speakerId || '0').trim() || '0'}`);
  if (String(style || '').trim()) parts.push(`style:${String(style).trim()}`);
  return parts.join(' ');
}

async function requestStyleBertVits2Audio(task) {
  if (!JA_SBV2_ENDPOINT) {
    throw new Error('TTS_JA_SBV2_ENDPOINT 未配置');
  }

  const baseUrl = JA_SBV2_ENDPOINT.replace(/\/$/, '');
  const voiceUrl = new URL(`${baseUrl}/voice`);
  const modelId = task.model_id || task.modelId || JA_SBV2_MODEL_ID || '0';
  const modelName = task.model_name || task.modelName || JA_SBV2_MODEL_NAME;
  const speakerId = task.speaker_id || task.speakerId || task.speaker || JA_SBV2_SPEAKER_ID || '0';
  const speakerName = task.speaker_name || task.speakerName || JA_SBV2_SPEAKER_NAME;
  const style = task.style || JA_SBV2_STYLE;

  voiceUrl.searchParams.set('text', task.text);
  addOptionalSearchParam(voiceUrl, 'model_name', modelName);
  if (!String(modelName || '').trim()) addOptionalSearchParam(voiceUrl, 'model_id', modelId);
  addOptionalSearchParam(voiceUrl, 'speaker_name', speakerName);
  if (!String(speakerName || '').trim()) addOptionalSearchParam(voiceUrl, 'speaker_id', speakerId);
  addOptionalSearchParam(voiceUrl, 'style', style);
  addOptionalSearchParam(voiceUrl, 'language', task.language || 'JP');
  addOptionalSearchParam(voiceUrl, 'length', task.length);

  const response = await fetch(voiceUrl, { method: 'POST' });
  if (!response.ok) {
    const errText = await response.text().catch(() => '');
    throw new Error(`Style-Bert-VITS2 请求失败: ${response.status} ${errText}`.trim());
  }

  const buffer = Buffer.from(await response.arrayBuffer());
  return {
    buffer,
    contentType: response.headers.get('content-type'),
    ttsProvider: 'style_bert_vits2',
    ttsModel: modelName ? `model:${modelName}` : `model:${modelId}`,
    ttsVoice: resolveStyleBertVits2Voice({ speakerId, speakerName, style }),
    status: 'generated',
  };
}

async function requestJapaneseAudio(task) {
  if (JA_TTS_TYPE === 'voicevox') {
    return requestVoicevoxAudio(task);
  }

  if (JA_TTS_TYPE === 'style_bert_vits2' || JA_TTS_TYPE === 'sbv2') {
    try {
      return await requestStyleBertVits2Audio(task);
    } catch (primaryError) {
      if (!JA_TTS_ENDPOINT) throw primaryError;
      const fallback = await requestVoicevoxAudio(task);
      return {
        ...fallback,
        status: 'fallback_generated',
        fallbackFrom: 'style_bert_vits2',
        fallbackReason: primaryError.message || String(primaryError),
      };
    }
  }

  throw new Error(`未支持的日语 TTS 类型: ${JA_TTS_TYPE}`);
}

async function generateAudioBatch(tasks, options) {
  const results = [];
  const errors = [];

  if (!tasks || !tasks.length) {
    return { results, errors };
  }

  const { outputDir, baseName, extension = 'wav' } = options || {};
  if (!outputDir || !baseName) {
    throw new Error('generateAudioBatch 缺少 outputDir 或 baseName');
  }

  for (let i = 0; i < tasks.length; i += 1) {
    const task = tasks[i];
    try {
      let response;
      if (task.lang === 'ja') {
        response = await requestJapaneseAudio(task);
      } else if (task.lang === 'en') {
        if (EN_TTS_TYPE === 'piper') {
          response = await requestPiperAudio(task);
        } else if (EN_TTS_TYPE === 'kokoro' || EN_TTS_TYPE === 'openai') {
          response = await requestOpenAiSpeechAudio(task);
        } else {
          throw new Error(`未支持的英文 TTS 类型: ${EN_TTS_TYPE}`);
        }
      } else {
        throw new Error(`未支持的语言: ${task.lang}`);
      }

      const { buffer, contentType } = response;
      const resolvedExtension = normalizeAudioExtension(task.extension, task.lang) || extension;
      const filename = resolveAudioFilename(baseName, task.filename_suffix, resolvedExtension);
      const filePath = path.join(outputDir, filename);
      fs.writeFileSync(filePath, buffer);
      results.push({
        index: i,
        filename,
        filePath,
        contentType,
        extension: resolvedExtension,
        ttsProvider: response.ttsProvider,
        ttsModel: response.ttsModel,
        ttsVoice: response.ttsVoice,
        status: response.status || 'generated',
      });
    } catch (error) {
      errors.push({
        index: i,
        task,
        message: error.message || String(error),
      });
    }
  }

  return { results, errors };
}

module.exports = { generateAudioBatch };
