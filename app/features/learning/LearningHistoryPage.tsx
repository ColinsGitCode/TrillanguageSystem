import type { CSSProperties } from 'react';
import { useState } from 'react';
import { Activity, ArrowRight, CalendarDays, Clock3, Eye, History, Layers3, Search, Target } from 'lucide-react';
import { useQuery } from '@tanstack/react-query';
import { PageHeader } from '../../components/PageHeader';
import { ProductShell } from '../../components/ProductShell';
import { DataRefreshStatus, PageState } from '../../components/states';
import { learningApi } from './learning-api';
import type { LearningHistoryRange, LearningUnitKind } from './types';

const RANGE_OPTIONS: Array<{ value: LearningHistoryRange; label: string }> = [
  { value: '7', label: '7 天' },
  { value: '30', label: '30 天' },
  { value: '90', label: '90 天' },
  { value: 'all', label: '全部' },
];

const UNIT_OPTIONS: Array<{ value: LearningUnitKind | ''; label: string }> = [
  { value: '', label: '全部学习单元' },
  { value: 'trilingual_en', label: '三语卡 · 英语' },
  { value: 'trilingual_ja', label: '三语卡 · 日语' },
  { value: 'grammar_ja', label: '日语语法' },
  { value: 'scenario_bilingual', label: '场景表达 · 英日' },
  { value: 'textbook_en', label: '教材课程 · 英语' },
  { value: 'textbook_ja', label: '教材课程 · 日语' },
  { value: 'whole_card', label: '完整卡片' },
];

const RATING_LABELS: Record<number, string> = { 1: '重来', 2: '困难', 3: '记住', 4: '简单' };

function percent(value: number) {
  return `${Math.round(value * 100)}%`;
}

function optionalPercent(value: number | null) {
  return value === null ? '--' : percent(value);
}

function responseTime(value: number) {
  if (!value) return '--';
  if (value < 1000) return `${value} ms`;
  return `${(value / 1000).toFixed(value >= 10_000 ? 0 : 1)} s`;
}

function dayLabel(value: string) {
  return value.slice(5).replace('-', '.');
}

function unitLabel(value: LearningUnitKind) {
  return UNIT_OPTIONS.find((option) => option.value === value)?.label || value;
}

export function LearningHistoryPage() {
  const [range, setRange] = useState<LearningHistoryRange>('30');
  const [unitKind, setUnitKind] = useState<LearningUnitKind | null>(null);
  const historyQuery = useQuery({
    queryKey: ['learning', 'history', range, unitKind],
    queryFn: () => learningApi.history(range, unitKind),
  });

  if (historyQuery.isLoading) {
    return (
      <ProductShell active="history" title="学习记录">
        <PageState
          variant="loading"
          eyebrow="学习记录"
          title="正在汇总学习记录"
          description="这里只读取已保存的评分和每日负荷，不会改变复习安排。"
          testId="learning-history-loading"
        />
      </ProductShell>
    );
  }

  if (!historyQuery.data) {
    return (
      <ProductShell active="history" title="学习记录">
        <PageState
          variant="error"
          eyebrow="学习记录"
          title="学习记录暂时无法读取"
          description="评分事实没有被修改。重新读取成功后再显示聚合结果。"
          actions={<button className="primary" type="button" onClick={() => void historyQuery.refetch()}>重新读取</button>}
          testId="learning-history-load-error"
        />
      </ProductShell>
    );
  }

  const data = historyQuery.data;
  const maxLoad = Math.max(1, ...data.daily.flatMap((day) => [day.actions, day.backlog, day.actionGoal]));
  const chartStyle = { minWidth: `${Math.max(620, data.daily.length * 22)}px` } as CSSProperties;
  const attentionGroups = [...data.breakdown]
    .filter((group) => group.failureRate > 0 || group.averageRating < 3)
    .sort((a, b) => b.failureRate - a.failureRate || a.averageRating - b.averageRating || b.reviews - a.reviews)
    .slice(0, 3);
  const nextStep = data.overview.repeatedFailureCount > 0
    ? {
        title: `${data.overview.repeatedFailureCount} 次连续选择“重来”`,
        description: '这些内容更值得优先复习。先处理到期内容，再观察是否仍会连续忘记。',
      }
    : data.overview.currentOverdue > 0
      ? {
          title: `先完成 ${data.overview.currentOverdue} 个逾期内容`,
          description: '清理已经到期的内容，可以避免今天的学习负担继续累积。',
        }
      : !data.overview.baselineEstablished
        ? {
            title: `再完成 ${data.overview.baselineRemainingDays} 个学习日`,
            description: '前 14 个实际学习日只用于建立你的个人基线，不做达标或落后判断。',
          }
        : {
            title: '按当前计划继续学习',
            description: '暂时没有连续遗忘或逾期内容，继续保持当前节奏即可。',
          };

  return (
    <ProductShell active="history" title="学习记录">
      <div className="learning-page learning-history-page" data-testid="learning-history-page">
        <PageHeader
          className="learning-history-head"
          testId="history-page-header"
          eyebrow={`学习记录 · ${data.range.timeZone}`}
          title="学习记录"
          description="这里展示已保存的评分和每日负荷，不会改变复习安排。"
          actions={<div className="learning-history-filters" aria-label="学习记录筛选">
            <div className="learning-range-control" aria-label="时间范围">
              {RANGE_OPTIONS.map((option) => (
                <button
                  key={option.value}
                  type="button"
                  className={range === option.value ? 'selected' : ''}
                  aria-pressed={range === option.value}
                  onClick={() => setRange(option.value)}
                >
                  {option.label}
                </button>
              ))}
            </div>
            <label>
              <span className="sr-only">学习单元类型</span>
              <select value={unitKind || ''} onChange={(event) => setUnitKind((event.target.value || null) as LearningUnitKind | null)}>
                {UNIT_OPTIONS.map((option) => <option key={option.value || 'all'} value={option.value}>{option.label}</option>)}
              </select>
            </label>
          </div>}
        />
        <DataRefreshStatus
          refreshing={historyQuery.isFetching && !historyQuery.isLoading}
          failed={historyQuery.isError && Boolean(historyQuery.data)}
          label="学习记录"
          onRetry={() => void historyQuery.refetch()}
          testId="learning-history-refresh-status"
        />

        <section className="learning-engagement-strip" aria-label="学习关注行为">
          <div><Search aria-hidden="true" /><span>生成查询</span><strong>{data.engagement.generationRequests}</strong></div>
          <div><History aria-hidden="true" /><span>命中已有卡</span><strong>{data.engagement.duplicateHits}</strong></div>
          <div><Eye aria-hidden="true" /><span>打开已有卡</span><strong>{data.engagement.existingCardOpens}</strong></div>
          <div><CalendarDays aria-hidden="true" /><span>加入今日</span><strong>{data.engagement.addedToToday}</strong></div>
          <p>这些是关注度信号，不代表已经掌握；系统只在既定队列内部用它们解释排序。</p>
        </section>

        {!data.overview.totalReviews ? (
          <section className="surface learning-empty learning-history-empty" data-testid="learning-history-empty">
            <Activity aria-hidden="true" />
            <p className="eyebrow">还没有学习记录</p>
            <h1>完成首次复习后，这里会显示真实学习记录</h1>
            <p>系统不会用卡片创建数量代替学习进度。只有成功提交的四档评分才进入统计。</p>
            <a className="learning-primary-button" href="/learn">进入今日学习 <ArrowRight aria-hidden="true" /></a>
          </section>
        ) : (
          <>
            {!data.overview.baselineEstablished && (
              <div className="learning-banner info" data-testid="learning-baseline-note">
                <span>前 14 个实际学习日用于建立个人基线，不做目标评判。还需 {data.overview.baselineRemainingDays} 个学习日。</span>
                <span>{data.range.startDay} — {data.range.endDay}</span>
              </div>
            )}

            <section className="learning-history-stat-strip" aria-label="学习概览">
              <div><Activity aria-hidden="true" /><span>已提交评分</span><strong>{data.overview.totalReviews}</strong></div>
              <div><CalendarDays aria-hidden="true" /><span>活跃学习日</span><strong>{data.overview.activeDays}</strong></div>
              <div><Target aria-hidden="true" /><span>到期完成率</span><strong>{percent(data.overview.dueCompletionRate)}</strong><small>{data.overview.dueCompleted} / {data.overview.dueAssigned}</small></div>
              <div><Layers3 aria-hidden="true" /><span>当前逾期</span><strong>{data.overview.currentOverdue}</strong></div>
              <div><Clock3 aria-hidden="true" /><span>响应中位数</span><strong>{responseTime(data.overview.medianResponseMs)}</strong></div>
            </section>

            <section className="surface learning-history-guidance" data-testid="learning-history-guidance">
              <header>
                <div>
                  <p className="eyebrow">下一步建议</p>
                  <h2>{nextStep.title}</h2>
                  <p>{nextStep.description}</p>
                </div>
                <a className="learning-primary-button" href="/learn">进入今日学习 <ArrowRight aria-hidden="true" /></a>
              </header>
              <div className="learning-history-attention">
                <strong>{attentionGroups.length ? '需要多练的内容类型' : '当前没有明显薄弱类型'}</strong>
                {attentionGroups.length ? (
                  <div>
                    {attentionGroups.map((group) => (
                      <button
                        key={`${group.unitKind}:${group.cardType}`}
                        type="button"
                        onClick={() => setUnitKind(group.unitKind)}
                        aria-label={`只看${unitLabel(group.unitKind)}的学习记录`}
                      >
                        <span>{unitLabel(group.unitKind)}</span>
                        <small>{group.reviews} 次评分 · 重来率 {percent(group.failureRate)}</small>
                      </button>
                    ))}
                  </div>
                ) : (
                  <p>随着真实评分增加，这里会列出重来率较高或平均评分偏低的内容类型。</p>
                )}
              </div>
            </section>

            <div className="learning-history-grid">
              <section className="surface learning-history-panel learning-load-panel">
                <header>
                  <div><p className="eyebrow">每日负荷</p><h2>每日学习负荷</h2></div>
                  <div className="learning-chart-legend"><span className="actions">完成行动</span><span className="backlog">剩余到期</span></div>
                </header>
                <div className="learning-load-scroll">
                  <div className="learning-load-chart" style={chartStyle} role="img" aria-label="每日完成行动与剩余到期趋势">
                    {data.daily.map((day) => {
                      const style = {
                        '--action-level': `${Math.max(day.actions ? 5 : 0, (day.actions / maxLoad) * 100)}%`,
                        '--backlog-level': `${Math.max(day.backlog ? 4 : 0, (day.backlog / maxLoad) * 100)}%`,
                      } as CSSProperties;
                      return (
                        <div
                          className={`learning-load-day${day.goalReached ? ' goal-reached' : ''}`}
                          key={day.learningDay}
                          style={style}
                          title={`${day.learningDay}：完成 ${day.actions}，剩余到期 ${day.backlog}，目标 ${day.actionGoal || 0}`}
                        >
                          <div className="learning-load-plot"><i />{day.backlog > 0 && <b />}</div>
                          <time dateTime={day.learningDay}>{dayLabel(day.learningDay)}</time>
                        </div>
                      );
                    })}
                  </div>
                </div>
              </section>

              <section className="surface learning-history-panel learning-rating-panel">
                <header><div><p className="eyebrow">回忆质量</p><h2>评分分布</h2></div><strong>{data.overview.averageResponseMs ? responseTime(data.overview.averageResponseMs) : '--'}<small> 平均响应</small></strong></header>
                <div className="learning-rating-bars">
                  {data.ratings.map((rating) => (
                    <div className={`rating-${rating.rating}`} key={rating.rating}>
                      <span>{RATING_LABELS[rating.rating]}</span>
                      <i><b style={{ width: `${rating.percentage * 100}%` }} /></i>
                      <strong>{rating.count}</strong>
                    </div>
                  ))}
                </div>
                <dl className="learning-history-metric-list">
                  <div><dt>会话有效完成</dt><dd>{optionalPercent(data.overview.sessionCompletionRate)}</dd></div>
                  <div><dt>每日目标完成</dt><dd>{optionalPercent(data.overview.goalCompletionRate)}</dd></div>
                  <div><dt>新单元转化</dt><dd>{percent(data.overview.newConversionRate)}</dd></div>
                  <div><dt>近 7 / 30 天活跃</dt><dd>{data.overview.recentActiveDays7} / {data.overview.recentActiveDays30} 天</dd></div>
                </dl>
              </section>
            </div>

            <section className="surface learning-history-table-panel">
              <header><div><p className="eyebrow">单元表现</p><h2>学习单元表现</h2></div><span>评分越低，失败率越值得优先关注</span></header>
              <div className="learning-history-table-wrap">
                <table>
                  <thead><tr><th>学习单元</th><th>卡型</th><th>评分次数</th><th>平均评分</th><th>重来率</th><th>平均响应</th></tr></thead>
                  <tbody>{data.breakdown.map((group) => (
                    <tr key={`${group.unitKind}:${group.cardType}`}>
                      <td>{unitLabel(group.unitKind)}</td><td>{group.cardType}</td><td>{group.reviews}</td><td>{group.averageRating.toFixed(2)}</td><td>{percent(group.failureRate)}</td><td>{responseTime(group.averageResponseMs)}</td>
                    </tr>
                  ))}</tbody>
                </table>
              </div>
            </section>

            <section className="surface learning-history-table-panel learning-recent-panel">
              <header><div><p className="eyebrow">最近评分</p><h2>最近评分</h2></div><span>最近 {Math.min(50, data.recent.length)} 条</span></header>
              <div className="learning-history-table-wrap">
                <table>
                  <thead><tr><th>学习日</th><th>内容</th><th>学习单元</th><th>评分</th><th>响应</th></tr></thead>
                  <tbody>{data.recent.map((event) => (
                    <tr key={event.id}>
                      <td><time dateTime={event.learningDay}>{event.learningDay}</time></td>
                      <td className="learning-history-title">{event.title}</td>
                      <td>{unitLabel(event.unitKind)}</td>
                      <td><span className={`learning-history-rating rating-${event.rating}`}>{RATING_LABELS[event.rating]}</span></td>
                      <td>{responseTime(event.responseMs)}</td>
                    </tr>
                  ))}</tbody>
                </table>
              </div>
            </section>

            <p className="learning-history-data-note">{data.dataQuality.notes[0]}</p>
          </>
        )}
      </div>
    </ProductShell>
  );
}
