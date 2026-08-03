export type PronunciationTelemetryEvent = {
  eventType: 'token' | 'action' | 'state' | 'lifecycle' | 'request';
  uiSurface?: 'card-modal' | 'textbook' | 'review';
  tokenSource?: 'textbook' | 'manual' | 'dictionary' | 'analyzer' | 'rule' | 'llm-proposal' | 'legacy-ruby';
  tokenStatus?: 'accepted' | 'unresolved' | 'rejected' | 'superseded' | 'partial' | 'stale' | 'error';
  action?: 'tts' | 'copy' | 'knowledge' | 'generate-card' | 'correction' | 'selection';
  outcome?: 'started' | 'success' | 'error' | 'aborted' | 'ready' | 'partial' | 'stale' | 'unresolved' | 'legacy-hit' | 'open' | 'close' | 'start' | 'end';
  resource?: 'controller' | 'listener' | 'request';
  requestKind?: 'pronunciation' | 'correction' | 'tts' | 'knowledge' | 'generation';
  errorCode?: string;
  durationMs?: number;
  length?: number;
  queueWaitMs?: number;
  statusCode?: number;
};

export function reportPronunciationTelemetry(event: PronunciationTelemetryEvent) {
  if (typeof window === 'undefined') return;
  void fetch('/api/pronunciation/telemetry', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(event),
    keepalive: true,
  }).catch(() => undefined);
}
