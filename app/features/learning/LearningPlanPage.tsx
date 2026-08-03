import { useEffect, useMemo, useRef, useState } from 'react';
import { BookOpen, CalendarRange, Check, Pause, Play, Save, Tags } from 'lucide-react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useNavigate, useSearchParams } from 'react-router';
import { PageHeader } from '../../components/PageHeader';
import { ProductShell } from '../../components/ProductShell';
import { ConfirmDialog, DialogSurface } from '../../components/overlays';
import { DataRefreshStatus, PageState } from '../../components/states';
import {
  LeaveGuardDialog,
  ReviewSummary,
  SaveStatus,
  StageNavigation,
  useLeaveGuard,
  type WorkflowSaveState,
  type WorkflowStageItem,
} from '../../components/workflow';
import { ApiError } from '../../lib/api/client';
import { learningApi } from './learning-api';
import type { LearningScope } from './types';

const CARD_TYPES = [
  { value: 'trilingual', label: '三语卡片', detail: '英文与日文分开学习' },
  { value: 'grammar_ja', label: '日语语法', detail: '语法点与例句' },
  { value: 'scenario_phrase', label: '场景表达', detail: '每个表达双语回忆' },
  { value: 'textbook_track', label: '教材课程', detail: '已发布 Track 的英日原句' },
  { value: 'whole_card', label: '完整卡片', detail: '人工确认的整卡单元' },
] as const;

const TAG_LABELS: Record<string, string> = {
  'fn:aspect': '时态与体',
  'fn:sequence': '顺序与流程',
  'fn:judgment': '判断与评价',
  'fn:compare': '比较',
  'fn:cause': '原因与结果',
  'fn:intent': '意图与计划',
  'fn:condition': '条件',
  'fn:colloquial': '口语表达',
  'fn:question': '提问',
  'fn:prohibit': '禁止',
  'fn:request': '请求',
  'fn:advice': '建议',
  'fn:report': '转述与报告',
  'fn:give-receive': '授受表达',
  'topic:software-eng': '软件工程',
  'topic:ai-data': '人工智能与数据',
  'topic:finance-biz': '商务与金融',
  'topic:childcare': '育儿与家庭',
};

const TAG_GROUP_LABELS: Record<string, string> = {
  fn: '表达功能',
  topic: '学习主题',
  tag: '自定义标签',
};

function learningTagLabel(namespace: string, value: string) {
  return TAG_LABELS[`${namespace}:${value}`]
    || value.replace(/[-_]+/gu, ' ').replace(/\b\w/gu, (letter) => letter.toUpperCase());
}

function apiMessage(error: Error) {
  if (error instanceof ApiError && error.payload && typeof error.payload === 'object' && 'code' in error.payload) {
    const code = String((error.payload as { code?: string }).code || '');
    if (code === 'LEARNING_ACTIVE_SESSION_CONFLICT') return '请先结束当前复习会话，再修改学习计划。';
    if (code === 'LEARNING_PLAN_REVISION_CONFLICT') return '计划已在其它页面更新，请刷新后重试。';
  }
  return error.message;
}

function planDraftSignature(
  scope: LearningScope,
  dailyActionGoal: number,
  dailyNewLimit: number,
  timeZone: string
) {
  return JSON.stringify({
    scope: {
      ...scope,
      languages: [...scope.languages].sort(),
      cardTypes: [...scope.cardTypes].sort(),
      tags: [...scope.tags]
        .map((tag) => ({ namespace: tag.namespace, value: tag.value }))
        .sort((left, right) => `${left.namespace}:${left.value}`.localeCompare(`${right.namespace}:${right.value}`)),
      textbookTrackIds: [...(scope.textbookTrackIds || [])].sort((left, right) => left - right),
    },
    dailyActionGoal,
    dailyNewLimit,
    timeZone,
  });
}

type LearningPlanStage = 'scope' | 'review' | 'apply';

export function LearningPlanPage() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const textbookPrefillApplied = useRef(false);
  const queryClient = useQueryClient();
  const planQuery = useQuery({ queryKey: ['learning', 'plan'], queryFn: learningApi.plan });
  const optionsQuery = useQuery({ queryKey: ['learning', 'scope-options'], queryFn: learningApi.scopeOptions });
  const [scope, setScope] = useState<LearningScope | null>(null);
  const [dailyGoal, setDailyGoal] = useState(20);
  const [dailyNew, setDailyNew] = useState(5);
  const [timeZone, setTimeZone] = useState('Asia/Tokyo');
  const [dateEnabled, setDateEnabled] = useState(false);
  const [confirmSave, setConfirmSave] = useState(false);
  const [reviewPlanRevision, setReviewPlanRevision] = useState<number | null>(null);
  const [confirmPause, setConfirmPause] = useState(false);
  const [notice, setNotice] = useState('');
  const [tagSearch, setTagSearch] = useState('');
  const [showAllTags, setShowAllTags] = useState(false);

  useEffect(() => {
    if (!planQuery.data || scope) return;
    const source = planQuery.data.plan || {
      scope: planQuery.data.defaults.scope,
      dailyActionGoal: planQuery.data.defaults.dailyActionGoal,
      dailyNewLimit: planQuery.data.defaults.dailyNewLimit,
    };
    setScope(structuredClone(source.scope));
    setDailyGoal(source.dailyActionGoal);
    setDailyNew(source.dailyNewLimit);
    setTimeZone(planQuery.data.profile.timeZone || 'Asia/Tokyo');
    setDateEnabled(Boolean(source.scope.dateRange));
  }, [planQuery.data, scope]);

  const previewQuery = useQuery({
    queryKey: ['learning', 'plan-preview', scope],
    queryFn: () => learningApi.previewPlan(scope as LearningScope),
    enabled: Boolean(scope),
    staleTime: 0,
    refetchInterval: confirmSave ? 1500 : false,
  });

  const saveMutation = useMutation({
    mutationFn: () => learningApi.savePlan({
      expectedRevision: planQuery.data?.plan?.revision || 0,
      scope: scope as LearningScope,
      dailyActionGoal: dailyGoal,
      dailyNewLimit: dailyNew,
      timeZone,
    }),
    onSuccess: async () => {
      await learningApi.ensureTodayQueue();
      await queryClient.invalidateQueries({ queryKey: ['learning'] });
      navigate('/learn');
    },
    onError: async (error) => {
      setNotice(apiMessage(error));
      if (error instanceof ApiError && error.status === 409) {
        await queryClient.invalidateQueries({ queryKey: ['learning', 'plan'] });
        await previewQuery.refetch();
      }
    },
  });

  const statusMutation = useMutation({
    mutationFn: (status: 'paused' | 'active') => status === 'paused' ? learningApi.pausePlan() : learningApi.resumePlan(),
    onSuccess: async (data) => {
      queryClient.setQueryData(['learning', 'plan'], data);
      setConfirmPause(false);
      setNotice(data.plan?.status === 'paused' ? '计划已暂停，学习记录和调度状态保持不变。' : '计划已恢复。');
    },
    onError: (error) => setNotice(apiMessage(error)),
  });

  const textbookTracks = optionsQuery.data?.textbookTracks || [];
  const requestedTextbookTrackId = Number(searchParams.get('textbookTrack')) || null;
  useEffect(() => {
    if (textbookPrefillApplied.current || !scope || !requestedTextbookTrackId || !textbookTracks.length) return;
    if (!textbookTracks.some((track) => track.id === requestedTextbookTrackId)) {
      textbookPrefillApplied.current = true;
      setNotice('指定的教材 Track 尚未发布，未修改当前计划草稿。');
      return;
    }
    textbookPrefillApplied.current = true;
    setScope({
      ...scope,
      version: 2,
      cardTypes: scope.cardTypes.includes('textbook_track')
        ? scope.cardTypes
        : [...scope.cardTypes, 'textbook_track'],
      textbookTrackIds: [requestedTextbookTrackId],
    });
    setNotice('已预选该教材 Track。请检查范围后手动保存；系统不会自动修改学习计划。');
  }, [requestedTextbookTrackId, scope, textbookTracks]);
  const toggleLanguage = (language: 'en' | 'ja') => {
    if (!scope) return;
    const exists = scope.languages.includes(language);
    if (exists && scope.languages.length === 1) return;
    setScope({ ...scope, languages: exists ? scope.languages.filter((item) => item !== language) : [...scope.languages, language].sort() as Array<'en' | 'ja'> });
  };
  const toggleCardType = (cardType: LearningScope['cardTypes'][number]) => {
    if (!scope) return;
    const exists = scope.cardTypes.includes(cardType);
    if (exists && scope.cardTypes.length === 1) return;
    const nextCardTypes = exists
      ? scope.cardTypes.filter((item) => item !== cardType)
      : [...scope.cardTypes, cardType].sort();
    const nextScope: LearningScope = {
      ...scope,
      version: cardType === 'textbook_track' || scope.version === 2 ? 2 : scope.version,
      cardTypes: nextCardTypes,
    };
    if (cardType === 'textbook_track') {
      nextScope.textbookTrackIds = exists ? [] : textbookTracks.map((track) => track.id);
    }
    setScope(nextScope);
  };
  const toggleTextbookTrack = (trackId: number) => {
    if (!scope) return;
    const ids = scope.textbookTrackIds || [];
    const exists = ids.includes(trackId);
    setScope({
      ...scope,
      version: 2,
      textbookTrackIds: exists ? ids.filter((id) => id !== trackId) : [...ids, trackId].sort((a, b) => a - b),
    });
  };
  const toggleTag = (namespace: string, value: string) => {
    if (!scope) return;
    const key = `${namespace}:${value}`;
    const exists = scope.tags.some((tag) => `${tag.namespace}:${tag.value}` === key);
    setScope({ ...scope, tags: exists ? scope.tags.filter((tag) => `${tag.namespace}:${tag.value}` !== key) : [...scope.tags, { namespace, value }] });
  };

  const preview = previewQuery.data?.scopePreview || planQuery.data?.scopePreview;
  const theoreticalDays = dailyNew > 0 && preview ? Math.ceil(preview.studyItemCount / dailyNew) : null;
  const isReduction = Boolean(planQuery.data?.plan && preview && preview.studyItemCount < planQuery.data.scopePreview.studyItemCount);
  const removedItemCount = Math.max(0, (planQuery.data?.scopePreview.studyItemCount || 0) - (preview?.studyItemCount || 0));
  const textbookScopeMissingTracks = Boolean(scope?.cardTypes.includes('textbook_track') && !scope.textbookTrackIds?.length);
  const currentPreviewPlanRevision = previewQuery.data?.planRevision ?? planQuery.data?.plan?.revision ?? 0;
  const reviewRevisionStale = reviewPlanRevision !== null && currentPreviewPlanRevision !== reviewPlanRevision;
  const savedPlanSource = planQuery.data?.plan || (planQuery.data ? {
    scope: planQuery.data.defaults.scope,
    dailyActionGoal: planQuery.data.defaults.dailyActionGoal,
    dailyNewLimit: planQuery.data.defaults.dailyNewLimit,
  } : null);
  const savedPlanSignature = savedPlanSource
    ? planDraftSignature(
        savedPlanSource.scope,
        savedPlanSource.dailyActionGoal,
        savedPlanSource.dailyNewLimit,
        planQuery.data?.profile.timeZone || 'Asia/Tokyo'
      )
    : null;
  const currentPlanSignature = scope
    ? planDraftSignature(scope, dailyGoal, dailyNew, timeZone)
    : null;
  const planDirty = Boolean(savedPlanSignature && currentPlanSignature && savedPlanSignature !== currentPlanSignature);
  const planSaveState: WorkflowSaveState = saveMutation.isPending
    ? 'saving'
    : saveMutation.isError
      ? saveMutation.error instanceof ApiError && saveMutation.error.status === 409 ? 'conflict' : 'failed'
      : planDirty ? 'dirty' : 'clean';
  const leaveGuard = useLeaveGuard(planDirty && !saveMutation.isPending);
  const planStages = useMemo<WorkflowStageItem<LearningPlanStage>[]>(() => {
    if (saveMutation.isError) {
      return [
        { id: 'scope', label: '选择范围', state: 'complete' },
        { id: 'review', label: '检查影响', state: 'complete' },
        { id: 'apply', label: '保存计划', state: 'failed', reason: '保存失败，可在确认窗口重试。' },
      ];
    }
    if (saveMutation.isPending) {
      return [
        { id: 'scope', label: '选择范围', state: 'complete' },
        { id: 'review', label: '检查影响', state: 'complete' },
        { id: 'apply', label: '保存计划', state: 'current' },
      ];
    }
    if (confirmSave) {
      return [
        { id: 'scope', label: '选择范围', state: 'complete' },
        { id: 'review', label: '检查影响', state: 'current' },
        { id: 'apply', label: '保存计划', state: 'locked', reason: '确认影响后才能保存。' },
      ];
    }
    const reviewAvailable = Boolean(preview?.studyItemCount && !textbookScopeMissingTracks);
    return [
      { id: 'scope', label: '选择范围', state: 'current' },
      {
        id: 'review',
        label: '检查影响',
        state: reviewAvailable ? 'available' : 'locked',
        reason: reviewAvailable ? undefined : '先选择一个包含合格学习单元的范围。',
      },
      { id: 'apply', label: '保存计划', state: 'locked', reason: '检查影响后才能保存。' },
    ];
  }, [
    confirmSave,
    preview?.studyItemCount,
    saveMutation.isError,
    saveMutation.isPending,
    textbookScopeMissingTracks,
  ]);
  const availableTags = useMemo(
    () => (optionsQuery.data?.tags || []).filter((tag) => ['topic', 'fn', 'tag'].includes(tag.namespace)),
    [optionsQuery.data]
  );
  const matchingTags = useMemo(() => {
    const query = tagSearch.trim().toLocaleLowerCase();
    if (!query) return availableTags;
    return availableTags.filter((tag) => (
      `${tag.namespace}:${tag.value}`.toLocaleLowerCase().includes(query)
      || learningTagLabel(tag.namespace, tag.value).toLocaleLowerCase().includes(query)
    ));
  }, [availableTags, tagSearch]);
  const displayedTags = tagSearch.trim() || showAllTags ? matchingTags : matchingTags.slice(0, 8);
  const tagGroups = useMemo(() => (
    ['fn', 'topic', 'tag']
      .map((namespace) => ({
        namespace,
        tags: displayedTags.filter((tag) => tag.namespace === namespace),
      }))
      .filter((group) => group.tags.length > 0)
  ), [displayedTags]);
  const openSaveReview = () => {
    setReviewPlanRevision(currentPreviewPlanRevision);
    setConfirmSave(true);
  };
  const changeReviewField = (target: string) => {
    setConfirmSave(false);
    requestAnimationFrame(() => {
      const field = document.getElementById(target);
      field?.scrollIntoView({ block: 'center' });
      field?.querySelector<HTMLElement>('button, input, select')?.focus({ preventScroll: true });
    });
  };

  const initialPlanError = planQuery.isError && !planQuery.data;
  const initialOptionsError = optionsQuery.isError && !optionsQuery.data;
  if (initialPlanError || initialOptionsError) {
    return (
      <ProductShell active="plan" title="学习计划">
        <PageState
          variant="error"
          eyebrow="学习计划"
          title="学习计划暂时无法读取"
          description="现有计划没有被修改。重新读取成功后才能安全调整范围与每日负担。"
          actions={(
            <button
              className="primary"
              type="button"
              onClick={() => void Promise.all([planQuery.refetch(), optionsQuery.refetch()])}
            >
              重新读取
            </button>
          )}
          testId="learning-plan-load-error"
        />
      </ProductShell>
    );
  }

  if (planQuery.isLoading || optionsQuery.isLoading || !scope) {
    return (
      <ProductShell active="plan" title="学习计划">
        <PageState
          variant="loading"
          eyebrow="学习计划"
          title="正在读取学习计划"
          description="正在准备当前范围、每日目标和可选学习内容。"
          testId="learning-plan-loading"
        />
      </ProductShell>
    );
  }

  return (
    <ProductShell active="plan" title="学习计划">
      <div className="learning-page" data-testid="learning-plan-page">
        <PageHeader
          testId="plan-page-header"
          eyebrow={`学习计划 · 版本 ${planQuery.data?.plan?.revision || 0}`}
          title={planQuery.data?.plan ? '调整学习计划' : '建立你的学习计划'}
          description="一个活动计划控制范围与每日负担，历史状态不会因范围变化而丢失。"
          actions={(
            <>
              <SaveStatus state={planSaveState} />
              {planQuery.data?.plan ? (
                <button className="learning-secondary-button" type="button" onClick={() => planQuery.data?.plan?.status === 'paused' ? statusMutation.mutate('active') : setConfirmPause(true)}>
                  {planQuery.data.plan.status === 'paused' ? <><Play aria-hidden="true" /> 恢复计划</> : <><Pause aria-hidden="true" /> 暂停计划</>}
                </button>
              ) : null}
            </>
          )}
        />
        <DataRefreshStatus
          refreshing={(planQuery.isFetching || optionsQuery.isFetching) && !planQuery.isLoading && !optionsQuery.isLoading}
          failed={Boolean((planQuery.isError && planQuery.data) || (optionsQuery.isError && optionsQuery.data))}
          label="学习计划"
          onRetry={() => void Promise.all([planQuery.refetch(), optionsQuery.refetch()])}
          testId="learning-plan-refresh-status"
        />
        <div className="learning-plan-stage-nav">
          <StageNavigation
            items={planStages}
            onNavigate={(stage) => {
              if (stage === 'scope') {
                setConfirmSave(false);
                requestAnimationFrame(() => document.getElementById('learning-scope-card-types')?.scrollIntoView({ block: 'center' }));
              } else if (stage === 'review') {
                openSaveReview();
              }
            }}
          />
        </div>

        {notice && <div className="learning-banner danger" role="status">{notice}</div>}
        <div className="learning-plan-grid">
          <section className="surface learning-plan-form">
            <fieldset id="learning-scope-languages">
              <legend>学习语言方向</legend>
              <div className="learning-choice-row">
                {(['en', 'ja'] as const).map((language) => (
                  <button key={language} type="button" aria-pressed={scope.languages.includes(language)} className={scope.languages.includes(language) ? 'selected' : ''} onClick={() => toggleLanguage(language)}>
                    {scope.languages.includes(language) && <Check aria-hidden="true" />}{language === 'en' ? 'English' : 'Japanese'}
                  </button>
                ))}
              </div>
              {!scope.languages.includes('en') || !scope.languages.includes('ja') ? <p className="field-note">场景表达固定为 EN+JA，因此当前不会进入范围。</p> : null}
            </fieldset>

            <fieldset id="learning-scope-card-types">
              <legend>学习卡型</legend>
              <div className="learning-card-type-choices">
                {CARD_TYPES.map((type) => (
                  <button key={type.value} type="button" aria-pressed={scope.cardTypes.includes(type.value)} className={scope.cardTypes.includes(type.value) ? 'selected' : ''} onClick={() => toggleCardType(type.value)}>
                    <span>{scope.cardTypes.includes(type.value) && <Check aria-hidden="true" />}<strong>{type.label}</strong></span><small>{type.detail}</small>
                  </button>
                ))}
              </div>
            </fieldset>

            {scope.cardTypes.includes('textbook_track') && (
              <fieldset id="learning-scope-textbooks">
                <legend><BookOpen aria-hidden="true" /> 教材 Track</legend>
                <div className="learning-tag-list">
                  {textbookTracks.map((track) => {
                    const selected = Boolean(scope.textbookTrackIds?.includes(track.id));
                    return (
                      <button key={track.id} type="button" aria-pressed={selected} className={selected ? 'selected' : ''} onClick={() => toggleTextbookTrack(track.id)}>
                        Track {String(track.trackNumber).padStart(2, '0')} · {track.title}
                        <small>{track.courseTitle} · {track.studyItemCount} 单元</small>
                      </button>
                    );
                  })}
                  {!textbookTracks.length && <span className="field-note">还没有已发布的教材 Track。请先在教材课程中发布 Track。</span>}
                </div>
                {textbookTracks.length > 0 && !scope.textbookTrackIds?.length && <p className="field-note">已选择教材课程，但未选择任何 Track；保存前至少选择一个。</p>}
              </fieldset>
            )}

            <fieldset id="learning-scope-dates">
              <legend><CalendarRange aria-hidden="true" /> 日期范围</legend>
              <label className="learning-toggle"><input type="checkbox" checked={dateEnabled} onChange={(event) => {
                const enabled = event.target.checked;
                setDateEnabled(enabled);
                setScope({ ...scope, dateRange: enabled ? {
                  from: optionsQuery.data?.dateRange.min || new Date().toISOString().slice(0, 10),
                  to: optionsQuery.data?.dateRange.max || new Date().toISOString().slice(0, 10),
                } : null });
              }} /><span />限制日期</label>
              {dateEnabled && scope.dateRange && <div className="learning-date-row"><label>开始<input type="date" value={scope.dateRange.from} onChange={(event) => setScope({ ...scope, dateRange: { ...scope.dateRange!, from: event.target.value } })} /></label><label>结束<input type="date" value={scope.dateRange.to} onChange={(event) => setScope({ ...scope, dateRange: { ...scope.dateRange!, to: event.target.value } })} /></label></div>}
            </fieldset>

            <fieldset id="learning-scope-tags">
              <legend><Tags aria-hidden="true" /> 学习主题与功能</legend>
              <div className="learning-tag-toolbar">
                <input
                  type="search"
                  aria-label="搜索学习主题或功能"
                  placeholder="搜索主题或表达功能"
                  value={tagSearch}
                  onChange={(event) => setTagSearch(event.target.value)}
                />
                <span>{availableTags.length} 个可选</span>
              </div>
              <div className="learning-tag-groups">
                {tagGroups.map((group) => (
                  <section key={group.namespace} className="learning-tag-group">
                    <h3>{TAG_GROUP_LABELS[group.namespace]}</h3>
                    <div className="learning-tag-list">
                      {group.tags.map((tag) => {
                        const selected = scope.tags.some((item) => item.namespace === tag.namespace && item.value === tag.value);
                        return (
                          <button
                            key={`${tag.namespace}:${tag.value}`}
                            type="button"
                            title={`${tag.namespace}:${tag.value}`}
                            aria-pressed={selected}
                            className={selected ? 'selected' : ''}
                            onClick={() => toggleTag(tag.namespace, tag.value)}
                          >
                            {learningTagLabel(tag.namespace, tag.value)}
                            <small>{tag.generationCount}</small>
                          </button>
                        );
                      })}
                    </div>
                  </section>
                ))}
                {!matchingTags.length && (
                  <span className="field-note">
                    {availableTags.length ? '没有匹配的学习主题或功能。' : '当前没有可用于范围筛选的标签。'}
                  </span>
                )}
              </div>
              {!tagSearch.trim() && matchingTags.length > 8 && (
                <button
                  className="learning-tag-more"
                  type="button"
                  aria-expanded={showAllTags}
                  onClick={() => setShowAllTags((value) => !value)}
                >
                  {showAllTags ? '收起标签' : `显示全部 ${matchingTags.length} 个标签`}
                </button>
              )}
            </fieldset>

            <div className="learning-number-grid" id="learning-daily-limits">
              <label>每日行动目标 <small>已提交评分数</small><input type="number" min="5" max="100" value={dailyGoal} onChange={(event) => setDailyGoal(Math.min(100, Math.max(5, Number(event.target.value))))} /></label>
              <label>每日新单元上限 <small>0 = 只清到期项</small><input type="number" min="0" max="50" value={dailyNew} onChange={(event) => setDailyNew(Math.min(50, Math.max(0, Number(event.target.value))))} /></label>
            </div>
          </section>

          <aside className="surface learning-plan-preview">
            <p className="eyebrow">计划影响</p>
            <h2>当前范围预览</h2>
            <dl>
              <div><dt>合格卡片</dt><dd>{preview?.generationCount ?? '—'} 张</dd></div>
              <div><dt>展开学习单元</dt><dd>{preview?.studyItemCount ?? '—'} 个</dd></div>
              <div><dt>English 单元</dt><dd>{preview?.byKind.trilingual_en || 0}</dd></div>
              <div><dt>Japanese / 语法</dt><dd>{(preview?.byKind.trilingual_ja || 0) + (preview?.byKind.grammar_ja || 0)}</dd></div>
              <div><dt>场景表达</dt><dd>{preview?.byKind.scenario_bilingual || 0}</dd></div>
              <div><dt>教材课程</dt><dd>{(preview?.byKind.textbook_en || 0) + (preview?.byKind.textbook_ja || 0)}</dd></div>
              <div><dt>引入全部所需</dt><dd>{theoreticalDays ? `约 ${theoreticalDays} 学习日` : '只清到期'}</dd></div>
            </dl>
            {preview?.studyItemCount === 0 && <div className="learning-banner warning">当前组合没有合格学习单元。放宽语言、卡型、日期或标签范围。</div>}
            {theoreticalDays && theoreticalDays > 180 ? <div className="learning-banner info">当前范围较大。可以先缩小范围，学习状态会在将来扩展范围时继续沿用。</div> : null}
            <button className="learning-primary-button" type="button" disabled={saveMutation.isPending || previewQuery.isFetching || !preview?.studyItemCount || textbookScopeMissingTracks} onClick={openSaveReview}>
              <Save aria-hidden="true" /> {saveMutation.isPending ? '保存中…' : '检查并保存计划'}
            </button>
          </aside>
        </div>
      </div>

      {confirmSave && (
        <DialogSurface
          className="learning-plan-review-dialog"
          role="alertdialog"
          size="large"
          ariaLabel="确认学习计划"
          closeLabel="返回修改计划"
          busy={saveMutation.isPending}
          onClose={() => setConfirmSave(false)}
        >
          <ReviewSummary
              title={planQuery.data?.plan ? '确认学习计划调整' : '确认建立学习计划'}
              description="范围预览由服务端生成；保存后才会重建今日队列。"
              items={[
                {
                  id: 'scope',
                  label: '学习范围',
                  value: `${scope.languages.map((language) => language.toUpperCase()).join(' + ')} · ${scope.cardTypes.length} 种卡型`,
                  changeTarget: 'learning-scope-card-types',
                },
                {
                  id: 'items',
                  label: '学习单元',
                  value: `${preview?.studyItemCount || 0} 个`,
                  tone: 'success',
                },
                {
                  id: 'days',
                  label: '预计引入时间',
                  value: theoreticalDays ? `约 ${theoreticalDays} 学习日` : '只清到期项',
                  changeTarget: 'learning-daily-limits',
                },
                {
                  id: 'removed',
                  label: '移出当前范围',
                  value: `${removedItemCount} 个`,
                  tone: isReduction ? 'warning' : 'default',
                  changeTarget: 'learning-scope-card-types',
                },
                {
                  id: 'daily',
                  label: '每日新单元',
                  value: `${dailyNew} 个`,
                  changeTarget: 'learning-daily-limits',
                },
                {
                  id: 'textbooks',
                  label: '教材 Track',
                  value: `${scope.textbookTrackIds?.length || 0} 个`,
                  changeTarget: 'learning-scope-textbooks',
                },
              ]}
              warnings={[
                ...(isReduction ? [`${removedItemCount} 个单元将移出当前范围；历史与调度状态不会删除。`] : []),
                ...(reviewRevisionStale ? ['学习计划已经更新。请返回刷新并重新检查范围。'] : []),
              ]}
              actionLabel={`保存 ${preview?.studyItemCount || 0} 个单元并生成今日队列`}
              actionPendingLabel="正在保存计划并生成队列…"
              actionDisabled={saveMutation.isPending || reviewRevisionStale}
              actionPending={saveMutation.isPending}
              onAction={() => saveMutation.mutate()}
              onChange={changeReviewField}
            />
        </DialogSurface>
      )}
      {confirmPause && (
        <ConfirmDialog
          ariaLabel="确认暂停学习计划"
          title="暂停学习计划？"
          description="暂停后不再自动生成今日队列。所有复习状态和历史都会保留，恢复后继续安排。"
          cancelLabel="继续使用计划"
          confirmLabel="确认暂停"
          pendingLabel="正在暂停…"
          tone="warning"
          busy={statusMutation.isPending}
          onCancel={() => setConfirmPause(false)}
          onConfirm={() => statusMutation.mutate('paused')}
        />
      )}
      <LeaveGuardDialog
        guard={leaveGuard}
        description="学习范围或每日负担还有未保存修改。离开后将恢复到上次保存的计划；学习记录和调度状态不会被删除。"
      />
    </ProductShell>
  );
}
