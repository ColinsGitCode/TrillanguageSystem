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
    if (looksLikeGateway18888(apiUrl)) {
      // Gateway may not expose /admin/reset; only call executor reset explicitly.
      return '';
    }
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
  return isTimeoutLikeError(text) || /Gemini proxy error \(5\d\d\)|fetch failed|Network is unreachable|EHOSTUNREACH|ECONNREFUSED|ENETUNREACH/i.test(text);
}

function maybeTrim(value) {
  const text = String(value ?? '').trim();
  return text || '';
}

function looksLikeGateway18888(url) {
  try {
    const parsed = new URL(url);
    return parsed.port === '18888';
  } catch (err) {
    return false;
  }
}

function rewriteHost(url, newHost) {
  try {
    const parsed = new URL(url);
    parsed.hostname = newHost;
    return parsed.toString();
  } catch (err) {
    return url;
  }
}

function buildUrlCandidates(url, options = {}) {
  const candidates = [url];
  const preferIpv4 = parseBoolean(options.preferIpv4 ?? process.env.GEMINI_PROXY_PREFER_IPV4, true);
  if (!preferIpv4) return candidates;

  try {
    const parsed = new URL(url);
    const host = (parsed.hostname || '').trim().toLowerCase();
    if (!['host.docker.internal', 'docker-host-gateway'].includes(host)) {
      return candidates;
    }
    const fallbackHost = maybeTrim(options.ipv4FallbackHost || process.env.GEMINI_PROXY_IPV4_FALLBACK || '192.168.65.254');
    if (!fallbackHost) return candidates;
    const fallbackUrl = rewriteHost(url, fallbackHost);
    if (fallbackUrl && fallbackUrl !== url) {
      candidates.push(fallbackUrl);
    }
  } catch (err) {
    return candidates;
  }

  return candidates;
}

function buildAuthHeaders(options = {}) {
  const authMode = maybeTrim(options.authMode || process.env.GEMINI_PROXY_AUTH_MODE || 'apikey').toLowerCase();
  const apiKey = maybeTrim(options.apiKey || process.env.GEMINI_PROXY_API_KEY || process.env.GATEWAY_API_KEY);
  const token = maybeTrim(options.bearerToken || process.env.GEMINI_PROXY_BEARER_TOKEN || apiKey);
  const sourceApp = maybeTrim(options.sourceApp || process.env.GEMINI_PROXY_SOURCE_APP);
  const sourceEnv = maybeTrim(options.sourceEnv || process.env.GEMINI_PROXY_SOURCE_ENV);
  const headers = { 'Content-Type': 'application/json' };

  if (authMode === 'bearer') {
    if (token) headers.Authorization = `Bearer ${token}`;
  } else if (apiKey) {
    headers['X-API-Key'] = apiKey;
  }

  if (sourceApp) headers['X-Source-App'] = sourceApp;
  if (sourceEnv) headers['X-Source-Env'] = sourceEnv;
  return headers;
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

async function runOnce(url, payload, timeoutMs, headers) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers,
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
  const url = options.url || process.env.GEMINI_PROXY_URL || 'http://host.docker.internal:18888/api/gemini';
  const urlCandidates = buildUrlCandidates(url, options);
  const payload = { prompt, baseName: options.baseName || 'suggestion' };
  const model = options.model || '';
  if (String(model || '').trim()) {
    payload.model = String(model).trim();
  }
  const project = maybeTrim(options.project || process.env.GEMINI_PROXY_PROJECT || process.env.GEMINI_PROXY_SOURCE_APP);
  if (project) {
    payload.project = project;
  }
  const timeoutMs = toNumberOr(options.timeoutMs ?? process.env.GEMINI_PROXY_REQUEST_TIMEOUT_MS, 120000);
  payload.timeoutMs = timeoutMs;
  const executionTimeoutMs = toNumberOr(options.executionTimeoutMs ?? process.env.GEMINI_PROXY_EXECUTION_TIMEOUT_MS, 0);
  const paramPolicy = maybeTrim(options.paramPolicy || process.env.GEMINI_PROXY_PARAM_POLICY || 'strict').toLowerCase();
  if (executionTimeoutMs > 0 || (paramPolicy && paramPolicy !== 'strict')) {
    payload.paramPolicy = paramPolicy || 'strict';
    payload.params = {};
    if (executionTimeoutMs > 0) payload.params.executionTimeoutMs = executionTimeoutMs;
  }

  const retries = toNumberOr(options.retries ?? process.env.GEMINI_PROXY_RETRIES, 1);
  const retryDelayMs = toNumberOr(process.env.GEMINI_PROXY_RETRY_DELAY_MS, 1200);
  const resetOnTimeout = parseBoolean(options.resetOnTimeout ?? process.env.GEMINI_PROXY_AUTO_RESET, true);
  const enforceGateway = parseBoolean(options.enforceGateway ?? process.env.GEMINI_PROXY_ENFORCE_GATEWAY, true);
  const resetUrl = options.resetUrl || process.env.GEMINI_PROXY_RESET_URL || buildResetUrl(url);
  const headers = buildAuthHeaders(options);

  if (enforceGateway && !looksLikeGateway18888(url)) {
    throw new Error(`Invalid GEMINI_PROXY_URL for unified mode: ${url}. Expected Gateway endpoint on :18888.`);
  }

  if (looksLikeGateway18888(url) && !headers['X-API-Key'] && !headers.Authorization) {
    throw new Error('Gemini gateway on :18888 requires auth. Set GEMINI_PROXY_API_KEY or GEMINI_PROXY_BEARER_TOKEN');
  }

  let lastError = null;
  const attempts = Math.max(1, retries + 1);
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    for (let i = 0; i < urlCandidates.length; i += 1) {
      const candidateUrl = urlCandidates[i];
      const hasFallback = i < urlCandidates.length - 1;
      try {
        return await runOnce(candidateUrl, payload, timeoutMs, headers);
      } catch (error) {
        lastError = error;
        const isNetworkError = /fetch failed|Network is unreachable|EHOSTUNREACH|ECONNREFUSED|ENETUNREACH/i.test(String(error?.message || ''));
        if (hasFallback && isNetworkError) {
          console.warn('[GeminiProxy] primary url failed, trying fallback:', { primary: candidateUrl, fallback: urlCandidates[i + 1], error: error.message });
          continue;
        }

        const retriable = isRetriableError(error.message);
        if (!retriable || attempt >= attempts) {
          i = urlCandidates.length; // break candidate loop
          break;
        }

        if (isTimeoutLikeError(error.message) && resetOnTimeout) {
          const resetResult = await triggerReset(resetUrl);
          console.warn('[GeminiProxy] timeout detected, reset requested:', resetResult);
        }

        await sleep(retryDelayMs * attempt);
        i = urlCandidates.length; // go next attempt
      }
    }
  }

  throw new Error(`Gemini proxy failed after ${attempts} attempt(s): ${lastError?.message || 'unknown error'}`);
}

module.exports = { runGeminiProxy };
