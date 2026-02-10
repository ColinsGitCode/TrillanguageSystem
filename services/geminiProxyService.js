function toNumberOr(value, fallback) {
  const num = Number(value);
  return Number.isFinite(num) ? num : fallback;
}

function parseBoolean(value, fallback) {
  if (value === undefined || value === null || value === '') return fallback;
  const normalized = String(value).trim().toLowerCase();
  if (normalized === 'true' || normalized === '1' || normalized === 'yes') return true;
  if (normalized === 'false' || normalized === '0' || normalized === 'no') return false;
  return fallback;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function buildResetUrl(apiUrl) {
  try {
    const parsed = new URL(apiUrl);
    parsed.pathname = '/admin/reset';
    parsed.search = '';
    return parsed.toString();
  } catch (err) {
    return '';
  }
}

function isTimeoutLikeError(message) {
  return /timeout|timed out|aborterror|etimedout|gemini cli timeout/i.test(String(message || ''));
}

function isRetriableError(message) {
  const text = String(message || '');
  return isTimeoutLikeError(text) || /Gemini proxy error \(5\d\d\)/.test(text);
}

async function triggerReset(resetUrl) {
  if (!resetUrl) return null;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 8000);
  try {
    const res = await fetch(resetUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      signal: controller.signal
    });
    return { ok: res.ok, status: res.status };
  } catch (err) {
    return { ok: false, error: err.message };
  } finally {
    clearTimeout(timer);
  }
}

async function runOnce(url, payload, timeoutMs) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
      signal: controller.signal
    });

    if (!res.ok) {
      const text = await res.text();
      const detail = String(text || '').trim();
      throw new Error(`Gemini proxy error (${res.status})${detail ? `: ${detail}` : ''}`);
    }
    return res.json();
  } catch (err) {
    if (err?.name === 'AbortError') {
      throw new Error(`Gemini proxy request timeout (${timeoutMs}ms)`);
    }
    throw err;
  } finally {
    clearTimeout(timer);
  }
}

async function runGeminiProxy(prompt, options = {}) {
  const url = options.url || process.env.GEMINI_PROXY_URL || 'http://host.docker.internal:3210/api/gemini';
  const payload = { prompt, baseName: options.baseName || 'suggestion' };
  const model = options.model || '';
  if (String(model || '').trim()) {
    payload.model = String(model).trim();
  }

  const retries = toNumberOr(options.retries ?? process.env.GEMINI_PROXY_RETRIES, 1);
  const timeoutMs = toNumberOr(options.timeoutMs ?? process.env.GEMINI_PROXY_REQUEST_TIMEOUT_MS, 120000);
  const retryDelayMs = toNumberOr(process.env.GEMINI_PROXY_RETRY_DELAY_MS, 1200);
  const resetOnTimeout = parseBoolean(options.resetOnTimeout ?? process.env.GEMINI_PROXY_AUTO_RESET, true);
  const resetUrl = options.resetUrl || process.env.GEMINI_PROXY_RESET_URL || buildResetUrl(url);

  let lastError = null;
  const attempts = Math.max(1, retries + 1);
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      return await runOnce(url, payload, timeoutMs);
    } catch (error) {
      lastError = error;
      const retriable = isRetriableError(error.message);
      if (!retriable || attempt >= attempts) break;

      if (isTimeoutLikeError(error.message) && resetOnTimeout) {
        const resetResult = await triggerReset(resetUrl);
        console.warn('[GeminiProxy] timeout detected, reset requested:', resetResult);
      }

      await sleep(retryDelayMs * attempt);
    }
  }

  throw new Error(`Gemini proxy failed after ${attempts} attempt(s): ${lastError?.message || 'unknown error'}`);
}

module.exports = { runGeminiProxy };
