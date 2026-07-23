import { useCallback, useMemo } from 'react';
import { useSearchParams } from 'react-router';
import type { WorkflowStage } from '../../components/workflow';

const validStages = new Set<WorkflowStage>(['intake', 'review', 'release', 'processing', 'complete']);

function positiveInteger(value: string | null): number | null {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
}

export function useTextbookWorkflowRoute() {
  const [params, setParams] = useSearchParams();
  const context = useMemo(() => {
    const stage = params.get('stage');
    return {
      trackId: positiveInteger(params.get('track')),
      stage: validStages.has(stage as WorkflowStage) ? stage as WorkflowStage : null,
      taskId: positiveInteger(params.get('task')),
      operationId: positiveInteger(params.get('operation')),
    };
  }, [params]);
  const update = useCallback((changes: Record<string, string | number | null | undefined>, replace = false) => {
    setParams((current) => {
      const next = new URLSearchParams(current);
      for (const [key, value] of Object.entries(changes)) {
        if (value === null || value === undefined || value === '') next.delete(key);
        else next.set(key, String(value));
      }
      return next;
    }, { replace });
  }, [setParams]);
  const selectTrack = useCallback((trackId: number, replace = false) => update({
    track: trackId,
    stage: null,
    task: null,
    operation: null,
  }, replace), [update]);
  const selectTask = useCallback((taskId: number | null, replace = false) => update({ task: taskId }, replace), [update]);
  const selectStage = useCallback((stage: WorkflowStage, replace = false) => update({ stage }, replace), [update]);
  const selectOperation = useCallback((operationId: number, replace = false) => update({
    stage: 'processing',
    operation: operationId,
  }, replace), [update]);
  const normalize = useCallback(
    (changes: Record<string, string | number | null | undefined>) => update(changes, true),
    [update]
  );
  return useMemo(() => ({
    ...context,
    selectTrack,
    selectTask,
    selectStage,
    selectOperation,
    normalize,
  }), [context, normalize, selectOperation, selectStage, selectTask, selectTrack]);
}
