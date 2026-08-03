import { useQuery } from '@tanstack/react-query';
import { workspaceRuntimeApi } from '../runtime/workspace';
import { UiPerformanceObserver } from './UiPerformanceObserver';

export function RuntimePerformanceObserver() {
  const runtimeQuery = useQuery({
    queryKey: ['runtime'],
    queryFn: workspaceRuntimeApi.get,
    staleTime: 60_000,
    refetchInterval: 30_000,
  });
  const workspace = runtimeQuery.data?.workspace;
  return (
    <UiPerformanceObserver
      config={runtimeQuery.data?.observability?.uiPerformance}
      workspaceMode={workspace?.mode === 'sandbox' ? 'sandbox' : 'owner'}
    />
  );
}
