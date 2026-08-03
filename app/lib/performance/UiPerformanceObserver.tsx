import { useEffect, useRef } from 'react';
import { useLocation, useNavigation } from 'react-router';
import {
  configureUiPerformance,
  flushUiPerformance,
  recordUiPerformanceMetric,
} from './ui-performance';

type PerformanceConfig = {
  enabled: boolean;
  sampleRate: number;
};

type EventTimingEntry = PerformanceEntry & {
  duration: number;
  interactionId?: number;
};

type LayoutShiftEntry = PerformanceEntry & {
  value: number;
  hadRecentInput: boolean;
};

function observe(type: string, callback: (entries: PerformanceEntry[]) => void) {
  if (typeof PerformanceObserver === 'undefined') return null;
  try {
    const observer = new PerformanceObserver((list) => callback(list.getEntries()));
    observer.observe({ type, buffered: true });
    return observer;
  } catch {
    return null;
  }
}

export function UiPerformanceObserver({
  config,
  workspaceMode,
}: {
  config?: PerformanceConfig | null;
  workspaceMode: 'owner' | 'sandbox';
}) {
  const location = useLocation();
  const navigation = useNavigation();
  const routeStartedAt = useRef<number | null>(null);
  const settledPath = useRef(location.pathname);

  useEffect(() => {
    configureUiPerformance({
      enabled: Boolean(config?.enabled),
      sampleRate: config?.sampleRate || 0,
      workspaceMode,
    });
  }, [config?.enabled, config?.sampleRate, workspaceMode]);

  useEffect(() => {
    if (!config?.enabled) return undefined;
    const navigationEntry = performance.getEntriesByType('navigation')[0] as PerformanceNavigationTiming | undefined;
    if (navigationEntry?.responseStart) {
      recordUiPerformanceMetric('ttfb', navigationEntry.responseStart);
    }

    let cumulativeLayoutShift = 0;
    let largestInteraction = 0;
    const observers = [
      observe('paint', (entries) => {
        const fcp = entries.find((entry) => entry.name === 'first-contentful-paint');
        if (fcp) recordUiPerformanceMetric('fcp', fcp.startTime);
      }),
      observe('largest-contentful-paint', (entries) => {
        const entry = entries.at(-1);
        if (entry) recordUiPerformanceMetric('lcp', entry.startTime);
      }),
      observe('layout-shift', (entries) => {
        for (const entry of entries as LayoutShiftEntry[]) {
          if (!entry.hadRecentInput) cumulativeLayoutShift += entry.value;
        }
        if (cumulativeLayoutShift > 0) {
          recordUiPerformanceMetric('cls', cumulativeLayoutShift);
        }
      }),
      observe('event', (entries) => {
        for (const entry of entries as EventTimingEntry[]) {
          if (entry.interactionId && entry.duration > largestInteraction) {
            largestInteraction = entry.duration;
          }
        }
        if (largestInteraction > 0) recordUiPerformanceMetric('inp', largestInteraction);
      }),
    ].filter(Boolean) as PerformanceObserver[];

    const onPageHide = () => flushUiPerformance(true);
    window.addEventListener('pagehide', onPageHide);
    return () => {
      observers.forEach((observer) => observer.disconnect());
      window.removeEventListener('pagehide', onPageHide);
      flushUiPerformance();
    };
  }, [config?.enabled]);

  useEffect(() => {
    if (!config?.enabled) return undefined;
    const onDocumentClick = (event: MouseEvent) => {
      if (event.defaultPrevented || event.button !== 0) return;
      const target = event.target instanceof Element ? event.target : null;
      const anchor = target?.closest<HTMLAnchorElement>('a[href]');
      if (!anchor || anchor.target || anchor.hasAttribute('download')) return;
      const destination = new URL(anchor.href, window.location.href);
      if (
        destination.origin !== window.location.origin
        || destination.pathname === window.location.pathname
      ) return;
      routeStartedAt.current = performance.now();
    };
    document.addEventListener('click', onDocumentClick, true);
    return () => document.removeEventListener('click', onDocumentClick, true);
  }, [config?.enabled]);

  useEffect(() => {
    if (!config?.enabled) return;
    if (navigation.state !== 'idle' && routeStartedAt.current === null) {
      routeStartedAt.current = performance.now();
      return;
    }
    const pathChanged = settledPath.current !== location.pathname;
    settledPath.current = location.pathname;
    if (pathChanged && navigation.state === 'idle' && routeStartedAt.current !== null) {
      const startedAt = routeStartedAt.current;
      routeStartedAt.current = null;
      window.requestAnimationFrame(() => {
        window.requestAnimationFrame(() => {
          recordUiPerformanceMetric('route-transition', performance.now() - startedAt, 'client');
        });
      });
    }
  }, [config?.enabled, location.pathname, navigation.state]);

  return null;
}
