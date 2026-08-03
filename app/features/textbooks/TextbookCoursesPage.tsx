import { useEffect, useMemo, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { FileCheck2, Images, ListChecks } from 'lucide-react';
import { ProductShell } from '../../components/ProductShell';
import { DataRefreshStatus, PageState } from '../../components/states';
import {
  WorkflowShell,
  type WorkflowError,
  type WorkflowSaveState,
  type WorkflowStage,
} from '../../components/workflow';
import { ApiError } from '../../lib/api/client';
import { claimExclusiveAudio, releaseExclusiveAudio, useExclusiveAudio } from '../../lib/audio/exclusive-audio';
import {
  buildAnnotatedTextbookHighlightDocument,
  buildTextbookHighlightDocument,
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
  const generatedAudio = useExclusiveAudio();
  const officialAudioOwnerRef = useRef(Symbol('official-track-audio'));
  const preferredExpressionIdRef = useRef<number | null>(null);
  const [search, setSearch] = useState('');
  const [intakeMessage, setIntakeMessage] = useState('');
  const [derivationMessage, setDerivationMessage] = useState('');
  const [highlightHtml, setHighlightHtml] = useState('');
  const [saveState, setSaveState] = useState<WorkflowSaveState>('clean');
  const [reviewDraftDirty, setReviewDraftDirty] = useState(false);
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
    queryFn: () => textbookApi.annotations(Number(route.trackId)),
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
    const routedTask = workflow.review.tasks.find((task) => Number(task.id) === route.taskId);
    const preferredExpressionId = preferredExpressionIdRef.current;
    const preferredTask = workflow.review.tasks.find(
      (task) => task.expressionId === preferredExpressionId
    );
    const fallback = workflow.review.tasks.find((task) => task.state === 'needs_attention')
      || workflow.review.tasks.find((task) => task.state === 'pending')
      || workflow.review.tasks[0];
    if (preferredTask && routedTask?.expressionId === preferredExpressionId) {
      preferredExpressionIdRef.current = null;
    }
    const normalized: Record<string, string | number | null> = {};
    if (!route.stage) normalized.stage = workflow.stage;
    if (preferredTask && routedTask?.expressionId !== preferredExpressionId) {
      normalized.task = Number(preferredTask.id);
    } else if (!routedTask && fallback) {
      normalized.task = Number(fallback.id);
    }
    if (Object.keys(normalized).length) route.normalize(normalized);
  }, [route, workflowQuery.data?.workflow]);
  useEffect(() => {
    const track = trackQuery.data?.track;
    if (!track) return setHighlightHtml('');
    if (highlightQuery.data) {
      setHighlightHtml(
        buildAnnotatedTextbookHighlightDocument(track, highlightQuery.data.annotations)
      );
      return;
    }
    setHighlightHtml(buildTextbookHighlightDocument(track));
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
    releaseExclusiveAudio(officialAudioOwnerRef.current);
    generatedAudio.stop();
  }, []);
  useEffect(() => {
    if (saveState !== 'saved') return undefined;
    const timer = window.setTimeout(() => setSaveState('clean'), 2500);
    return () => window.clearTimeout(timer);
  }, [saveState]);

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
      preferredExpressionIdRef.current = variables.task.expressionId;
      queryClient.setQueryData(['textbooks', 'track', data.track.id], { success: true, track: data.track });
      queryClient.setQueryData(['textbooks', 'workflow', data.track.id, null], { success: true, workflow: data.workflow });
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
  const bulkReviewMutation = useMutation({
    mutationFn: (tasks: TextbookReviewTask[]) => textbookApi.bulkUpdateReview(
      Number(workflowQuery.data?.workflow.track.revisionId),
      {
        updates: tasks.map((task) => ({
          expressionId: task.expressionId,
          expressionRevisionId: task.expressionRevisionId,
          status: 'needs_attention',
          reasonCode: 'manual-bulk-triage',
        })),
      }
    ),
    onSuccess: (data) => {
      setErrors([]);
      queryClient.setQueryData(
        ['textbooks', 'workflow', route.trackId, route.operationId],
        { success: true, workflow: data.workflow }
      );
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
  const cancelMutation = useMutation({
    mutationFn: () => textbookApi.cancelOperation(Number(route.operationId)),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['textbooks', 'operation', route.operationId] });
      void queryClient.invalidateQueries({ queryKey: ['textbooks', 'operation', route.operationId, 'events'] });
      void queryClient.invalidateQueries({ queryKey: ['textbooks', 'workflow', route.trackId] });
    },
    onError: (error) => setErrors([messageFor(error)]),
  });
  const highlightMutation = useMutation({
    mutationFn: async (payload: { selector: import('../card-modal/annotation-render.mjs').CardAnnotationSelector }) => {
      if (!highlightQuery.data?.target) throw new Error('Textbook annotation target is unavailable');
      return textbookApi.createAnnotation({
        id: crypto.randomUUID(),
        targetId: Number(route.trackId),
        expectedTargetRevision: highlightQuery.data.target.targetRevision,
        selector: payload.selector,
      });
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
  const coursesInitialLoading = coursesQuery.isLoading && !coursesQuery.data;
  const coursesInitialError = coursesQuery.isError && !coursesQuery.data && !featureDisabled;
  const courseRefreshFailed = (courseDetailsQuery.isError && Boolean(coursesQuery.data))
    || (trackQuery.isError && Boolean(trackQuery.data))
    || (workflowQuery.isError && Boolean(workflowQuery.data));
  const courseRefreshing = (
    (coursesQuery.isFetching && Boolean(coursesQuery.data))
    || (courseDetailsQuery.isFetching && Boolean(courseDetailsQuery.data))
    || (trackQuery.isFetching && Boolean(trackQuery.data))
  ) && !courseRefreshFailed;
  const generatedOperation = workflowOperation(operation);
  const activeExpressionId = useMemo(() => {
    const task = workflow?.review.tasks.find((item) => Number(item.id) === route.taskId);
    return task?.expressionRevisionId || track?.expressions[0]?.id || null;
  }, [route.taskId, track?.expressions, workflow?.review.tasks]);
  const playGenerated = (url: string) => {
    officialAudioRef.current?.pause();
    void generatedAudio.playUrl(url);
  };
  const navigateStage = (stage: WorkflowStage) => {
    const available = stages.find((item) => item.id === stage && item.state !== 'locked');
    if (available) route.selectStage(stage);
  };
  const updateReviewDirtyState = (dirty: boolean) => {
    setReviewDraftDirty(dirty);
    setSaveState((current) => {
      if (dirty) return current === 'saving' ? current : 'dirty';
      return current === 'dirty' ? 'clean' : current;
    });
  };

  return (
    <ProductShell active="textbooks" title="教材课程">
      <div className="textbook-page" data-testid="textbook-courses-page">
        {coursesInitialLoading ? (
          <PageState
            variant="loading"
            eyebrow="教材课程"
            title="正在读取教材课程"
            description="正在读取课程、Track 和已保存的校对进度。"
            testId="textbook-courses-loading"
          />
        ) : featureDisabled ? (
          <PageState
            variant="unavailable"
            eyebrow="教材课程"
            title="当前工作区未开放教材课程"
            description="其它学习功能仍可正常使用。工作区启用教材能力后，这里会显示课程与 Track。"
            testId="textbook-courses-unavailable"
          />
        ) : coursesInitialError ? (
          <PageState
            variant="error"
            eyebrow="教材课程"
            title="教材课程暂时无法读取"
            description="现有教材、校对记录和发布状态没有被修改。重新读取成功后再继续操作。"
            actions={<button className="primary" type="button" onClick={() => void coursesQuery.refetch()}>重新读取</button>}
            testId="textbook-courses-load-error"
          />
        ) : (
          <>
            <TextbookWorkflowHeader
              workflow={workflow}
              officialAudio={audio}
              audioRef={officialAudioRef}
              onOfficialAudioPlay={() => {
                generatedAudio.stop();
                const element = officialAudioRef.current;
                if (element) {
                  claimExclusiveAudio(officialAudioOwnerRef.current, () => element.pause());
                }
              }}
            />
            <DataRefreshStatus
              refreshing={courseRefreshing}
              failed={courseRefreshFailed}
              label="教材课程"
              onRetry={() => void Promise.all([
                coursesQuery.refetch(),
                courseDetailsQuery.refetch(),
                route.trackId ? trackQuery.refetch() : Promise.resolve(),
                route.trackId ? workflowQuery.refetch() : Promise.resolve(),
              ])}
              testId="textbook-refresh-status"
            />
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
            <div className={`textbook-workflow-layout${activeStage === 'complete' ? ' is-published' : ''}`}>
              <TextbookTrackRail courses={courses} activeTrackId={route.trackId} onSelect={(trackId) => route.selectTrack(trackId)} />
              {workflow ? (
                <WorkflowShell
                  eyebrow={`${workflow.track.courseKey} · TRACK ${String(workflow.track.trackNumber).padStart(2, '0')}`}
                  title={workflow.track.title}
                  objectLabel={`${workflow.review.confirmed}/${workflow.review.total} 已确认 · revision ${workflow.track.revisionNumber}`}
                  saveState={reviewDraftDirty && saveState !== 'saving' ? 'dirty' : saveState}
                  stages={stages}
                  onStageChange={navigateStage}
                >
                  {activeStage === 'review' && (
                    <TextbookReviewWorkbench
                      key={`${workflow.track.id}:${route.taskId || 'none'}`}
                      workflow={workflow}
                      activeTaskId={route.taskId ? String(route.taskId) : null}
                      onSelectTask={(id) => route.selectTask(Number(id))}
                      onSave={(task, changes) => saveMutation.mutate({ task, changes })}
                      onConfirm={(task) => reviewMutation.mutate(task)}
                      onBulkFlag={async (tasks) => {
                        await bulkReviewMutation.mutateAsync(tasks);
                      }}
                      bulkBusy={bulkReviewMutation.isPending}
                      saveState={saveState}
                      errors={errors}
                      onReload={() => { setErrors([]); setSaveState('clean'); void workflowQuery.refetch(); }}
                      onDirtyChange={updateReviewDirtyState}
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
                      onCancel={() => cancelMutation.mutate()}
                      busy={retryMutation.isPending || cancelMutation.isPending}
                    />
                  )}
                  {activeStage === 'complete' && (
                    <>
                      <TextbookCompletionSummary
                        workflow={workflow}
                        operation={operation}
                        officialAudio={audio}
                        generatedAudioCount={track?.tts_audio.length || 0}
                        onReview={() => route.selectStage('review')}
                      />
                      {track && (
                        <TextbookPublishedBrowser
                          track={track}
                          activeExpressionId={activeExpressionId}
                          highlightHtml={highlightHtml}
                          annotationMode={highlightQuery.isPending
                            ? 'pending'
                            : highlightQuery.data ? 'annotations' : 'unavailable'}
                          audioFiles={track.tts_audio}
                          busy={highlightMutation.isPending || derivationMutation.isPending}
                          message={derivationMessage}
                          onSelect={(id) => route.selectTask(id)}
                          onSaveAnnotation={(selector) => highlightMutation.mutate({ selector })}
                          onDerive={(payload) => derivationMutation.mutate(payload)}
                          onPlayAudio={playGenerated}
                        />
                      )}
                    </>
                  )}
                </WorkflowShell>
              ) : route.trackId && (workflowQuery.isLoading || trackQuery.isLoading) ? (
                <PageState
                  variant="loading"
                  eyebrow="教材 Track"
                  title="正在恢复 Track"
                  description="正在读取表达、校对进度和发布状态。"
                  compact
                  testId="textbook-track-loading"
                />
              ) : route.trackId && (workflowQuery.isError || trackQuery.isError) ? (
                <PageState
                  variant="error"
                  eyebrow="教材 Track"
                  title="这个 Track 暂时无法读取"
                  description="已保存内容没有被修改。重新读取后可以从原步骤继续。"
                  actions={(
                    <button
                      className="primary"
                      type="button"
                      onClick={() => void Promise.all([workflowQuery.refetch(), trackQuery.refetch()])}
                    >
                      重新读取
                    </button>
                  )}
                  compact
                  testId="textbook-track-load-error"
                />
              ) : courses.length > 0 && !route.trackId ? (
                <PageState
                  variant="loading"
                  eyebrow="教材课程"
                  title="正在打开第一个 Track"
                  description="正在恢复最近可用的教材内容。"
                  compact
                  testId="textbook-track-selection-loading"
                />
              ) : (
                <section className="surface textbook-empty-workbench textbook-empty-start" data-testid="textbook-empty-start">
                  <div>
                    <p className="eyebrow">第一个教材 Track</p>
                    <h1>从教材解析 Skill 开始</h1>
                    <p>教材页不执行 OCR。截图先由受控 Skill 解析，确认来源和表达列表后，才会进入本页校对。</p>
                  </div>
                  <ol aria-label="教材导入流程">
                    <li><Images aria-hidden="true" /><span><strong>准备教材素材</strong><small>同一 Track 的完整截图，以及可选的官方音频文件。</small></span></li>
                    <li><FileCheck2 aria-hidden="true" /><span><strong>确认只读解析结果</strong><small>检查英日配对、中文提示、ruby、重点短语与来源哈希。</small></span></li>
                    <li><ListChecks aria-hidden="true" /><span><strong>在本页逐条校对</strong><small>导入后确认表达，再发布到学习计划与复习系统。</small></span></li>
                  </ol>
                  <p className="textbook-empty-boundary">解析结果未经人工确认，不会自动写入教材课程或学习队列。</p>
                </section>
              )}
            </div>
          </>
        )}
      </div>
    </ProductShell>
  );
}
