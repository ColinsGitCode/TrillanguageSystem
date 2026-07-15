import { useEffect, useMemo, useState } from 'react';
import { BookOpen, CalendarRange, Check, Pause, Play, Save, Tags } from 'lucide-react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from 'react-router';
import { ProductShell } from '../../components/ProductShell';
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

function apiMessage(error: Error) {
  if (error instanceof ApiError && error.payload && typeof error.payload === 'object' && 'code' in error.payload) {
    const code = String((error.payload as { code?: string }).code || '');
    if (code === 'LEARNING_ACTIVE_SESSION_CONFLICT') return '请先结束当前复习会话，再修改学习计划。';
    if (code === 'LEARNING_PLAN_REVISION_CONFLICT') return '计划已在其它页面更新，请刷新后重试。';
  }
  return error.message;
}

export function LearningPlanPage() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const planQuery = useQuery({ queryKey: ['learning', 'plan'], queryFn: learningApi.plan });
  const optionsQuery = useQuery({ queryKey: ['learning', 'scope-options'], queryFn: learningApi.scopeOptions });
  const [scope, setScope] = useState<LearningScope | null>(null);
  const [dailyGoal, setDailyGoal] = useState(20);
  const [dailyNew, setDailyNew] = useState(5);
  const [timeZone, setTimeZone] = useState('Asia/Shanghai');
  const [dateEnabled, setDateEnabled] = useState(false);
  const [confirmSave, setConfirmSave] = useState(false);
  const [confirmPause, setConfirmPause] = useState(false);
  const [notice, setNotice] = useState('');

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
    setTimeZone(planQuery.data.profile.timeZone || 'Asia/Shanghai');
    setDateEnabled(Boolean(source.scope.dateRange));
  }, [planQuery.data, scope]);

  const previewQuery = useQuery({
    queryKey: ['learning', 'plan-preview', scope],
    queryFn: () => learningApi.previewPlan(scope as LearningScope),
    enabled: Boolean(scope),
    staleTime: 0,
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
    onError: (error) => setNotice(apiMessage(error)),
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
  const textbookScopeMissingTracks = Boolean(scope?.cardTypes.includes('textbook_track') && !scope.textbookTrackIds?.length);
  const visibleTags = useMemo(() => (optionsQuery.data?.tags || []).filter((tag) => ['topic', 'fn', 'tag'].includes(tag.namespace)).slice(0, 18), [optionsQuery.data]);

  if (planQuery.isLoading || !scope) {
    return <ProductShell active="plan" title="学习计划"><div className="learning-loading">正在读取学习计划…</div></ProductShell>;
  }

  return (
    <ProductShell active="plan" title="学习计划">
      <div className="learning-page" data-testid="learning-plan-page">
        <header className="learning-page-head">
          <div><p className="eyebrow">STUDY PLAN · REV {planQuery.data?.plan?.revision || 0}</p><h1>{planQuery.data?.plan ? '调整学习计划' : '建立你的学习计划'}</h1><p>一个活动计划控制范围与每日负担，历史状态不会因范围变化而丢失。</p></div>
          {planQuery.data?.plan && (
            <button className="learning-secondary-button" type="button" onClick={() => planQuery.data?.plan?.status === 'paused' ? statusMutation.mutate('active') : setConfirmPause(true)}>
              {planQuery.data.plan.status === 'paused' ? <><Play aria-hidden="true" /> 恢复计划</> : <><Pause aria-hidden="true" /> 暂停计划</>}
            </button>
          )}
        </header>

        {notice && <div className="learning-banner danger" role="status">{notice}</div>}
        <div className="learning-plan-grid">
          <section className="surface learning-plan-form">
            <fieldset>
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

            <fieldset>
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
              <fieldset>
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

            <fieldset>
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

            <fieldset>
              <legend><Tags aria-hidden="true" /> Active 标签</legend>
              <div className="learning-tag-list">
                {visibleTags.map((tag) => {
                  const selected = scope.tags.some((item) => item.namespace === tag.namespace && item.value === tag.value);
                  return <button key={`${tag.namespace}:${tag.value}`} type="button" aria-pressed={selected} className={selected ? 'selected' : ''} onClick={() => toggleTag(tag.namespace, tag.value)}>{tag.namespace}:{tag.value}<small>{tag.generationCount}</small></button>;
                })}
                {!visibleTags.length && <span className="field-note">当前没有可用于范围筛选的 Active 标签。</span>}
              </div>
            </fieldset>

            <div className="learning-number-grid">
              <label>每日行动目标 <small>已提交评分数</small><input type="number" min="5" max="100" value={dailyGoal} onChange={(event) => setDailyGoal(Math.min(100, Math.max(5, Number(event.target.value))))} /></label>
              <label>每日新单元上限 <small>0 = 只清到期项</small><input type="number" min="0" max="50" value={dailyNew} onChange={(event) => setDailyNew(Math.min(50, Math.max(0, Number(event.target.value))))} /></label>
            </div>
          </section>

          <aside className="surface learning-plan-preview">
            <p className="eyebrow">REAL-TIME SCOPE</p>
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
            <button className="learning-primary-button" type="button" disabled={saveMutation.isPending || previewQuery.isFetching || !preview?.studyItemCount || textbookScopeMissingTracks} onClick={() => isReduction ? setConfirmSave(true) : saveMutation.mutate()}>
              <Save aria-hidden="true" /> {saveMutation.isPending ? '保存中…' : '保存并生成今日队列'}
            </button>
          </aside>
        </div>
      </div>

      {confirmSave && <div className="learning-dialog-backdrop"><section className="surface learning-dialog" role="alertdialog" aria-modal="true" aria-label="确认修改学习范围"><h2>确认修改学习范围？</h2><p>将有 <strong>{Math.max(0, (planQuery.data?.scopePreview.studyItemCount || 0) - (preview?.studyItemCount || 0))}</strong> 个学习单元移出当前范围。既有复习状态与历史完整保留，恢复范围后继续排队。</p><div><button type="button" onClick={() => setConfirmSave(false)}>取消</button><button className="learning-primary-button" type="button" onClick={() => saveMutation.mutate()}>确认修改</button></div></section></div>}
      {confirmPause && <div className="learning-dialog-backdrop"><section className="surface learning-dialog" role="alertdialog" aria-modal="true" aria-label="确认暂停学习计划"><h2>暂停学习计划？</h2><p>暂停后不再自动生成今日队列。所有复习状态和历史都会保留，恢复后继续安排。</p><div><button type="button" onClick={() => setConfirmPause(false)}>取消</button><button className="learning-primary-button" type="button" onClick={() => statusMutation.mutate('paused')}>确认暂停</button></div></section></div>}
    </ProductShell>
  );
}
