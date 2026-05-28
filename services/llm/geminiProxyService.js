const {
  EXECUTION_BUDGET_MS,
  clampExecutionBudget,
  clientTimeoutFor,
} = require('./geminiTimeouts');
const { CODES, isRetriableCode, errorCodeOf } = require('./geminiErrors');
const log = require('../../lib/logger').child({ module: 'gemini-proxy' });

function toNumberOr(value, fallback) {
  const num = Number(value);
  return Number.isFinite(num) ? num : fallback;
}

function firstFiniteNumber(...values) {
  for (const value of values) {
    const num = Number(value);
    if (Number.isFinite(num) && num > 0) return num;
  }
  return 0;
}

function resolveExecutionBudget(options = {}) {
  const explicitBudget = firstFiniteNumber(options.timeoutMs);
  if (explicitBudget) return explicitBudget;
  // Backward compatibility for deployments that still set the old proxy envs.
  // The old "execution" timeout maps to the new executor budget semantics.
  return firstFiniteNumber(
    process.env.GEMINI_PROXY_EXECUTION_TIMEOUT_MS,
    process.env.GEMINI_EXECUTION_BUDGET_MS,
    process.env.GEMINI_PROXY_REQUEST_TIMEOUT_MS,
    EXECUTION_BUDGET_MS
  );
}

function resolveExecutionTimeout(options = {}) {
  const explicitTimeout = firstFiniteNumber(options.executionTimeoutMs);
  if (explicitTimeout) return explicitTimeout;
  return firstFiniteNumber(process.env.GEMINI_PROXY_EXECUTION_TIMEOUT_MS);
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
  // The gateway forwards /admin/reset to the host executor, so deriving the
  // reset URL from the configured endpoint works for both gateway and direct
  // executor URLs.
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

function isMcpDiagnosticError(message) {
  return /mcp diagnostic detected|mcp issues detected|run\s+\/mcp\s+list\s+for\s+status/i.test(String(message || ''));
}

function isRetriableError(error) {
  // Prefer the structured code carried by chain errors; fall back to message
  // text for network-level failures that never reach a coded layer.
  if (isRetriableCode(errorCodeOf(error))) return true;
  const text = String((error && error.message) || error || '');
  return isTimeoutLikeError(text)
    || isMcpDiagnosticError(text)
    || /Gemini proxy error \(5\d\d\)|fetch failed|Network is unreachable|EHOSTUNREACH|ECONNREFUSED|ENETUNREACH/i.test(text);
}

function maybeTrim(value) {
  const text = String(value ?? '').trim();
  return text || '';
}

function getResponseTextCandidates(response) {
  if (!response || typeof response !== 'object') return [];
  const values = [
    response.markdown,
    response.rawOutput,
    response.output,
    response.text
  ];
  return values
    .filter((value) => typeof value === 'string')
    .map((value) => value.trim())
    .filter(Boolean);
}

function sanitizeMcpDiagnosticText(text) {
  if (typeof text !== 'string') return '';
  const inlinePrefix = /^\s*MCP issues detected\b[\s\S]*?Run\s+\/mcp\s+list\s+for\s+status\.?\s*/i;
  const patterns = [
    /^\s*MCP issues detected\b.*$/i,
    /^\s*Run\s+\/mcp\s+list\s+for\s+status\b.*$/i
  ];
  return String(text)
    .replace(inlinePrefix, '')
    .split(/\r?\n/)
    .filter((line) => !patterns.some((pattern) => pattern.test(line)))
    .join('\n')
    .trim();
}

function sanitizeMcpDiagnosticsInResponse(response) {
  if (!response || typeof response !== 'object') {
    return { response, modified: false };
  }

  let modified = false;
  const next = Array.isArray(response) ? [...response] : { ...response };
  ['markdown', 'rawOutput', 'output', 'text'].forEach((field) => {
    if (typeof next[field] !== 'string') return;
    const cleaned = sanitizeMcpDiagnosticText(next[field]);
    if (cleaned !== next[field].trim()) {
      next[field] = cleaned;
      modified = true;
    }
  });

  return { response: next, modified };
}

function assertNoMcpDiagnosticInResponse(response) {
  const patterns = [
    /MCP issues detected/i,
    /Run\s+\/mcp\s+list\s+for\s+status/i,
    /\/mcp list\b/i
  ];
  const hit = getResponseTextCandidates(response).find((text) => patterns.some((pattern) => pattern.test(text)));
  if (!hit) return;

  const preview = hit.replace(/\s+/g, ' ').slice(0, 160);
  throw new Error(`Gemini proxy MCP diagnostic detected in output: ${preview}`);
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

async function runOnce(url, payload, timeoutMs, headers, options = {}) {
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
      let body = null;
      try {
        body = text ? JSON.parse(text) : null;
      } catch (_) {
        body = null;
      }
      const detail = (body && body.error) || String(text || '').trim();
      const err = new Error(`Gemini proxy error (${res.status})${detail ? `: ${detail}` : ''}`);
      // Preserve the structured status/code/payload so callers (and the job
      // queue) can classify the failure instead of regex-matching the message.
      err.status = res.status;
      err.payload = body || { error: detail, code: '' };
      if (body && body.code) err.code = body.code;
      throw err;
    }
    const json = await res.json();
    const { response: sanitized, modified } = sanitizeMcpDiagnosticsInResponse(json);
    if (modified) {
      const validator = typeof options.validateSanitizedResponse === 'function'
        ? options.validateSanitizedResponse
        : null;
      if (validator && validator(sanitized)) {
        return sanitized;
      }
      assertNoMcpDiagnosticInResponse(json);
    }
    assertNoMcpDiagnosticInResponse(sanitized);
    return sanitized;
  } catch (err) {
    if (err?.name === 'AbortError') {
      const timeoutErr = new Error(`Gemini proxy request timeout (${timeoutMs}ms)`);
      timeoutErr.code = CODES.GATEWAY_TIMEOUT;
      throw timeoutErr;
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
  // Execution budget = how long the gemini CLI may run. The transport layers
  // derive their own (longer) abort deadlines from it via geminiTimeouts, so
  // the executor always times out first and reports a clean, specific error.
  const executionBudget = resolveExecutionBudget(options);
  const executionTimeoutMs = resolveExecutionTimeout(options);
  payload.timeoutMs = clampExecutionBudget(executionBudget);
  if (executionTimeoutMs > 0) {
    payload.executionTimeoutMs = executionTimeoutMs;
  }
  // The client fetch must outlive whatever the executor actually runs.
  const timeoutMs = clientTimeoutFor(Math.max(executionBudget, executionTimeoutMs));
  const paramPolicy = maybeTrim(options.paramPolicy || process.env.GEMINI_PROXY_PARAM_POLICY || 'strict').toLowerCase();
  if (executionTimeoutMs > 0 || (paramPolicy && paramPolicy !== 'strict')) {
    payload.paramPolicy = paramPolicy || 'strict';
    payload.params = {};
    if (executionTimeoutMs > 0) payload.params.executionTimeoutMs = executionTimeoutMs;
  }

  const retries = toNumberOr(options.retries ?? process.env.GEMINI_PROXY_RETRIES, 1);
  const retryDelayMs = toNumberOr(options.retryDelayMs ?? process.env.GEMINI_PROXY_RETRY_DELAY_MS, 1200);
  const resetOnTimeout = parseBoolean(options.resetOnTimeout ?? process.env.GEMINI_PROXY_AUTO_RESET, true);
  const retryOnTimeout = parseBoolean(options.retryOnTimeout ?? process.env.GEMINI_PROXY_RETRY_ON_TIMEOUT, true);
  const enforceGateway = parseBoolean(options.enforceGateway ?? process.env.GEMINI_PROXY_ENFORCE_GATEWAY, true);
  const requireGatewayAuth = parseBoolean(options.requireGatewayAuth ?? process.env.GEMINI_PROXY_REQUIRE_AUTH, true);
  const resetUrl = options.resetUrl || process.env.GEMINI_PROXY_RESET_URL || buildResetUrl(url);
  const headers = buildAuthHeaders(options);

  if (enforceGateway && !looksLikeGateway18888(url)) {
    throw new Error(`Invalid GEMINI_PROXY_URL for unified mode: ${url}. Expected Gateway endpoint on :18888.`);
  }

  if (requireGatewayAuth && looksLikeGateway18888(url) && !headers['X-API-Key'] && !headers.Authorization) {
    throw new Error('Gemini gateway on :18888 requires auth. Set GEMINI_PROXY_API_KEY or GEMINI_PROXY_BEARER_TOKEN');
  }

  let lastError = null;
  const attempts = Math.max(1, retries + 1);
  // Labeled so a non-retriable error (or an exhausted retry budget) falls
  // through to the final wrapped throw — a plain `break` here would only exit
  // the inner candidate loop and the outer attempt loop would keep retrying.
  retry: for (let attempt = 1; attempt <= attempts; attempt += 1) {
    for (let i = 0; i < urlCandidates.length; i += 1) {
      const candidateUrl = urlCandidates[i];
      const hasFallback = i < urlCandidates.length - 1;
      try {
        return await runOnce(candidateUrl, payload, timeoutMs, headers, {
          validateSanitizedResponse: options.validateSanitizedResponse
        });
      } catch (error) {
        lastError = error;
        const isNetworkError = /fetch failed|Network is unreachable|EHOSTUNREACH|ECONNREFUSED|ENETUNREACH/i.test(String(error?.message || ''));
        if (hasFallback && isNetworkError) {
          log.warn({ err: error, primary: candidateUrl, fallback: urlCandidates[i + 1] }, 'primary url failed, trying fallback');
          continue;
        }

        const code = errorCodeOf(error);
        const timeoutLike = code === CODES.EXECUTOR_TIMEOUT
          || code === CODES.GATEWAY_TIMEOUT
          || isTimeoutLikeError(error.message);
        const retriable = isRetriableError(error)
          && !(timeoutLike && !retryOnTimeout);
        if (!retriable || attempt >= attempts) {
          break retry;
        }

        if (timeoutLike && resetOnTimeout) {
          const resetResult = await triggerReset(resetUrl);
          log.warn({ resetResult }, 'timeout detected, reset requested');
        }

        await sleep(retryDelayMs * attempt);
        break; // exit candidate loop, advance to next attempt
      }
    }
  }

  const finalError = new Error(`Gemini proxy failed after ${attempts} attempt(s): ${lastError?.message || 'unknown error'}`);
  // Carry the underlying structured fields through so the job queue can still
  // classify the failure (capacity / timeout / etc.) after retries are spent.
  if (lastError) {
    if (lastError.status) finalError.status = lastError.status;
    if (lastError.payload) finalError.payload = lastError.payload;
    if (lastError.code) finalError.code = lastError.code;
  }
  throw finalError;
}

module.exports = { runGeminiProxy };
// Pure helpers exposed for unit tests — not part of the public API; production
// callers should never reach for these.
module.exports._internal = {
  buildResetUrl,
  isTimeoutLikeError,
  isMcpDiagnosticError,
  isRetriableError,
  sanitizeMcpDiagnosticText,
  sanitizeMcpDiagnosticsInResponse,
  assertNoMcpDiagnosticInResponse,
  looksLikeGateway18888,
  buildUrlCandidates,
  buildAuthHeaders,
};
