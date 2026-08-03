import { publishSandboxLimit } from '../runtime/sandbox-events';

export class ApiError extends Error {
  status: number;
  payload: unknown;

  constructor(message: string, status: number, payload: unknown) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.payload = payload;
  }
}

export async function requestJson<T>(url: string, init: RequestInit = {}): Promise<T> {
  const response = await fetch(url, {
    ...init,
    headers: {
      ...(init.body ? { 'Content-Type': 'application/json' } : {}),
      ...init.headers,
    },
  });
  const text = await response.text();
  let payload: unknown = null;
  if (text) {
    try {
      payload = JSON.parse(text);
    } catch {
      payload = text;
    }
  }
  if (!response.ok) {
    const message = typeof payload === 'object' && payload && 'error' in payload
      ? String((payload as { error: unknown }).error)
      : `Request failed (${response.status})`;
    if (response.status === 429 && payload && typeof payload === 'object' && 'code' in payload) {
      const details = 'details' in payload && payload.details && typeof payload.details === 'object'
        ? payload.details as { category?: unknown }
        : {};
      const code = String(payload.code || '');
      if (code === 'SANDBOX_QUOTA_EXCEEDED' || code === 'SANDBOX_STORAGE_LIMIT') {
        publishSandboxLimit({
          code,
          category: ['generation', 'ocr', 'tts', 'storage'].includes(String(details.category || ''))
            ? String(details.category) as 'generation' | 'ocr' | 'tts' | 'storage'
            : null,
          message,
        });
      }
    }
    throw new ApiError(message, response.status, payload);
  }
  return payload as T;
}

export async function requestText(url: string): Promise<string> {
  const response = await fetch(url);
  if (!response.ok) throw new ApiError('File not found', response.status, null);
  return response.text();
}
