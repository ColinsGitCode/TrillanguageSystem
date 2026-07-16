import { useMemo, useState } from 'react';
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
import { ApiError } from '../../lib/api/client';
import { learningApi } from '../learning/learning-api';
import type { StudyItem } from '../learning/types';
import { knowledgeApi } from './knowledge-api';
import type { KnowledgeKind, KnowledgeLanguage, KnowledgePointSummary } from './types';

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
  const [unresolvedText, setUnresolvedText] = useState('');
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

  const lookupMutation = useMutation({
    mutationFn: (point?: KnowledgePointSummary) => knowledgeApi.lookup({
      eventKey: `lookup:${crypto.randomUUID()}`,
      inputText: point?.canonicalForm || query.trim(),
      language: point?.language || language,
      kindHint: point?.kind || kind,
      timeZone: planQuery.data?.profile.timeZone || 'Asia/Shanghai',
    }),
    onSuccess: (data) => {
      if (data.lookup.point) {
        setSelectedPointId(data.lookup.point.id);
        setUnresolvedText('');
      } else {
        setSelectedPointId(null);
        setUnresolvedText(data.lookup.resolutionCase?.normalizedInput || query.trim());
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
            <div className="knowledge-segments" aria-label="查找语言">
              {(Object.keys(languageLabels) as KnowledgeLanguage[]).map((value) => (
                <button type="button" aria-pressed={language === value} className={language === value ? 'selected' : ''} key={value} onClick={() => setLanguage(value)}>{languageLabels[value]}</button>
              ))}
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
                      setUnresolvedText('');
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
              {!point && !unresolvedText && <div className="knowledge-placeholder"><BookOpenCheck aria-hidden="true" /><h2>选择或提交一个知识点</h2><p>这里会显示规范形、相关词形和来源证据。</p></div>}
              {unresolvedText && <div className="knowledge-unresolved"><AlertCircle aria-hidden="true" /><p className="eyebrow">UNRESOLVED</p><h2>{unresolvedText}</h2><p>确定性分析无法安全归属。它已进入待确认，不会被强行附着到错误知识点。</p></div>}
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
