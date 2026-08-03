import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useMutation, useQueries, useQuery, useQueryClient } from '@tanstack/react-query';
import { useSearchParams } from 'react-router';
import {
  AlertCircle,
  ArrowRight,
  BookOpenCheck,
  CheckCircle2,
  Clock3,
  Link2,
  Plus,
  Search,
  Sparkles,
} from 'lucide-react';
import { ProductShell } from '../../components/ProductShell';
import { PageHeader } from '../../components/PageHeader';
import { ConfirmDialog, DialogSurface } from '../../components/overlays';
import { DataRefreshStatus, PageState } from '../../components/states';
import {
  ContextTools,
  ReviewSummary,
  TaskWorkbench,
  type WorkflowTask,
  type WorkflowTaskState,
} from '../../components/workflow';
import { ApiError } from '../../lib/api/client';
import { learningApi } from '../learning/learning-api';
import type { StudyItem } from '../learning/types';
import { knowledgeApi } from './knowledge-api';
import type {
  KnowledgeKind,
  KnowledgeLanguage,
  KnowledgePointSummary,
  RecentKnowledgeLookup,
  ResolutionCase,
} from './types';

const DeferredManualTagBar = lazy(async () => {
  const module = await import('../manual-tags/ManualTagBar');
  return { default: module.ManualTagBar };
});

const languageLabels: Record<KnowledgeLanguage, string> = { en: 'English', ja: '日本語', zh: '中文' };
const kindLabels: Record<KnowledgeKind, string> = { lexeme: '词语', phrase: '短语', grammar_pattern: '语法' };
const formKindLabels = {
  canonical: '规范写法',
  'inflection-of': '活用形式',
  'polite-of': '礼貌表达',
} as const;
const evidenceSourceLabels = {
  generation: '学习卡',
  study_item: '复习内容',
  textbook_expression: '教材表达',
} as const;
const studyUnitLabels: Record<string, string> = {
  trilingual_en: '三语卡 · 英语',
  trilingual_ja: '三语卡 · 日语',
  grammar_ja: '日语语法',
  scenario_bilingual: '场景表达 · 英日',
  textbook_en: '教材课程 · 英语',
  textbook_ja: '教材课程 · 日语',
  whole_card: '完整卡片',
};
const resolutionFilters = [
  { id: 'all' as const, label: '全部' },
  { id: 'pending' as const, label: '待确认' },
];

function resolutionCaseLabel(caseKind: string) {
  if (caseKind === 'ambiguous-surface') return '同一写法可能对应多个词义';
  if (caseKind === 'no-safe-candidate') return '没有足够可靠的候选';
  if (caseKind === 'identity-conflict') return '知识点身份存在冲突';
  return '需要人工确认';
}

function candidateSourceLabel(source?: string, reason?: string) {
  if (source === 'llm-proposal') return 'AI 候选 · 尚未确认';
  if (source === 'user') return '人工提供的候选';
  return reason || '规则分析得到的候选';
}

function apiCode(error: unknown) {
  if (!(error instanceof ApiError) || !error.payload || typeof error.payload !== 'object') return '';
  return 'code' in error.payload ? String((error.payload as { code?: unknown }).code || '') : '';
}

function itemStatus(item: StudyItem, queued: boolean, intentStatus?: string) {
  if (intentStatus === 'completed') return '今日已学习';
  if (queued || intentStatus === 'active') return '已在今日队列';
  if (!item.scheduleState) return '尚未开始学习';
  return '可加入本次学习';
}

function recentLookupStatus(lookup: RecentKnowledgeLookup) {
  if (lookup.point || lookup.resolutionCase?.resolvedPointId) return '已归属';
  if (lookup.resolutionCase?.status === 'open') return '待确认';
  if (lookup.resolutionCase?.status === 'dismissed') return '已忽略';
  return '未解决';
}

function formatLookupTime(value: string) {
  return new Intl.DateTimeFormat('zh-CN', {
    month: 'numeric',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
    timeZone: 'Asia/Tokyo',
  }).format(new Date(value));
}

export function KnowledgePointsPage() {
  const [routeParams, setRouteParams] = useSearchParams();
  const routeCaseId = Number(routeParams.get('case'));
  const initialCaseId = Number.isInteger(routeCaseId) && routeCaseId > 0 ? routeCaseId : null;
  const queryClient = useQueryClient();
  const searchInputRef = useRef<HTMLInputElement>(null);
  const [query, setQuery] = useState('');
  const [language, setLanguage] = useState<KnowledgeLanguage>('ja');
  const [kind, setKind] = useState<KnowledgeKind>('lexeme');
  const [selectedPointId, setSelectedPointId] = useState<number | null>(null);
  const [resolutionMode, setResolutionMode] = useState(routeParams.get('mode') === 'resolution');
  const [selectedCaseId, setSelectedCaseId] = useState<number | null>(initialCaseId);
  const [resolutionFilter, setResolutionFilter] = useState<'all' | WorkflowTaskState>('all');
  const [resolutionSearch, setResolutionSearch] = useState('');
  const [resolutionForm, setResolutionForm] = useState({ canonicalForm: '', canonicalReading: '', senseDiscriminator: '' });
  const [resolutionReview, setResolutionReview] = useState<'resolve' | 'dismiss' | null>(null);
  const [resolutionError, setResolutionError] = useState('');
  const [confirmItem, setConfirmItem] = useState<StudyItem | null>(null);
  const [actionMessage, setActionMessage] = useState('');
  const resolutionAutoEntryRef = useRef(false);

  const availabilityQuery = useQuery({
    queryKey: ['knowledge', 'availability'],
    queryFn: () => knowledgeApi.search('__three_lans_probe__'),
    retry: false,
  });
  const searchQuery = useQuery({
    queryKey: ['knowledge', 'search', query.trim(), language, kind],
    queryFn: () => knowledgeApi.search(query.trim(), language, kind),
    enabled: availabilityQuery.isSuccess && query.trim().length > 0,
  });
  const pointQuery = useQuery({
    queryKey: ['knowledge', 'point', selectedPointId],
    queryFn: () => knowledgeApi.point(selectedPointId!),
    enabled: selectedPointId !== null,
  });
  const resolutionCasesQuery = useQuery({
    queryKey: ['knowledge', 'resolution-cases', 'open'],
    queryFn: () => knowledgeApi.resolutionCases('open'),
    enabled: availabilityQuery.isSuccess,
  });
  const recentLookupsQuery = useQuery({
    queryKey: ['knowledge', 'recent-lookups'],
    queryFn: () => knowledgeApi.recentLookups(8),
    enabled: availabilityQuery.isSuccess,
  });
  const resolutionCaseQuery = useQuery({
    queryKey: ['knowledge', 'resolution-case', selectedCaseId],
    queryFn: () => knowledgeApi.resolutionCase(selectedCaseId!),
    enabled: availabilityQuery.isSuccess && selectedCaseId !== null,
  });
  const planQuery = useQuery({ queryKey: ['learning', 'plan'], queryFn: learningApi.plan });
  const queueQuery = useQuery({ queryKey: ['learning', 'queue', 'today'], queryFn: learningApi.todayQueue });
  const intentsQuery = useQuery({
    queryKey: ['learning', 'manual-intents', 'today'],
    queryFn: learningApi.todayManualIntents,
  });

  const studyItemIds = useMemo(() => [...new Set(
    (pointQuery.data?.point.evidence || [])
      .filter((evidence) => evidence.sourceKind === 'study_item')
      .map((evidence) => evidence.sourceRefId)
  )], [pointQuery.data?.point.evidence]);
  const itemQueries = useQueries({
    queries: studyItemIds.map((id) => ({
      queryKey: ['learning', 'item', id],
      queryFn: () => learningApi.item(id),
      retry: false,
    })),
  });
  const studyItems = itemQueries
    .map((result) => result.data?.item)
    .filter((item): item is StudyItem => Boolean(item));
  const queuedItemIds = new Set((queueQuery.data?.queue?.entries || []).map((entry) => entry.studyItemId));
  const intentByItem = new Map((intentsQuery.data?.intents || []).map((intent) => [intent.studyItemId, intent]));
  const resolutionCases = resolutionCasesQuery.data?.resolutionCases || [];
  const recentLookups = recentLookupsQuery.data?.lookups || [];
  const selectedCase = resolutionCaseQuery.data?.resolutionCase
    || resolutionCases.find((item) => item.id === selectedCaseId)
    || null;
  const resolutionTasks = useMemo<WorkflowTask[]>(() => resolutionCases.map((item, index) => ({
    id: String(item.id),
    ordinal: index + 1,
    title: item.normalizedInput,
    summary: `${languageLabels[item.language]} · ${kindLabels[item.kindHint] || item.kindHint}`,
    state: 'pending',
    reasons: [resolutionCaseLabel(item.caseKind)],
    metadata: { revision: item.revision, caseKind: item.caseKind },
  })), [resolutionCases]);

  const openResolution = useCallback((caseId: number | null = null, replace = false) => {
    setResolutionMode(true);
    setSelectedPointId(null);
    setSelectedCaseId(caseId);
    setRouteParams((current) => {
      const next = new URLSearchParams(current);
      next.set('mode', 'resolution');
      if (caseId) next.set('case', String(caseId));
      else next.delete('case');
      return next;
    }, { replace });
  }, [setRouteParams]);

  const closeResolution = useCallback((replace = false) => {
    setResolutionMode(false);
    setSelectedCaseId(null);
    setRouteParams((current) => {
      const next = new URLSearchParams(current);
      next.delete('mode');
      next.delete('case');
      return next;
    }, { replace });
  }, [setRouteParams]);

  useEffect(() => {
    const routeMode = routeParams.get('mode') === 'resolution';
    const routeId = Number(routeParams.get('case'));
    setResolutionMode(routeMode);
    setSelectedCaseId(routeMode && Number.isInteger(routeId) && routeId > 0 ? routeId : null);
  }, [routeParams]);

  useEffect(() => {
    if (resolutionAutoEntryRef.current || !resolutionCasesQuery.isSuccess) return;
    resolutionAutoEntryRef.current = true;
    if (routeParams.get('mode') === 'resolution' || !resolutionCases.length) return;
    openResolution(resolutionCases[0].id, true);
  }, [openResolution, resolutionCases, resolutionCasesQuery.isSuccess, routeParams]);

  useEffect(() => {
    if (!resolutionMode || selectedCaseId || !resolutionCases.length) return;
    setSelectedCaseId(resolutionCases[0].id);
  }, [resolutionCases, resolutionMode, selectedCaseId]);

  useEffect(() => {
    if (!selectedCase) return;
    const preferred = selectedCase.candidates[0];
    setResolutionForm({
      canonicalForm: preferred?.canonicalForm || '',
      canonicalReading: preferred?.canonicalReading || selectedCase.normalizedInput,
      senseDiscriminator: '',
    });
    setResolutionError('');
  }, [selectedCase?.id, selectedCase?.revision]);

  const lookupMutation = useMutation({
    mutationFn: (point?: KnowledgePointSummary) => knowledgeApi.lookup({
      eventKey: `lookup:${crypto.randomUUID()}`,
      inputText: point?.canonicalForm || query.trim(),
      language: point?.language || language,
      kindHint: point?.kind || kind,
      timeZone: planQuery.data?.profile.timeZone || 'Asia/Tokyo',
    }),
    onSuccess: async (data) => {
      await queryClient.invalidateQueries({ queryKey: ['knowledge', 'recent-lookups'] });
      if (data.lookup.point) {
        setSelectedPointId(data.lookup.point.id);
        closeResolution(true);
      } else {
        openResolution(data.lookup.resolutionCase?.id || null, true);
      }
    },
  });
  const resolutionMutation = useMutation({
    mutationFn: ({ resolutionCase, action }: { resolutionCase: ResolutionCase; action: 'resolve' | 'dismiss' }) => (
      knowledgeApi.decideResolutionCase(resolutionCase.id, {
        eventKey: `resolution:${crypto.randomUUID()}`,
        action,
        revision: resolutionCase.revision,
        ...(action === 'resolve' ? {
          point: {
            kind: resolutionCase.kindHint,
            language: resolutionCase.language,
            canonicalForm: resolutionForm.canonicalForm.trim(),
            canonicalReading: resolutionForm.canonicalReading.trim(),
            senseDiscriminator: resolutionForm.senseDiscriminator.trim(),
          },
        } : {}),
        publicReason: action === 'resolve'
          ? 'User confirmed the canonical knowledge point in the unresolved workbench.'
          : 'User dismissed the unresolved case in the workbench.',
      })
    ),
    onSuccess: async (data) => {
      setResolutionReview(null);
      setResolutionError('');
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['knowledge', 'resolution-cases'] }),
        queryClient.invalidateQueries({ queryKey: ['knowledge', 'recent-lookups'] }),
        queryClient.invalidateQueries({ queryKey: ['knowledge', 'search'] }),
      ]);
      if (data.point) {
        setSelectedPointId(data.point.id);
        closeResolution(true);
        setActionMessage('待确认项已归属到知识点；学习调度状态没有被修改。');
      } else {
        closeResolution(true);
        setActionMessage('待确认项已忽略；历史 lookup 事实保持不变。');
      }
    },
    onError: async (error) => {
      const code = apiCode(error);
      setResolutionError(code === 'KG_RESOLUTION_STALE'
        ? '该待确认项已在其它页面更新。请刷新候选后重新确认。'
        : error instanceof Error ? error.message : '暂时无法保存裁决。');
      if (code === 'KG_RESOLUTION_STALE') {
        await queryClient.invalidateQueries({ queryKey: ['knowledge', 'resolution-case'] });
        await queryClient.invalidateQueries({ queryKey: ['knowledge', 'resolution-cases'] });
      }
    },
  });
  const addMutation = useMutation({
    mutationFn: (item: StudyItem) => learningApi.addManualIntent({
      intentKey: `manual:${crypto.randomUUID()}`,
      studyItemId: item.id,
      confirmed: true,
    }),
    onSuccess: async (data) => {
      setConfirmItem(null);
      setActionMessage(data.alreadyQueued ? '该学习单元已在今日队列。' : '已加入本次学习，不会改动原计划范围。');
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['learning', 'queue', 'today'] }),
        queryClient.invalidateQueries({ queryKey: ['learning', 'manual-intents', 'today'] }),
      ]);
    },
    onError: (error) => {
      setConfirmItem(null);
      const code = apiCode(error);
      setActionMessage(code === 'LEARNING_MANUAL_INTENT_ALREADY_REVIEWED_TODAY'
        ? '这个单元今天已经学习过。'
        : code === 'LEARNING_MANUAL_INTENT_LIMIT_REACHED'
          ? '今天的额外学习容量已满。'
          : error instanceof Error ? error.message : '暂时无法加入本次学习。');
    },
  });

  const featureDisabled = availabilityQuery.isError && apiCode(availabilityQuery.error) === 'KG_FEATURE_DISABLED';
  const point = pointQuery.data?.point || null;
  const submitLookup = (event: React.FormEvent) => {
    event.preventDefault();
    if (query.trim() && !lookupMutation.isPending) lookupMutation.mutate(undefined);
  };
  const resumeRecentLookup = (lookup: RecentKnowledgeLookup) => {
    setQuery(lookup.inputText);
    setLanguage(lookup.language);
    setKind(lookup.kindHint);
    setActionMessage('');
    const resolvedPointId = lookup.point?.id || lookup.resolutionCase?.resolvedPointId || null;
    if (resolvedPointId) {
      setSelectedPointId(resolvedPointId);
      closeResolution(true);
      return;
    }
    if (lookup.resolutionCase?.status === 'open') {
      openResolution(lookup.resolutionCase.id, true);
      return;
    }
    setSelectedPointId(null);
    closeResolution(true);
    setActionMessage('这条历史查找已结束。你可以修改内容后重新查找。');
    searchInputRef.current?.focus();
  };

  return (
    <ProductShell active="knowledge" title="知识点查找">
      <div className="knowledge-page" data-testid="knowledge-points-page">
        <PageHeader
          className="surface knowledge-command-bar"
          testId="knowledge-page-header"
          eyebrow="知识点查找 · 明确查询"
          title="知识点查找"
          description="查找会帮助系统识别需要加强的内容，但不会直接改变复习时间。"
          actions={<form onSubmit={submitLookup}>
            <div className="knowledge-command-meta">
              <div className="knowledge-segments" aria-label="查找语言">
                {(Object.keys(languageLabels) as KnowledgeLanguage[]).map((value) => (
                  <button type="button" disabled={!availabilityQuery.isSuccess} aria-pressed={language === value} className={language === value ? 'selected' : ''} key={value} onClick={() => setLanguage(value)}>{languageLabels[value]}</button>
                ))}
              </div>
              <button
                className={resolutionMode ? 'knowledge-resolution-trigger selected' : 'knowledge-resolution-trigger'}
                type="button"
                disabled={!availabilityQuery.isSuccess}
                aria-pressed={resolutionMode}
                onClick={() => openResolution(resolutionCases[0]?.id || null)}
              >
                待确认 <span>{resolutionCases.length}</span>
              </button>
            </div>
            <label>
              <Search aria-hidden="true" />
              <input ref={searchInputRef} value={query} disabled={!availabilityQuery.isSuccess} onChange={(event) => setQuery(event.target.value)} placeholder="输入词语、短语或语法…" autoComplete="off" />
              <select value={kind} disabled={!availabilityQuery.isSuccess} onChange={(event) => setKind(event.target.value as KnowledgeKind)} aria-label="知识点类型">
                {(Object.keys(kindLabels) as KnowledgeKind[]).map((value) => <option key={value} value={value}>{kindLabels[value]}</option>)}
              </select>
              <button type="submit" disabled={!availabilityQuery.isSuccess || !query.trim() || lookupMutation.isPending}>{lookupMutation.isPending ? '查找中…' : '查找'}</button>
            </label>
          </form>}
        />

        {availabilityQuery.isLoading && !availabilityQuery.data ? (
          <PageState
            variant="loading"
            eyebrow="知识点查找"
            title="正在读取知识点工作台"
            description="正在读取查找能力、近期活动和待确认数量。"
            testId="knowledge-availability-loading"
          />
        ) : featureDisabled ? (
          <PageState
            variant="unavailable"
            eyebrow="知识点查找"
            title="当前工作区未开放知识点查找"
            description="Cards Factory 与学习复习仍可正常使用。"
            testId="knowledge-availability-disabled"
          />
        ) : availabilityQuery.isError ? (
          <PageState
            variant="error"
            eyebrow="知识点查找"
            title="知识点服务暂时无法读取"
            description="学习调度会继续按基础策略运行，现有知识点和查找记录没有被修改。"
            actions={<button className="primary" type="button" onClick={() => void availabilityQuery.refetch()}>重新读取</button>}
            testId="knowledge-availability-error"
          />
        ) : resolutionMode ? (
          <section className="surface knowledge-resolution-workflow" data-testid="knowledge-resolution-workbench">
            <TaskWorkbench
              storageKey="knowledge-resolution"
              tasks={resolutionTasks}
              activeId={selectedCaseId ? String(selectedCaseId) : null}
              filter={resolutionFilter}
              onFilter={setResolutionFilter}
              onSelect={(id) => openResolution(Number(id), true)}
              query={resolutionSearch}
              onQuery={setResolutionSearch}
              searchPlaceholder="搜索待确认项"
              filterOptions={resolutionFilters}
              stateLabels={{ pending: '待确认' }}
              tools={(
                <ContextTools
                  title="判断依据"
                  sections={selectedCase ? [
                    {
                      label: '候选',
                      value: selectedCase.candidates.length ? (
                        <ul>{selectedCase.candidates.map((candidate, index) => (
                          <li key={`${candidate.canonicalForm || 'candidate'}-${index}`}>
                            <strong>{candidate.canonicalForm || '未命名候选'}</strong>
                            {candidate.canonicalReading && <span>{candidate.canonicalReading}</span>}
                            <small>{candidateSourceLabel(candidate.source, candidate.reason)}</small>
                          </li>
                        ))}</ul>
                      ) : <p>确定性分析没有生成可安全接受的候选。</p>,
                    },
                    {
                      label: '词形',
                      value: <p><strong>{selectedCase.normalizedInput}</strong><br />{languageLabels[selectedCase.language]} · {kindLabels[selectedCase.kindHint]}</p>,
                    },
                    {
                      label: '来源',
                      value: <p>{selectedCase.evidenceId ? `来源记录 #${selectedCase.evidenceId}` : '这个待确认项来自一次主动查找，没有对应的卡片来源。'}</p>,
                    },
                    {
                      label: '记录',
                      value: <p>确认事项 #{selectedCase.id}<br />版本 {selectedCase.revision}<br />{resolutionCaseLabel(selectedCase.caseKind)}</p>,
                    },
                  ] : []}
                />
              )}
            >
              {!selectedCase ? (
                resolutionCasesQuery.isLoading && !resolutionCasesQuery.data ? (
                  <PageState
                    variant="loading"
                    title="正在读取待确认项"
                    description="正在恢复需要人工确认的知识点。"
                    compact
                    testId="knowledge-resolution-loading"
                  />
                ) : resolutionCasesQuery.isError && !resolutionCasesQuery.data ? (
                  <PageState
                    variant="error"
                    title="待确认项暂时无法读取"
                    description="现有裁决记录没有被修改。"
                    actions={<button className="primary" type="button" onClick={() => void resolutionCasesQuery.refetch()}>重新读取</button>}
                    compact
                    testId="knowledge-resolution-error"
                  />
                ) : (
                  <div className="knowledge-placeholder">
                    <AlertCircle aria-hidden="true" />
                    <h2>没有待确认项</h2>
                    <p>确定性规则无法安全归属的输入会出现在这里。</p>
                    <button type="button" onClick={() => closeResolution()}>返回知识点查找</button>
                  </div>
                )
              ) : (
                <div className="knowledge-resolution-editor">
                  <header>
                    <div><p className="eyebrow">待确认 · 版本 {selectedCase.revision}</p><h2>{selectedCase.normalizedInput}</h2><p>系统不会自动采用候选结果，只有人工确认后才会建立正式知识点。</p></div>
                    <button type="button" onClick={() => closeResolution()}>返回查找</button>
                  </header>
                  {resolutionError && <div className="knowledge-resolution-error" role="alert">{resolutionError}</div>}
                  {selectedCase.candidates.length > 0 && (
                    <section>
                      <h3>候选身份</h3>
                      <div className="knowledge-candidate-grid">
                        {selectedCase.candidates.map((candidate, index) => (
                          <button
                            key={`${candidate.canonicalForm || 'candidate'}-${index}`}
                            type="button"
                            onClick={() => setResolutionForm({
                              canonicalForm: candidate.canonicalForm || '',
                              canonicalReading: candidate.canonicalReading || '',
                              senseDiscriminator: '',
                            })}
                          >
                            <strong>{candidate.canonicalForm || '未命名候选'}</strong>
                            <span>{candidate.canonicalReading || '无读音'}</span>
                            <small>{candidateSourceLabel(candidate.source, candidate.reason)}</small>
                          </button>
                        ))}
                      </div>
                    </section>
                  )}
                  <fieldset>
                    <legend>人工确认的知识点身份</legend>
                    <label>规范形<input value={resolutionForm.canonicalForm} onChange={(event) => setResolutionForm({ ...resolutionForm, canonicalForm: event.target.value })} placeholder="例如：橋" /></label>
                    <label>读音<input value={resolutionForm.canonicalReading} onChange={(event) => setResolutionForm({ ...resolutionForm, canonicalReading: event.target.value })} placeholder="例如：はし" /></label>
                    <label>义项标识（可选）<input value={resolutionForm.senseDiscriminator} onChange={(event) => setResolutionForm({ ...resolutionForm, senseDiscriminator: event.target.value })} placeholder="仅在需要区分同形义项时填写" /></label>
                  </fieldset>
                  <div className="knowledge-resolution-boundary">
                    <strong>当前操作范围</strong>
                    <p>同一个写法若要拆成多个词义，或把多个知识点合并，需要使用专门的身份调整流程。这里仅确认或忽略当前候选。</p>
                  </div>
                  <footer>
                    <button type="button" onClick={() => setResolutionReview('dismiss')}>忽略此项</button>
                    <button type="button" className="primary" disabled={!resolutionForm.canonicalForm.trim()} onClick={() => setResolutionReview('resolve')}>检查并确认归属</button>
                  </footer>
                </div>
              )}
            </TaskWorkbench>
          </section>
        ) : (
          <div className="knowledge-workbench">
            <aside className="surface knowledge-results">
              <header>
                <p className="eyebrow">{query.trim() ? '匹配结果' : '近期活动'}</p>
                <h2>{query.trim() ? '匹配结果' : '最近查找'}</h2>
                <span>{query.trim() ? searchQuery.data?.results.length || 0 : recentLookups.length}</span>
              </header>
              {!query.trim() && recentLookupsQuery.isLoading && !recentLookupsQuery.data && (
                <PageState variant="loading" title="正在读取最近查找" description="正在恢复可继续的查找记录。" compact />
              )}
              {!query.trim() && recentLookupsQuery.isError && !recentLookupsQuery.data && (
                <PageState
                  variant="error"
                  title="最近查找暂时无法读取"
                  description="历史记录没有被修改。"
                  actions={<button className="primary" type="button" onClick={() => void recentLookupsQuery.refetch()}>重试</button>}
                  compact
                  testId="knowledge-recent-error"
                />
              )}
              {!query.trim() && Boolean(recentLookupsQuery.data) && (
                <DataRefreshStatus
                  refreshing={recentLookupsQuery.isFetching && !recentLookupsQuery.isLoading}
                  failed={recentLookupsQuery.isError}
                  label="最近查找"
                  onRetry={() => void recentLookupsQuery.refetch()}
                  compact
                />
              )}
              {!query.trim() && !recentLookupsQuery.isLoading && !recentLookupsQuery.isError && recentLookups.length === 0 && (
                <div className="knowledge-recent-empty">
                  <Clock3 aria-hidden="true" />
                  <strong>还没有查找记录</strong>
                  <p>首次查找后，可以从这里继续上次内容。</p>
                </div>
              )}
              {query.trim() && searchQuery.isLoading && !searchQuery.data && <PageState variant="loading" title="正在匹配" description="正在查找规范形和相关词形。" compact />}
              {query.trim() && searchQuery.isError && !searchQuery.data && (
                <PageState
                  variant="error"
                  title="匹配结果暂时无法读取"
                  description="可以重试搜索，或稍后重新提交明确查找。"
                  actions={<button className="primary" type="button" onClick={() => void searchQuery.refetch()}>重试</button>}
                  compact
                  testId="knowledge-search-error"
                />
              )}
              {query.trim() && Boolean(searchQuery.data) && (
                <DataRefreshStatus
                  refreshing={searchQuery.isFetching && !searchQuery.isLoading}
                  failed={searchQuery.isError}
                  label="匹配结果"
                  onRetry={() => void searchQuery.refetch()}
                  compact
                />
              )}
              {query.trim() && !searchQuery.isError && searchQuery.data?.results.length === 0 && <div className="knowledge-placeholder"><Sparkles aria-hidden="true" /><p>没有现成知识点。提交查找可按确定性规则创建或进入待确认。</p></div>}
              <div className="knowledge-result-list">
                {!query.trim() && recentLookups.map((lookup) => (
                  <button
                    key={lookup.id}
                    type="button"
                    data-testid={`knowledge-recent-${lookup.id}`}
                    onClick={() => resumeRecentLookup(lookup)}
                  >
                    <span>{languageLabels[lookup.language]} · {kindLabels[lookup.kindHint]} · {recentLookupStatus(lookup)}</span>
                    <strong>{lookup.inputText}</strong>
                    <small>{formatLookupTime(lookup.occurredAtUtc)}</small>
                  </button>
                ))}
                {query.trim() && (searchQuery.data?.results || []).map((result) => (
                  <button
                    key={result.id}
                    type="button"
                    className={selectedPointId === result.id ? 'selected' : ''}
                    onClick={() => {
                      setSelectedPointId(result.id);
                      closeResolution(true);
                    }}
                  >
                    <span>{languageLabels[result.language]} · {kindLabels[result.kind]}</span>
                    <strong>{result.canonicalForm}</strong>
                    {result.canonicalReading && <small>{result.canonicalReading}</small>}
                  </button>
                ))}
              </div>
            </aside>

            <main className="surface knowledge-point-panel">
              {!point && !query.trim() && (
                <div className="knowledge-start-state" data-testid="knowledge-start-state">
                  <Search aria-hidden="true" />
                  <p className="eyebrow">开始一次明确查找</p>
                  <h2>{recentLookups.length ? '继续查找一个知识点' : '查找第一个知识点'}</h2>
                  <p>输入一个英文或日文词语、短语或语法。系统会显示规范形、相关词形和出现证据，但不会直接改变复习时间。</p>
                  <div>
                    <button type="button" className="primary" onClick={() => searchInputRef.current?.focus()}>开始查找</button>
                    {resolutionCases.length > 0 && (
                      <button
                        type="button"
                        onClick={() => openResolution(resolutionCases[0]?.id || null)}
                      >
                        处理 {resolutionCases.length} 个待确认项
                      </button>
                    )}
                  </div>
                </div>
              )}
              {!point && query.trim() && <div className="knowledge-placeholder"><BookOpenCheck aria-hidden="true" /><h2>选择或提交一个知识点</h2><p>这里会显示规范形、相关词形和来源证据。</p></div>}
              {point && (
                <>
                  <header className="knowledge-point-head">
                    <div><p className="eyebrow">{languageLabels[point.language]} · {kindLabels[point.kind]}</p><h2>{point.canonicalForm}</h2>{point.canonicalReading && <p>{point.canonicalReading}</p>}</div>
                    <div className="knowledge-stat-row"><span><b>{point.stats?.reviewEventCount || 0}</b>复习</span><span><b>{point.stats?.explicitLookupCount30d || 0}</b>近 30 天查找</span><span><b>{point.stats?.studyItemCount || 0}</b>学习单元</span></div>
                  </header>
                  <Suspense fallback={null}><DeferredManualTagBar targetKind="knowledge_point" targetId={point.id} compact /></Suspense>
                  <section className="knowledge-forms"><h3>相关词形</h3><div>{point.forms.map((form) => <span key={`${form.id}-${form.linkKind}`}><b>{form.text}</b><small>{formKindLabels[form.linkKind]}</small></span>)}</div></section>
                  <section className="knowledge-evidence"><h3>出现位置</h3>{point.evidence.length ? point.evidence.map((evidence) => <article key={evidence.id}><span>{evidenceSourceLabels[evidence.sourceKind]}</span><p>{evidence.sourceText}</p><small>{evidence.evidenceRole === 'primary' ? '主要内容' : '上下文内容'}</small></article>) : <p>暂无内容来源。</p>}</section>
                </>
              )}
            </main>

            <aside className="surface knowledge-learning-panel">
              <header><p className="eyebrow">学习操作</p><h2>加入本次学习</h2><span>{intentsQuery.data?.capacity.remaining ?? 0} 可用</span></header>
              {actionMessage && <div className="knowledge-action-message"><CheckCircle2 aria-hidden="true" />{actionMessage}</div>}
              {!point && <div className="knowledge-placeholder"><Link2 aria-hidden="true" /><h2>学习连接</h2><p>选中已归属的知识点后，这里显示可加入本次学习的来源单元。待确认内容不会进入学习队列。</p></div>}
              {point && studyItemIds.length === 0 && <div className="knowledge-placeholder"><Link2 aria-hidden="true" /><p>这个知识点暂未关联可复习内容。</p></div>}
              <div className="knowledge-item-list">
                {studyItems.map((item) => {
                  const intent = intentByItem.get(item.id);
                  const queued = queuedItemIds.has(item.id);
                  const status = itemStatus(item, queued, intent?.status);
                  const canAdd = Boolean(planQuery.data?.plan?.status === 'active' && item.scheduleState && !queued && !intent);
                  return (
                    <article key={item.id}>
                      <div><span>{studyUnitLabels[item.unitKind] || '学习内容'}</span><strong>{item.source.title}</strong><small>{item.scheduleState ? `下次到期 ${new Date(item.scheduleState.dueAtUtc).toLocaleDateString('zh-CN')}` : '尚未开始复习'}</small></div>
                      <button type="button" disabled={!canAdd} onClick={() => setConfirmItem(item)}>{canAdd ? <><Plus aria-hidden="true" />加入</> : status}</button>
                    </article>
                  );
                })}
              </div>
              {(queueQuery.data?.queue || intentsQuery.data?.intents.length) ? <a className="knowledge-open-learning" href="/learn"><Clock3 aria-hidden="true" />查看今日学习<ArrowRight aria-hidden="true" /></a> : null}
            </aside>
          </div>
        )}
      </div>

      {resolutionReview && selectedCase && (
        <DialogSurface
          className="knowledge-resolution-review"
          role="alertdialog"
          size="large"
          ariaLabel="确认知识点裁决"
          closeLabel="返回待确认项"
          busy={resolutionMutation.isPending}
          onClose={() => setResolutionReview(null)}
        >
          <ReviewSummary
              title={resolutionReview === 'resolve' ? '确认知识点归属' : '确认忽略待确认项'}
              description="此操作只保存本次人工决定并更新知识点状态，不会改变复习安排或学习计划。"
              items={[
                { id: 'input', label: '待确认输入', value: selectedCase.normalizedInput },
                { id: 'identity', label: '目标身份', value: resolutionReview === 'resolve' ? resolutionForm.canonicalForm : '不归属' },
                { id: 'language', label: '语言 / 类型', value: `${languageLabels[selectedCase.language]} · ${kindLabels[selectedCase.kindHint]}` },
                { id: 'revision', label: '确认项版本', value: selectedCase.revision },
                { id: 'candidates', label: '候选数量', value: selectedCase.candidates.length },
                { id: 'effect', label: '复习影响', value: '不改变复习安排', tone: 'success' },
              ]}
              warnings={[
                '原始查找记录保持不变，本次人工决定会作为一条新记录保存。',
                ...(selectedCase.candidates.some((candidate) => candidate.source === 'llm-proposal')
                  ? ['存在 AI 候选；只有这次人工选择会成为正式结果。']
                  : []),
              ]}
              actionLabel={resolutionReview === 'resolve' ? `确认归属为 ${resolutionForm.canonicalForm}` : '确认忽略此项'}
              actionPendingLabel="正在保存人工裁决…"
              actionDisabled={resolutionMutation.isPending || (resolutionReview === 'resolve' && !resolutionForm.canonicalForm.trim())}
              actionPending={resolutionMutation.isPending}
              onAction={() => resolutionMutation.mutate({ resolutionCase: selectedCase, action: resolutionReview })}
            />
        </DialogSurface>
      )}

      {confirmItem && (
        <ConfirmDialog
          ariaLabel="加入本次学习"
          title="加入本次学习？"
          description={<p><strong>{confirmItem.source.title}</strong> 将只加入今天的队列，不修改学习计划范围，也不会立即改变后续复习日期。</p>}
          cancelLabel="暂不加入"
          confirmLabel="确认加入"
          pendingLabel="正在加入…"
          busy={addMutation.isPending}
          onCancel={() => setConfirmItem(null)}
          onConfirm={() => addMutation.mutate(confirmItem)}
        />
      )}
    </ProductShell>
  );
}
