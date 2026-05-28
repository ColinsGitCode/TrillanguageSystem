#!/usr/bin/env node

const DEFAULT_BASE_URL = process.env.APP_BASE_URL || 'http://localhost:3010';

function parseArgs(argv = []) {
  const options = {
    baseUrl: DEFAULT_BASE_URL,
    limit: 20,
    force: false,
    folder: '',
    cardType: '',
    provider: '',
    requestTimeoutMs: Number(process.env.TRAINING_BACKFILL_CLIENT_TIMEOUT_MS || 900000)
  };

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    const next = argv[i + 1];

    if (arg === '--base-url' && next) {
      options.baseUrl = next;
      i += 1;
    } else if (arg === '--limit' && next) {
      options.limit = Number(next) || 20;
      i += 1;
    } else if (arg === '--force') {
      options.force = true;
    } else if (arg === '--folder' && next) {
      options.folder = next;
      i += 1;
    } else if (arg === '--card-type' && next) {
      options.cardType = next;
      i += 1;
    } else if (arg === '--provider' && next) {
      options.provider = next;
      i += 1;
    } else if (arg === '--request-timeout-ms' && next) {
      options.requestTimeoutMs = Number(next) || options.requestTimeoutMs;
      i += 1;
    }
  }

  return options;
}

async function fetchJson(url, options = {}) {
  const { timeoutMs: rawTimeoutMs, ...fetchOptions } = options;
  const timeoutMs = Number(rawTimeoutMs || 0);
  const controller = timeoutMs > 0 ? new AbortController() : null;
  const timer = controller ? setTimeout(() => controller.abort(), timeoutMs) : null;
  const response = await fetch(url, {
    ...fetchOptions,
    signal: controller ? controller.signal : fetchOptions.signal
  }).finally(() => {
    if (timer) clearTimeout(timer);
  }).catch((error) => {
    if (error?.name === 'AbortError') {
      throw new Error(`request timeout after ${timeoutMs}ms`);
    }
    throw error;
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(payload.error || `HTTP ${response.status}`);
  }
  return payload;
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const summaryUrl = new URL('/api/training/backfill/summary', options.baseUrl);
  if (options.folder) summaryUrl.searchParams.set('folder', options.folder);
  if (options.cardType) summaryUrl.searchParams.set('cardType', options.cardType);
  if (options.provider) summaryUrl.searchParams.set('provider', options.provider);

  const before = await fetchJson(summaryUrl, { timeoutMs: options.requestTimeoutMs });
  console.log('[TRAIN backfill] before:', JSON.stringify(before.summary, null, 2));

  const result = await fetchJson(new URL('/api/training/backfill', options.baseUrl), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    timeoutMs: options.requestTimeoutMs,
    body: JSON.stringify({
      limit: options.limit,
      force: options.force,
      folder: options.folder,
      cardType: options.cardType,
      provider: options.provider
    })
  });

  console.log('[TRAIN backfill] run:', JSON.stringify({
    processed: result.processed,
    readyCount: result.readyCount,
    repairedCount: result.repairedCount,
    fallbackCount: result.fallbackCount,
    failedCount: result.failedCount,
    requestedFilters: result.requestedFilters
  }, null, 2));

  if (Array.isArray(result.results) && result.results.length) {
    console.log('[TRAIN backfill] items:');
    result.results.forEach((item) => {
      console.log(`- #${item.generationId} [${item.status}] ${item.folderName}/${item.baseName}`);
    });
  }

  const after = await fetchJson(summaryUrl, { timeoutMs: options.requestTimeoutMs });
  console.log('[TRAIN backfill] after:', JSON.stringify(after.summary, null, 2));
}

main().catch((error) => {
  console.error('[TRAIN backfill] failed:', error.message);
  process.exit(1);
});
