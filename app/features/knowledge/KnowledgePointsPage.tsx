import { useEffect, useMemo, useState } from 'react';
import { useMutation, useQueries, useQuery, useQueryClient } from '@tanstack/react-query';
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
  X,
} from 'lucide-react';
import { ProductShell } from '../../components/ProductShell';
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
import type { KnowledgeKind, KnowledgeLanguage, KnowledgePointSummary, ResolutionCase } from './types';

const languageLabels: Record<KnowledgeLanguage, string> = { en: 'English', ja: '日本語', zh: '中文' };
const kindLabels: Record<KnowledgeKind, string> = { lexeme: '词语', phrase: '短语', grammar_pattern: '语法' };

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

export function KnowledgePointsPage() {
  const queryClient = useQueryClient();
  const [query, setQuery] = useState('');
  const [language, setLanguage] = useState<KnowledgeLanguage>('ja');
  const [kind, setKind] = useState<KnowledgeKind>('lexeme');
  const [selectedPointId, setSelectedPointId] = useState<number | null>(null);
  const [resolutionMode, setResolutionMode] = useState(false);
  const [selectedCaseId, setSelectedCaseId] = useState<number | null>(null);
  const [resolutionFilter, setResolutionFilter] = useState<'all' | WorkflowTaskState>('all');
  const [resolutionForm, setResolutionForm] = useState({ canonicalForm: '', canonicalReading: '', senseDiscriminator: '' });
  const [resolutionReview, setResolutionReview] = useState<'resolve' | 'dismiss' | null>(null);
  const [resolutionError, setResolutionError] = useState('');
  const [confirmItem, setConfirmItem] = useState<StudyItem | null>(null);
  const [actionMessage, setActionMessage] = useState('');

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
  const selectedCase = resolutionCaseQuery.data?.resolutionCase
    || resolutionCases.find((item) => item.id === selectedCaseId)
    || null;
  const resolutionTasks = useMemo<WorkflowTask[]>(() => resolutionCases.map((item, index) => ({
    id: String(item.id),
    ordinal: index + 1,
    title: item.normalizedInput,
    summary: `${languageLabels[item.language]} · ${kindLabels[item.kindHint] || item.kindHint}`,
    state: 'needs_attention',
    reasons: [item.caseKind],
    metadata: { revision: item.revision, caseKind: item.caseKind },
  })), [resolutionCases]);

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
    onSuccess: (data) => {
      if (data.lookup.point) {
        setSelectedPointId(data.lookup.point.id);
        setResolutionMode(false);
        setSelectedCaseId(null);
      } else {
        setSelectedPointId(null);
        setSelectedCaseId(data.lookup.resolutionCase?.id || null);
        setResolutionMode(true);
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
        queryClient.invalidateQueries({ queryKey: ['knowledge', 'search'] }),
      ]);
      if (data.point) {
        setSelectedPointId(data.point.id);
        setResolutionMode(false);
        setSelectedCaseId(null);
        setActionMessage('待确认项已归属到知识点；学习调度状态没有被修改。');
      } else {
        setSelectedCaseId(null);
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

  return (
    <ProductShell active="knowledge" title="知识点查找">
      <div className="knowledge-page" data-testid="knowledge-points-page">
        <header className="surface knowledge-command-bar">
          <div>
            <p className="eyebrow">KNOWLEDGE POINTS · EXPLICIT LOOKUP</p>
            <h1>知识点查找</h1>
            <p>查找行为会成为学习信号，但不会直接改写 FSRS 调度。</p>
          </div>
          <form onSubmit={submitLookup}>
            <div className="knowledge-command-meta">
              <div className="knowledge-segments" aria-label="查找语言">
                {(Object.keys(languageLabels) as KnowledgeLanguage[]).map((value) => (
                  <button type="button" aria-pressed={language === value} className={language === value ? 'selected' : ''} key={value} onClick={() => setLanguage(value)}>{languageLabels[value]}</button>
                ))}
              </div>
              <button
                className={resolutionMode ? 'knowledge-resolution-trigger selected' : 'knowledge-resolution-trigger'}
                type="button"
                aria-pressed={resolutionMode}
                onClick={() => {
                  setResolutionMode(true);
                  setSelectedPointId(null);
                }}
              >
                待确认 <span>{resolutionCases.length}</span>
              </button>
            </div>
            <label>
              <Search aria-hidden="true" />
              <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="输入词语、短语或语法…" autoComplete="off" />
              <select value={kind} onChange={(event) => setKind(event.target.value as KnowledgeKind)} aria-label="知识点类型">
                {(Object.keys(kindLabels) as KnowledgeKind[]).map((value) => <option key={value} value={value}>{kindLabels[value]}</option>)}
              </select>
              <button type="submit" disabled={!query.trim() || lookupMutation.isPending}>{lookupMutation.isPending ? '查找中…' : '查找'}</button>
            </label>
          </form>
        </header>

        {featureDisabled ? (
          <section className="surface knowledge-disabled">
            <AlertCircle aria-hidden="true" />
            <p className="eyebrow">FEATURE FLAG OFF</p>
            <h2>知识点功能尚未启用</h2>
            <p>KG-P3 已接入，但当前运行环境仍保持 `KG_ENABLED=0`。Cards Factory 与学习复习不受影响。</p>
          </section>
        ) : availabilityQuery.isError ? (
          <section className="surface knowledge-disabled"><AlertCircle aria-hidden="true" /><h2>知识点服务暂时不可用</h2><p>请稍后重试，学习调度会继续按基础策略运行。</p></section>
        ) : resolutionMode ? (
          <section className="surface knowledge-resolution-workflow" data-testid="knowledge-resolution-workbench">
            <TaskWorkbench
              tasks={resolutionTasks}
              activeId={selectedCaseId ? String(selectedCaseId) : null}
              filter={resolutionFilter}
              onFilter={setResolutionFilter}
              onSelect={(id) => setSelectedCaseId(Number(id))}
              tools={(
                <ContextTools
                  title="裁决上下文"
                  sections={selectedCase ? [
                    {
                      label: '候选',
                      value: selectedCase.candidates.length ? (
                        <ul>{selectedCase.candidates.map((candidate, index) => (
                          <li key={`${candidate.canonicalForm || 'candidate'}-${index}`}>
                            <strong>{candidate.canonicalForm || '未命名候选'}</strong>
                            {candidate.canonicalReading && <span>{candidate.canonicalReading}</span>}
                            <small>{candidate.source === 'llm-proposal' ? 'AI proposal · 未接受' : candidate.reason || '候选证据'}</small>
                          </li>
                        ))}</ul>
                      ) : <p>确定性分析没有生成可安全接受的候选。</p>,
                    },
                    {
                      label: '词形',
                      value: <p><strong>{selectedCase.normalizedInput}</strong><br />{languageLabels[selectedCase.language]} · {kindLabels[selectedCase.kindHint]}</p>,
                    },
                    {
                      label: '证据',
                      value: <p>{selectedCase.evidenceId ? `Evidence #${selectedCase.evidenceId}` : '本案例来自显式 lookup，没有内容 Evidence。'}</p>,
                    },
                    {
                      label: '审计',
                      value: <p>Case #{selectedCase.id}<br />Revision {selectedCase.revision}<br />{selectedCase.caseKind}</p>,
                    },
                  ] : []}
                />
              )}
            >
              {!selectedCase ? (
                <div className="knowledge-placeholder">
                  <AlertCircle aria-hidden="true" />
                  <h2>{resolutionCasesQuery.isLoading ? '正在读取待确认项…' : '没有待确认项'}</h2>
                  <p>确定性规则无法安全归属的输入会出现在这里。</p>
                  <button type="button" onClick={() => setResolutionMode(false)}>返回知识点查找</button>
                </div>
              ) : (
                <div className="knowledge-resolution-editor">
                  <header>
                    <div><p className="eyebrow">UNRESOLVED · REV {selectedCase.revision}</p><h2>{selectedCase.normalizedInput}</h2><p>只接受人工确认的规范身份；AI enrichment 候选始终只是 proposal。</p></div>
                    <button type="button" onClick={() => setResolutionMode(false)}>返回查找</button>
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
                            <small>{candidate.source === 'llm-proposal' ? 'AI proposal · 需要人工确认' : candidate.reason || '确定性候选'}</small>
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
                    <strong>身份迁移边界</strong>
                    <p>拆分/合并会改写 KP transition 与 Evidence 投影，必须走专门的身份迁移流程；本待确认队列只执行 revision-checked resolve/dismiss。</p>
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
              <header><p className="eyebrow">MATCHES</p><h2>匹配结果</h2><span>{searchQuery.data?.results.length || 0}</span></header>
              {!query.trim() && <div className="knowledge-placeholder"><Search aria-hidden="true" /><p>输入内容开始查找。</p></div>}
              {query.trim() && searchQuery.isLoading && <div className="knowledge-placeholder">正在匹配…</div>}
              {query.trim() && searchQuery.data?.results.length === 0 && <div className="knowledge-placeholder"><Sparkles aria-hidden="true" /><p>没有现成知识点。提交查找可按确定性规则创建或进入待确认。</p></div>}
              <div className="knowledge-result-list">
                {(searchQuery.data?.results || []).map((result) => (
                  <button
                    key={result.id}
                    type="button"
                    className={selectedPointId === result.id ? 'selected' : ''}
                    onClick={() => {
                      setSelectedPointId(result.id);
                      setResolutionMode(false);
                      setSelectedCaseId(null);
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
              {!point && <div className="knowledge-placeholder"><BookOpenCheck aria-hidden="true" /><h2>选择或提交一个知识点</h2><p>这里会显示规范形、相关词形和来源证据。</p></div>}
              {point && (
                <>
                  <header className="knowledge-point-head">
                    <div><p className="eyebrow">{languageLabels[point.language]} · {kindLabels[point.kind]}</p><h2>{point.canonicalForm}</h2>{point.canonicalReading && <p>{point.canonicalReading}</p>}</div>
                    <div className="knowledge-stat-row"><span><b>{point.stats?.reviewEventCount || 0}</b>复习</span><span><b>{point.stats?.explicitLookupCount30d || 0}</b>近 30 天查找</span><span><b>{point.stats?.studyItemCount || 0}</b>学习单元</span></div>
                  </header>
                  <section className="knowledge-forms"><h3>相关词形</h3><div>{point.forms.map((form) => <span key={`${form.id}-${form.linkKind}`}><b>{form.text}</b><small>{form.linkKind}</small></span>)}</div></section>
                  <section className="knowledge-evidence"><h3>出现证据</h3>{point.evidence.length ? point.evidence.map((evidence) => <article key={evidence.id}><span>{evidence.sourceKind.replace('_', ' ')}</span><p>{evidence.sourceText}</p><small>{evidence.reason}</small></article>) : <p>暂无内容证据。</p>}</section>
                </>
              )}
            </main>

            <aside className="surface knowledge-learning-panel">
              <header><p className="eyebrow">LEARNING ACTION</p><h2>加入本次学习</h2><span>{intentsQuery.data?.capacity.remaining ?? 0} 可用</span></header>
              {actionMessage && <div className="knowledge-action-message"><CheckCircle2 aria-hidden="true" />{actionMessage}</div>}
              {!point && <div className="knowledge-placeholder"><Link2 aria-hidden="true" /><p>选中知识点后，这里显示可学习的来源单元。</p></div>}
              {point && studyItemIds.length === 0 && <div className="knowledge-placeholder"><Link2 aria-hidden="true" /><p>这个知识点暂未关联 Study Item。</p></div>}
              <div className="knowledge-item-list">
                {studyItems.map((item) => {
                  const intent = intentByItem.get(item.id);
                  const queued = queuedItemIds.has(item.id);
                  const status = itemStatus(item, queued, intent?.status);
                  const canAdd = Boolean(planQuery.data?.plan?.status === 'active' && item.scheduleState && !queued && !intent);
                  return (
                    <article key={item.id}>
                      <div><span>{item.unitKind.replaceAll('_', ' ')}</span><strong>{item.source.title}</strong><small>{item.scheduleState ? `下次到期 ${new Date(item.scheduleState.dueAtUtc).toLocaleDateString('zh-CN')}` : '没有调度状态'}</small></div>
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
        <div className="knowledge-confirm-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) setResolutionReview(null); }}>
          <section className="knowledge-resolution-review" role="alertdialog" aria-modal="true" aria-label="确认知识点裁决">
            <button className="icon-button" type="button" aria-label="返回待确认项" onClick={() => setResolutionReview(null)}><X aria-hidden="true" /></button>
            <ReviewSummary
              title={resolutionReview === 'resolve' ? '确认知识点归属' : '确认忽略待确认项'}
              description="该命令只写入 KG resolution event 与投影，不会写 FSRS 或学习计划。"
              items={[
                { id: 'input', label: '待确认输入', value: selectedCase.normalizedInput },
                { id: 'identity', label: '目标身份', value: resolutionReview === 'resolve' ? resolutionForm.canonicalForm : '不归属' },
                { id: 'language', label: '语言 / 类型', value: `${languageLabels[selectedCase.language]} · ${kindLabels[selectedCase.kindHint]}` },
                { id: 'revision', label: 'Case revision', value: selectedCase.revision },
                { id: 'candidates', label: '候选数量', value: selectedCase.candidates.length },
                { id: 'effect', label: '调度影响', value: '无 FSRS 写入', tone: 'success' },
              ]}
              warnings={[
                '原始 lookup 事实保持不变，裁决通过 append-only event 留痕。',
                ...(selectedCase.candidates.some((candidate) => candidate.source === 'llm-proposal')
                  ? ['存在 AI proposal；本次仍需以人工选择作为唯一接受依据。']
                  : []),
              ]}
              actionLabel={resolutionReview === 'resolve' ? `确认归属为 ${resolutionForm.canonicalForm}` : '确认忽略此项'}
              actionDisabled={resolutionMutation.isPending || (resolutionReview === 'resolve' && !resolutionForm.canonicalForm.trim())}
              onAction={() => resolutionMutation.mutate({ resolutionCase: selectedCase, action: resolutionReview })}
            />
          </section>
        </div>
      )}

      {confirmItem && (
        <div className="knowledge-confirm-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) setConfirmItem(null); }}>
          <section className="surface knowledge-confirm" role="dialog" aria-modal="true" aria-labelledby="knowledge-confirm-title">
            <button className="icon-button" type="button" aria-label="关闭" onClick={() => setConfirmItem(null)}><X aria-hidden="true" /></button>
            <p className="eyebrow">MANUAL LEARNING INTENT</p>
            <h2 id="knowledge-confirm-title">加入本次学习？</h2>
            <p><strong>{confirmItem.source.title}</strong> 将只加入今天的队列，不修改学习计划范围，也不会立即改写 FSRS。</p>
            <div><button type="button" onClick={() => setConfirmItem(null)}>取消</button><button type="button" disabled={addMutation.isPending} onClick={() => addMutation.mutate(confirmItem)}>{addMutation.isPending ? '加入中…' : '确认加入'}</button></div>
          </section>
        </div>
      )}
    </ProductShell>
  );
}
