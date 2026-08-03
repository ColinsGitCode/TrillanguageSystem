export type UiPerformanceMetricName =
  | 'ttfb'
  | 'fcp'
  | 'lcp'
  | 'cls'
  | 'inp'
  | 'route-transition'
  | 'card-modal-open';

export type UiPerformanceMetric = {
  name: UiPerformanceMetricName;
  value: number;
  route: string;
  context?: 'cold' | 'warm' | 'client';
};

type ReporterConfig = {
  enabled: boolean;
  sampleRate: number;
  workspaceMode: 'owner' | 'sandbox';
};

const queue: UiPerformanceMetric[] = [];
const interactionStarts = new Map<string, { startedAt: number; context?: UiPerformanceMetric['context'] }>();
let config: ReporterConfig = {
  enabled: false,
  sampleRate: 0,
  workspaceMode: 'owner',
};
let sampled = false;
let sampleResolved = false;
let flushTimer: number | null = null;

function currentRoute() {
  if (typeof window === 'undefined') return '/other';
  return window.location.pathname || '/';
}

function resolveSample() {
  if (sampleResolved) return sampled;
  sampleResolved = true;
  sampled = config.enabled && config.sampleRate > 0
    && (config.sampleRate >= 1 || Math.random() < config.sampleRate);
  return sampled;
}

function payload() {
  return JSON.stringify({
    version: 1,
    workspaceMode: config.workspaceMode,
    metrics: queue.splice(0, 12),
  });
}

export function flushUiPerformance(useBeacon = false) {
  if (typeof window === 'undefined' || !queue.length || !resolveSample()) return;
  if (flushTimer !== null) {
    window.clearTimeout(flushTimer);
    flushTimer = null;
  }
  const body = payload();
  if (useBeacon && navigator.sendBeacon) {
    navigator.sendBeacon('/api/ui-performance', new Blob([body], { type: 'application/json' }));
    return;
  }
  void fetch('/api/ui-performance', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body,
    keepalive: true,
  }).catch(() => {
    // Performance reporting must never interrupt the learning workflow.
  });
}

export function configureUiPerformance(next: ReporterConfig) {
  config = {
    enabled: Boolean(next.enabled),
    sampleRate: Math.min(1, Math.max(0, Number(next.sampleRate) || 0)),
    workspaceMode: next.workspaceMode === 'sandbox' ? 'sandbox' : 'owner',
  };
  sampleResolved = false;
  resolveSample();
}

export function recordUiPerformanceMetric(
  name: UiPerformanceMetricName,
  value: number,
  context?: UiPerformanceMetric['context']
) {
  if (typeof window === 'undefined' || !resolveSample() || !Number.isFinite(value) || value < 0) return;
  queue.push({
    name,
    value: Math.round(value * 1000) / 1000,
    route: currentRoute(),
    ...(context ? { context } : {}),
  });
  if (queue.length >= 8) {
    flushUiPerformance();
    return;
  }
  if (flushTimer === null) {
    flushTimer = window.setTimeout(() => flushUiPerformance(), 2_000);
  }
}

export function markUiInteractionStart(
  name: 'card-modal-open',
  context: 'cold' | 'warm'
) {
  if (typeof performance === 'undefined') return;
  interactionStarts.set(name, { startedAt: performance.now(), context });
}

export function markUiInteractionEnd(name: 'card-modal-open') {
  if (typeof performance === 'undefined') return;
  const started = interactionStarts.get(name);
  if (!started) return;
  interactionStarts.delete(name);
  recordUiPerformanceMetric(name, performance.now() - started.startedAt, started.context);
}
