import { useEffect, useMemo, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ProductShell } from '../../components/ProductShell';
import {
  WorkflowShell,
  type WorkflowError,
  type WorkflowSaveState,
  type WorkflowStage,
} from '../../components/workflow';
import { ApiError } from '../../lib/api/client';
import {
  buildAnnotatedTextbookHighlightDocument,
  buildTextbookHighlightDocument,
  sanitizeTextbookHighlightDocument,
} from './textbook-highlight';
import { textbookApi } from './textbook-api';
import { workflowOperation, workflowStages } from './textbook-workflow-adapter';
import { useTextbookWorkflowRoute } from './useTextbookWorkflowRoute';
import { TextbookCompletionSummary } from './components/TextbookCompletionSummary';
import { TextbookIntakeTools } from './components/TextbookIntakeTools';
import { TextbookProcessingView } from './components/TextbookProcessingView';
import { TextbookPublishedBrowser } from './components/TextbookPublishedBrowser';
import { TextbookReleaseReview } from './components/TextbookReleaseReview';
import { TextbookReviewWorkbench } from './components/TextbookReviewWorkbench';
import { TextbookTrackRail } from './components/TextbookTrackRail';
import { TextbookWorkflowHeader } from './components/TextbookWorkflowHeader';
import type { TextbookAsset, TextbookReviewTask } from './types';

function messageFor(error: unknown): WorkflowError {
  if (error instanceof ApiError) {
    const payload = error.payload as { code?: string } | null;
    const code = payload?.code || 'TEXTBOOK_REQUEST_FAILED';
    if (code === 'TEXTBOOK_REVISION_CONFLICT') return { code, message: '草稿已在其它上下文更新。请重新载入当前修订。' };
    if (code === 'TEXTBOOK_REVIEW_INCOMPLETE') return { code, message: '仍有未确认表达，不能进入发布。' };
    return { code, message: error.message, retryable: error.status >= 500 };
  }
  return { code: 'TEXTBOOK_REQUEST_FAILED', message: error instanceof Error ? error.message : '请求失败' };
}

function officialAudio(assets: TextbookAsset[]) {
  return assets.find((asset) => asset.kind === 'official_audio') || null;
}

export function TextbookCoursesPage() {
  const queryClient = useQueryClient();
  const route = useTextbookWorkflowRoute();
  const officialAudioRef = useRef<HTMLAudioElement | null>(null);
  const generatedAudioRef = useRef<HTMLAudioElement | null>(null);
  const [search, setSearch] = useState('');
  const [intakeMessage, setIntakeMessage] = useState('');
  const [derivationMessage, setDerivationMessage] = useState('');
  const [highlightHtml, setHighlightHtml] = useState('');
  const [saveState, setSaveState] = useState<WorkflowSaveState>('clean');
  const [errors, setErrors] = useState<WorkflowError[]>([]);

  const coursesQuery = useQuery({ queryKey: ['textbooks', 'courses'], queryFn: textbookApi.courses, retry: false });
  const courseDetailsQuery = useQuery({
    queryKey: ['textbooks', 'course-details', coursesQuery.data?.courses.map((course) => course.id).join(',') || 'empty'],
    queryFn: () => Promise.all((coursesQuery.data?.courses || []).map((course) => textbookApi.course(course.id).then((result) => result.course))),
    enabled: Boolean(coursesQuery.data?.courses.length),
  });
  const courses = courseDetailsQuery.data || coursesQuery.data?.courses || [];
  const trackQuery = useQuery({
    queryKey: ['textbooks', 'track', route.trackId],
    queryFn: () => textbookApi.track(Number(route.trackId)),
    enabled: Boolean(route.trackId),
  });
  const workflowQuery = useQuery({
    queryKey: ['textbooks', 'workflow', route.trackId, route.operationId],
    queryFn: () => textbookApi.workflow(Number(route.trackId), route.operationId),
    enabled: Boolean(route.trackId),
    refetchInterval: (query) => {
      const status = query.state.data?.workflow.operation?.status;
      return status && ['queued', 'running'].includes(status) ? 700 : false;
    },
  });
  const operationQuery = useQuery({
    queryKey: ['textbooks', 'operation', route.operationId],
    queryFn: () => textbookApi.operation(Number(route.operationId)),
    enabled: Boolean(route.operationId),
    refetchInterval: (query) => ['queued', 'running'].includes(query.state.data?.operation.status || '') ? 700 : false,
  });
  const eventQuery = useQuery({
    queryKey: ['textbooks', 'operation', route.operationId, 'events'],
    queryFn: () => textbookApi.operationEvents(Number(route.operationId)),
    enabled: Boolean(route.operationId),
    refetchInterval: () => ['queued', 'running'].includes(operationQuery.data?.operation.status || '') ? 700 : false,
  });
  const searchQuery = useQuery({
    queryKey: ['textbooks', 'search', search],
    queryFn: () => fetch(`/api/textbooks/search?q=${encodeURIComponent(search)}`).then((response) => response.json()),
    enabled: search.trim().length >= 2,
  });
  const highlightQuery = useQuery({
    queryKey: ['textbooks', 'track', route.trackId, 'highlight'],
    queryFn: async () => {
      try {
        const result = await textbookApi.annotations(Number(route.trackId));
        return { mode: 'annotations' as const, ...result };
      } catch (error) {
        if (!(error instanceof ApiError) || ![404, 409].includes(error.status)) throw error;
        const result = await textbookApi.highlight(Number(route.trackId));
        return { mode: 'legacy' as const, ...result };
      }
    },
    enabled: Boolean(route.trackId && trackQuery.data?.track.status === 'published'),
    retry: false,
  });

  useEffect(() => {
    if (route.trackId || !courses.length) return;
    const first = courses.flatMap((course) => course.tracks || [])[0];
    if (first) route.selectTrack(first.id, true);
  }, [courses, route]);
  useEffect(() => {
    const workflow = workflowQuery.data?.workflow;
    if (!workflow) return;
    const validTask = workflow.review.tasks.some((task) => Number(task.id) === route.taskId);
    const fallback = workflow.review.tasks.find((task) => task.state === 'needs_attention')
      || workflow.review.tasks.find((task) => task.state === 'pending')
      || workflow.review.tasks[0];
    const normalized: Record<string, string | number | null> = {};
    if (!route.stage) normalized.stage = workflow.stage;
    if (!validTask && fallback) normalized.task = Number(fallback.id);
    if (Object.keys(normalized).length) route.normalize(normalized);
  }, [route, workflowQuery.data?.workflow]);
  useEffect(() => {
    const track = trackQuery.data?.track;
    if (!track) return setHighlightHtml('');
    if (highlightQuery.data?.mode === 'annotations') {
      setHighlightHtml(
        buildAnnotatedTextbookHighlightDocument(track, highlightQuery.data.annotations)
      );
      return;
    }
    const persisted = highlightQuery.data?.mode === 'legacy'
      ? highlightQuery.data.highlight?.htmlContent
      : null;
    setHighlightHtml(
      persisted
        ? sanitizeTextbookHighlightDocument(persisted)
        : buildTextbookHighlightDocument(track)
    );
  }, [highlightQuery.data, trackQuery.data?.track]);
  useEffect(() => {
    const operation = operationQuery.data?.operation;
    if (!operation || ['queued', 'running'].includes(operation.status)) return;
    void queryClient.invalidateQueries({ queryKey: ['textbooks', 'workflow', route.trackId] });
    void queryClient.invalidateQueries({ queryKey: ['textbooks', 'track', route.trackId] });
    void queryClient.invalidateQueries({ queryKey: ['learning'] });
    if (operation.status === 'succeeded') route.selectStage('complete', true);
  }, [operationQuery.data?.operation, queryClient, route]);
  useEffect(() => () => {
    officialAudioRef.current?.pause();
    generatedAudioRef.current?.pause();
  }, []);

  const dryRunMutation = useMutation({
    mutationFn: textbookApi.dryRunImport,
    onSuccess: (data) => setIntakeMessage(`dry-run ok · ${data.summary.expressionCount} expressions · ${data.summary.unitCounts.total} units`),
    onError: (error) => setIntakeMessage(messageFor(error).message),
  });
  const importMutation = useMutation({
    mutationFn: textbookApi.importDraft,
    onSuccess: async (data) => {
      await queryClient.invalidateQueries({ queryKey: ['textbooks'] });
      route.selectTrack(data.track.id);
    },
    onError: (error) => setIntakeMessage(messageFor(error).message),
  });
  const saveMutation = useMutation({
    mutationFn: ({ task, changes }: { task: TextbookReviewTask; changes: Partial<TextbookReviewTask['content']> }) => textbookApi.updateRevision(
      Number(workflowQuery.data?.workflow.track.revisionId),
      {
        expectedRevisionId: Number(workflowQuery.data?.workflow.track.revisionId),
        expressionId: task.expressionId,
        changes,
      }
    ),
    onMutate: () => { setSaveState('saving'); setErrors([]); },
    onSuccess: (data, variables) => {
      queryClient.setQueryData(['textbooks', 'track', data.track.id], { success: true, track: data.track });
      queryClient.setQueryData(['textbooks', 'workflow', data.track.id, null], { success: true, workflow: data.workflow });
      const nextTask = data.workflow.review.tasks.find((task) => task.expressionId === variables.task.expressionId);
      route.normalize({ track: data.track.id, stage: 'review', task: nextTask?.id || null, operation: null });
      setSaveState('saved');
    },
    onError: (error) => {
      const mapped = messageFor(error);
      setSaveState(mapped.code === 'TEXTBOOK_REVISION_CONFLICT' ? 'conflict' : 'failed');
      setErrors([mapped]);
    },
  });
  const reviewMutation = useMutation({
    mutationFn: (task: TextbookReviewTask) => textbookApi.updateReview(
      Number(workflowQuery.data?.workflow.track.revisionId),
      task.expressionId,
      { expressionRevisionId: task.expressionRevisionId, status: 'confirmed', reviewer: 'local-user' }
    ),
    onSuccess: (data, task) => {
      queryClient.setQueryData(['textbooks', 'workflow', route.trackId, route.operationId], { success: true, workflow: data.workflow });
      const next = data.workflow.review.tasks.find((item) => item.state !== 'confirmed' && item.ordinal > task.ordinal)
        || data.workflow.review.tasks.find((item) => item.state !== 'confirmed');
      if (next) route.selectTask(Number(next.id), true);
      else route.selectStage('release');
    },
    onError: (error) => setErrors([messageFor(error)]),
  });
  const releaseMutation = useMutation({
    mutationFn: async () => {
      let workflow = workflowQuery.data?.workflow;
      if (!workflow) throw new Error('Workflow is not ready');
      if (workflow.commands.verify) {
        await textbookApi.verifyRevision(workflow.track.revisionId, workflow.track.status);
        workflow = (await textbookApi.workflow(workflow.track.id)).workflow;
      }
      if (!workflow.commands.release) throw new Error('Track is not ready to release');
      return textbookApi.createOperation(workflow.track.id, {
        kind: 'release',
        idempotencyKey: `textbook-release-${workflow.track.id}-${workflow.track.revisionId}-${workflow.release.previewRevision}`,
        previewRevision: workflow.release.previewRevision,
        payload: {
          expectedTrackRevision: workflow.track.revisionNumber,
          confirmUnitCount: workflow.release.unitCount,
          expectedPlanRevision: workflow.release.planRevision,
          includeTts: true,
        },
      });
    },
    onSuccess: (data) => route.selectOperation(data.operation.id),
    onError: (error) => setErrors([messageFor(error)]),
  });
  const retryMutation = useMutation({
    mutationFn: () => textbookApi.retryOperation(Number(route.operationId)),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['textbooks', 'operation', route.operationId] });
      void queryClient.invalidateQueries({ queryKey: ['textbooks', 'workflow', route.trackId] });
    },
    onError: (error) => setErrors([messageFor(error)]),
  });
  const highlightMutation = useMutation({
    mutationFn: async (payload: { selector?: import('../card-modal/annotation-render.mjs').CardAnnotationSelector; html?: string }) => {
      if (
        highlightQuery.data?.mode === 'annotations'
        && payload.selector
        && highlightQuery.data.target
      ) {
        return textbookApi.createAnnotation({
          id: crypto.randomUUID(),
          targetId: Number(route.trackId),
          expectedTargetRevision: highlightQuery.data.target.targetRevision,
          selector: payload.selector,
        });
      }
      if (!payload.html) throw new Error('Legacy textbook highlight HTML is required');
      return textbookApi.saveHighlight(Number(route.trackId), payload.html);
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({
        queryKey: ['textbooks', 'track', route.trackId, 'highlight'],
      });
    },
  });
  const derivationMutation = useMutation({
    mutationFn: (payload: { expressionId: number; selectionText: string; selectionLanguage: 'en' | 'ja'; targetCardType: 'trilingual' | 'grammar_ja' }) => textbookApi.createDerivation(payload.expressionId, payload),
    onSuccess: (data) => {
      setDerivationMessage(`已创建生成任务 #${data.job.id}，可在全局 Activity 查看。`);
      void queryClient.invalidateQueries({ queryKey: ['generation-jobs'] });
    },
    onError: (error) => setDerivationMessage(messageFor(error).message),
  });

  const workflow = workflowQuery.data?.workflow || null;
  const track = trackQuery.data?.track || null;
  const operation = operationQuery.data?.operation || workflow?.operation || null;
  const activeStage = route.stage || workflow?.stage || 'intake';
  const stages = workflow ? workflowStages({ ...workflow, operation }) : [];
  const audio = officialAudio(track?.assets || []);
  const missingTts = Math.max((workflow?.release.unitCount || 0) - (track?.tts_audio.length || 0), 0);
  const featureDisabled = coursesQuery.isError && coursesQuery.error instanceof ApiError && coursesQuery.error.status === 404;
  const generatedOperation = workflowOperation(operation);
  const activeExpressionId = useMemo(() => {
    const task = workflow?.review.tasks.find((item) => Number(item.id) === route.taskId);
    return task?.expressionRevisionId || track?.expressions[0]?.id || null;
  }, [route.taskId, track?.expressions, workflow?.review.tasks]);
  const playGenerated = (url: string) => {
    officialAudioRef.current?.pause();
    generatedAudioRef.current?.pause();
    const media = new Audio(url);
    generatedAudioRef.current = media;
    void media.play();
  };
  const navigateStage = (stage: WorkflowStage) => {
    const available = stages.find((item) => item.id === stage && item.state !== 'locked');
    if (available) route.selectStage(stage);
  };

  return (
    <ProductShell active="textbooks" title="教材课程">
      <div className="textbook-page" data-testid="textbook-courses-page">
        {featureDisabled ? (
          <section className="surface textbook-disabled"><h1>教材功能未开启</h1><p>设置 `TEXTBOOK_FEATURE_ENABLED=true` 后重启服务。</p></section>
        ) : (
          <>
            <TextbookWorkflowHeader workflow={workflow} officialAudio={audio} audioRef={officialAudioRef} onOfficialAudioPlay={() => generatedAudioRef.current?.pause()} />
            <TextbookIntakeTools
              search={search}
              results={searchQuery.data?.results || []}
              onSearch={setSearch}
              onSelectResult={(trackId) => route.selectTrack(trackId)}
              onDryRun={(payload) => dryRunMutation.mutate(payload)}
              onImport={(payload) => importMutation.mutate(payload)}
              busy={dryRunMutation.isPending || importMutation.isPending}
              message={intakeMessage}
            />
            <div className="textbook-workflow-layout">
              <TextbookTrackRail courses={courses} activeTrackId={route.trackId} onSelect={(trackId) => route.selectTrack(trackId)} />
              {workflow ? (
                <WorkflowShell
                  eyebrow={`${workflow.track.courseKey} · TRACK ${String(workflow.track.trackNumber).padStart(2, '0')}`}
                  title={workflow.track.title}
                  objectLabel={`${workflow.review.confirmed}/${workflow.review.total} 已确认 · revision ${workflow.track.revisionNumber}`}
                  saveState={saveState}
                  stages={stages}
                  onStageChange={navigateStage}
                >
                  {activeStage === 'review' && (
                    <TextbookReviewWorkbench
                      workflow={workflow}
                      activeTaskId={route.taskId ? String(route.taskId) : null}
                      onSelectTask={(id) => route.selectTask(Number(id))}
                      onSave={(task, changes) => saveMutation.mutate({ task, changes })}
                      onConfirm={(task) => reviewMutation.mutate(task)}
                      saveState={saveState}
                      errors={errors}
                      onReload={() => { setErrors([]); setSaveState('clean'); void workflowQuery.refetch(); }}
                    />
                  )}
                  {activeStage === 'release' && (
                    <TextbookReleaseReview
                      workflow={workflow}
                      officialAudio={audio}
                      missingTts={missingTts}
                      busy={releaseMutation.isPending}
                      onRelease={() => releaseMutation.mutate()}
                      onChange={() => route.selectStage('review')}
                    />
                  )}
                  {activeStage === 'processing' && generatedOperation && (
                    <TextbookProcessingView
                      operation={generatedOperation}
                      events={eventQuery.data?.events || []}
                      onRetry={() => retryMutation.mutate()}
                    />
                  )}
                  {activeStage === 'complete' && (
                    <>
                      <TextbookCompletionSummary
                        workflow={workflow}
                        operation={operation}
                        officialAudio={audio}
                        generatedAudioCount={track?.tts_audio.length || 0}
                        onBrowse={() => route.selectStage('complete')}
                      />
                      {track && (
                        <TextbookPublishedBrowser
                          track={track}
                          activeExpressionId={activeExpressionId}
                          highlightHtml={highlightHtml}
                          annotationMode={highlightQuery.isPending
                            ? 'pending'
                            : highlightQuery.data?.mode || 'legacy'}
                          audioFiles={track.tts_audio}
                          busy={highlightMutation.isPending || derivationMutation.isPending}
                          message={derivationMessage}
                          onSelect={(id) => route.selectTask(id)}
                          onSaveAnnotation={(selector) => highlightMutation.mutate({ selector })}
                          onSaveLegacyHighlight={(html) => highlightMutation.mutate({ html })}
                          onDerive={(payload) => derivationMutation.mutate(payload)}
                          onPlayAudio={playGenerated}
                        />
                      )}
                    </>
                  )}
                </WorkflowShell>
              ) : (
                <section className="surface textbook-empty-workbench"><h1>选择一个 Track</h1><p>Skill 导入后会直接进入人工校对。</p></section>
              )}
            </div>
          </>
        )}
      </div>
    </ProductShell>
  );
}
