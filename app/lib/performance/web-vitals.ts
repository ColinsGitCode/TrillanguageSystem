import { recordUiPerformanceMetric, flushUiPerformance, type UiPerformanceMetricName } from './ui-performance';

let started = false;
let enabled = false;

// The library owns document-lifetime observers (including bfcache restoration).
// React remounts only update reporting consent, never create duplicate observers.
export function observeWebVitals(nextEnabled: boolean) {
  enabled = nextEnabled;
  if (!enabled || started) return;
  started = true;
  void import('web-vitals').then(({ onCLS, onFCP, onINP, onLCP, onTTFB }) => {
    const report = (metric: { name: string; value: number }) => {
      if (!enabled) return;
      recordUiPerformanceMetric(metric.name.toLowerCase() as UiPerformanceMetricName, metric.value);
      if (document.visibilityState === 'hidden') flushUiPerformance(true);
    };
    onCLS(report);
    onFCP(report);
    onINP(report);
    onLCP(report);
    onTTFB(report);
  }).catch(() => { started = false; });
}
