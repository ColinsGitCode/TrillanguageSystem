import { ArrowRight, CalendarClock, CheckCircle2, Factory, Play, Settings2 } from 'lucide-react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from 'react-router';
import { ProductShell } from '../../components/ProductShell';
import { ErrorSummary, type WorkflowError } from '../../components/workflow';
import { ApiError } from '../../lib/api/client';
import { learningApi } from './learning-api';
import { entryPresentation, reasonLabel } from './learning-format';
import type { DailyQueue, QueueEntry } from './types';

function queueMetrics(queue: DailyQueue | null) {
  const entries = queue?.entries || [];
  const unfinished = entries.filter((entry) => ['pending', 'active', 'deferred', 'skipped'].includes(entry.status));
  return {
    unfinished,
    overdue: unfinished.filter((entry) => entry.reason.startsWith('overdue')).length,
    due: unfinished.filter((entry) => entry.reason.includes('due-today')).length,
    difficult: unfinished.filter((entry) => entry.reason === 'difficult-reappearance' || entry.reason.includes('recent-failure')).length,
    fresh: unfinished.filter((entry) => entry.reason === 'new').length,
  };
}

function learningWorkflowError(error: unknown, fallbackCode: string): WorkflowError {
  if (error instanceof ApiError && error.payload && typeof error.payload === 'object' && 'code' in error.payload) {
    return {
      code: String((error.payload as { code?: unknown }).code || fallbackCode),
      message: error.message || '学习服务暂时无法完成请求。',
      retryable: true,
    };
  }
  return {
    code: fallbackCode,
    message: error instanceof Error ? error.message : '学习服务暂时无法完成请求。',
    retryable: true,
  };
}

function QueueRow({ entry }: { entry: QueueEntry }) {
  const presentation = entryPresentation(entry);
  const planningReason = entry.explanation.provider?.sources
    ?.flatMap((source) => source.reasons)
    .find((reason) => reason.code !== 'active-tag-context');
  return (
    <li className={`learning-queue-row tone-${presentation.tone}`}>
      <span className="learning-type-pill">{presentation.type}</span>
      <span className="learning-language">{presentation.language}</span>
      <span className="learning-queue-copy">
        <strong>{entry.itemSummary?.title || `学习单元 #${entry.studyItemId}`}</strong>
        {planningReason && <small>{planningReason.label}</small>}
      </span>
      <span className={`learning-reason reason-${entry.reason}`}>{reasonLabel(entry)}</span>
    </li>
  );
}

export function TodayLearningPage() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const planQuery = useQuery({ queryKey: ['learning', 'plan'], queryFn: learningApi.plan });
  const queueQuery = useQuery({ queryKey: ['learning', 'queue', 'today'], queryFn: learningApi.todayQueue });
  const sessionQuery = useQuery({ queryKey: ['learning', 'session', 'active'], queryFn: learningApi.activeSession });
  const ensureMutation = useMutation({
    mutationFn: learningApi.ensureTodayQueue,
    onSuccess: (data) => queryClient.setQueryData(['learning', 'queue', 'today'], data),
  });
  const startMutation = useMutation({
    mutationFn: (queueId: number) => learningApi.startSession(queueId),
    onSuccess: (data) => {
      queryClient.setQueryData(['learning', 'session', 'active'], { success: true, session: data.session });
      if (data.session) navigate('/learn/session');
    },
  });

  const plan = planQuery.data?.plan || null;
  const queue = queueQuery.data?.queue || null;
  const activeSession = sessionQuery.data?.session || null;
  const metrics = queueMetrics(queue);
  const unresolved = Number(planQuery.data?.admissionSummary.unresolved || 0);
  const quarantined = Number(planQuery.data?.admissionSummary.quarantined || 0);
  const loading = planQuery.isLoading || queueQuery.isLoading || sessionQuery.isLoading;

  if (loading) {
    return <ProductShell active="today" title="今日学习"><div className="learning-loading">正在准备今日学习…</div></ProductShell>;
  }

  if (planQuery.isError || queueQuery.isError || sessionQuery.isError) {
    const error = planQuery.error || queueQuery.error || sessionQuery.error;
    return (
      <ProductShell active="today" title="今日学习">
        <section className="surface learning-empty">
          <CalendarClock aria-hidden="true" />
          <h1>今日学习暂时无法读取</h1>
          <p>Cards Factory 仍可正常使用。请稍后重试学习服务。</p>
          <ErrorSummary
            errors={[learningWorkflowError(error, 'LEARNING_TODAY_LOAD_FAILED')]}
            onRetry={() => void Promise.all([planQuery.refetch(), queueQuery.refetch(), sessionQuery.refetch()])}
          />
        </section>
      </ProductShell>
    );
  }

  if (!plan) {
    const onlyPending = planQuery.data?.scopePreview.studyItemCount === 0 && (unresolved + quarantined) > 0;
    return (
      <ProductShell active="today" title="今日学习">
        <section className="surface learning-empty" data-testid="learning-no-plan">
          <CalendarClock aria-hidden="true" />
          <p className="eyebrow">FIRST STUDY DAY</p>
          <h1>{onlyPending ? '卡片仍在等待数据确认' : '开始你的第一天'}</h1>
          <p>{onlyPending ? `当前有 ${unresolved + quarantined} 张未决或隔离卡片，不会进入复习。先处理数据或生成合格卡片。` : '先选择学习语言、卡型与每日负担。系统会据此生成可解释的今日队列。'}</p>
          <div className="learning-empty-actions">
            <button className="learning-primary-button" type="button" onClick={() => navigate('/learn/plan')}><Settings2 aria-hidden="true" /> 建立学习计划</button>
            {onlyPending && <a className="learning-secondary-button" href="/"><Factory aria-hidden="true" /> 打开 Cards Factory</a>}
          </div>
        </section>
      </ProductShell>
    );
  }

  if (plan.status === 'paused') {
    return <ProductShell active="today" title="今日学习"><section className="surface learning-empty"><CalendarClock aria-hidden="true" /><p className="eyebrow">PLAN PAUSED</p><h1>学习计划已暂停</h1><p>历史记录和调度状态都已保留。恢复后再生成新的今日队列。</p><button className="learning-primary-button" type="button" onClick={() => navigate('/learn/plan')}><Settings2 aria-hidden="true" /> 查看学习计划</button></section></ProductShell>;
  }

  if (!queue) {
    return (
      <ProductShell active="today" title="今日学习">
        <section className="surface learning-empty">
          <CalendarClock aria-hidden="true" />
          <p className="eyebrow">DAILY QUEUE</p>
          <h1>{planQuery.data?.scopePreview.studyItemCount ? '今日队列尚未生成' : '当前范围没有合格学习单元'}</h1>
          <p>{planQuery.data?.scopePreview.studyItemCount ? '队列只在你确认后生成，不会在后台静默改变。' : '调整学习范围，或先在 Cards Factory 创建合格卡片。'}</p>
          {ensureMutation.isError && (
            <ErrorSummary
              errors={[learningWorkflowError(ensureMutation.error, 'LEARNING_QUEUE_CREATE_FAILED')]}
              onRetry={() => ensureMutation.mutate()}
            />
          )}
          {planQuery.data?.scopePreview.studyItemCount
            ? <button className="learning-primary-button" type="button" disabled={ensureMutation.isPending} onClick={() => ensureMutation.mutate()}><Play aria-hidden="true" /> {ensureMutation.isPending ? '生成中…' : '生成今日队列'}</button>
            : <button className="learning-primary-button" type="button" onClick={() => navigate('/learn/plan')}><Settings2 aria-hidden="true" /> 调整学习范围</button>}
        </section>
      </ProductShell>
    );
  }

  if (queue.status === 'completed' || (!metrics.unfinished.length && queue.progress.actionCount > 0)) {
    return (
      <ProductShell active="today" title="今日学习">
        <section className="learning-page learning-complete" data-testid="learning-complete">
          <CheckCircle2 aria-hidden="true" />
          <p className="eyebrow">TODAY COMPLETE · {queue.learningDay}</p>
          <h1>今日队列已完成</h1>
          <p>完成 {queue.progress.actionCount} 个学习行动。下一批内容会按到期时间继续安排。</p>
          <div className="learning-complete-actions"><button className="learning-secondary-button" type="button" onClick={() => navigate('/learn/plan')}><Settings2 aria-hidden="true" /> 查看计划</button><a className="learning-secondary-button" href="/"><Factory aria-hidden="true" /> Cards Factory</a></div>
        </section>
      </ProductShell>
    );
  }

  return (
    <ProductShell active="today" title="今日学习">
      <div className="learning-page" data-testid="today-learning-page">
        <header className="learning-page-head learning-today-head">
          <div><p className="eyebrow">今日学习 · {queue.learningDay} · {queue.timeZone.toUpperCase()}</p><h1>{activeSession ? '继续上次的会话' : `今天还有 ${metrics.unfinished.length} 个学习行动`}</h1><p>{activeSession ? `已提交 ${activeSession.reviewSummary.total} 项，未评分内容不会产生记录。` : '到期内容优先，新单元按计划上限加入。'}</p></div>
          <button className="learning-primary-button" type="button" disabled={startMutation.isPending} onClick={() => activeSession ? navigate('/learn/session') : startMutation.mutate(queue.id)}><Play aria-hidden="true" /> {activeSession ? '继续学习' : startMutation.isPending ? '正在开始…' : '开始学习'}</button>
        </header>

        {startMutation.isError && (
          <ErrorSummary
            errors={[learningWorkflowError(startMutation.error, 'LEARNING_SESSION_START_FAILED')]}
            onRetry={() => startMutation.mutate(queue.id)}
          />
        )}

        <section className="learning-stat-strip" aria-label="今日学习统计">
          <div><span>今日已完成</span><strong>{queue.progress.actionCount}<small> / {queue.progress.actionGoal}</small></strong></div>
          <div><span>逾期 / 到期</span><strong>{metrics.overdue}<small> / {metrics.due}</small></strong></div>
          <div><span>今日新单元</span><strong>{metrics.fresh}<small> / {plan.dailyNewLimit}</small></strong></div>
          <div><span>困难项</span><strong>{metrics.difficult}<small> 项</small></strong></div>
        </section>

        {metrics.overdue >= 20 && <div className="learning-banner warning"><span>当前逾期较多。可以先把每日新单元上限设为 0，专注清理到期内容。</span><button type="button" onClick={() => navigate('/learn/plan')}>调整计划</button></div>}

        <section className="surface learning-queue">
          <header><div><p className="eyebrow">DAILY QUEUE · PRIORITY ORDER</p><h2>今日队列</h2></div><span>逾期 → 到期 → 困难重现 → 新内容</span></header>
          <ol>{metrics.unfinished.slice(0, 30).map((entry) => <QueueRow key={entry.id} entry={entry} />)}</ol>
          {metrics.unfinished.length > 30 && <p className="learning-list-more">另有 {metrics.unfinished.length - 30} 项，将按相同优先级继续排队。</p>}
        </section>

        <footer className="learning-page-footer"><button className="learning-secondary-button" type="button" onClick={() => navigate('/learn/plan')}><Settings2 aria-hidden="true" /> 调整计划</button><button className="learning-primary-button" type="button" onClick={() => activeSession ? navigate('/learn/session') : startMutation.mutate(queue.id)}>进入第一项 <ArrowRight aria-hidden="true" /></button></footer>
      </div>
    </ProductShell>
  );
}
