import { useEffect, useRef } from 'react';
import { observeWebVitals } from './web-vitals';
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
    observeWebVitals(true);

    const onPageHide = () => flushUiPerformance(true);
    window.addEventListener('pagehide', onPageHide);
    return () => {
      observeWebVitals(false);
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
