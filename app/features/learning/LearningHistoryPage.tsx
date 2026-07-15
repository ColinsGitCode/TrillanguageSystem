import type { CSSProperties } from 'react';
import { useState } from 'react';
import { Activity, ArrowRight, CalendarDays, Clock3, History, Layers3, Target } from 'lucide-react';
import { useQuery } from '@tanstack/react-query';
import { ProductShell } from '../../components/ProductShell';
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
    return <ProductShell active="history" title="学习记录"><div className="learning-loading">正在汇总真实学习记录…</div></ProductShell>;
  }

  if (historyQuery.isError || !historyQuery.data) {
    return (
      <ProductShell active="history" title="学习记录">
        <section className="surface learning-empty">
          <History aria-hidden="true" />
          <h1>学习记录暂时无法读取</h1>
          <p>评分事实没有被修改。请重新加载后再查看聚合结果。</p>
          <button className="learning-primary-button" type="button" onClick={() => window.location.reload()}>重新加载</button>
        </section>
      </ProductShell>
    );
  }

  const data = historyQuery.data;
  const maxLoad = Math.max(1, ...data.daily.flatMap((day) => [day.actions, day.backlog, day.actionGoal]));
  const chartStyle = { minWidth: `${Math.max(620, data.daily.length * 22)}px` } as CSSProperties;

  return (
    <ProductShell active="history" title="学习记录">
      <div className="learning-page learning-history-page" data-testid="learning-history-page">
        <header className="learning-page-head learning-history-head">
          <div>
            <p className="eyebrow">LEARNING HISTORY · {data.range.timeZone.toUpperCase()}</p>
            <h1>学习记录</h1>
            <p>只读取已提交评分、每日队列与会话事实，不改变调度状态。</p>
          </div>
          <div className="learning-history-filters" aria-label="学习记录筛选">
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
          </div>
        </header>

        {!data.overview.totalReviews ? (
          <section className="surface learning-empty learning-history-empty" data-testid="learning-history-empty">
            <Activity aria-hidden="true" />
            <p className="eyebrow">NO REVIEW FACTS YET</p>
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

            <div className="learning-history-grid">
              <section className="surface learning-history-panel learning-load-panel">
                <header>
                  <div><p className="eyebrow">DAILY LOAD TRACE</p><h2>每日学习负荷</h2></div>
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
                <header><div><p className="eyebrow">RECALL QUALITY</p><h2>评分分布</h2></div><strong>{data.overview.averageResponseMs ? responseTime(data.overview.averageResponseMs) : '--'}<small> 平均响应</small></strong></header>
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
              <header><div><p className="eyebrow">UNIT BREAKDOWN</p><h2>学习单元表现</h2></div><span>评分越低，失败率越值得优先关注</span></header>
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
              <header><div><p className="eyebrow">RECENT REVIEW FACTS</p><h2>最近评分</h2></div><span>最近 {Math.min(50, data.recent.length)} 条</span></header>
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
