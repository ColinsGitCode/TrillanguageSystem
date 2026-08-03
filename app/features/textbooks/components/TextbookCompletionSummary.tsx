import { BookOpen, CheckCircle2, ExternalLink, Volume2 } from 'lucide-react';
import type { TextbookAsset, TextbookOperation, TextbookWorkflow } from '../types';

export function TextbookCompletionSummary({
  workflow,
  operation,
  officialAudio,
  generatedAudioCount,
  onReview,
}: {
  workflow: TextbookWorkflow;
  operation: TextbookOperation | null;
  officialAudio: TextbookAsset | null;
  generatedAudioCount: number;
  onReview: () => void;
}) {
  return (
    <section className="textbook-completion-summary">
      <header><CheckCircle2 aria-hidden="true" /><div><p className="eyebrow">已发布</p><h2>教材 Track 已可学习</h2><p>{operation?.public_summary || '发布状态已同步。'}</p></div></header>
      <dl>
        <div><dt>表达</dt><dd>{workflow.release.expressionCount}</dd></div>
        <div><dt>学习单元</dt><dd>{workflow.release.unitCount}</dd></div>
        <div><dt>单句语音</dt><dd>{generatedAudioCount}</dd></div>
        <div><dt>官方整轨</dt><dd>{officialAudio?.availability === 'available' ? '已连接' : '未连接'}</dd></div>
      </dl>
      <div>
        <button type="button" onClick={onReview}><BookOpen aria-hidden="true" />查看发布流程</button>
        <a className="primary" href={`/learn/plan?textbookTrack=${workflow.track.id}`}><ExternalLink aria-hidden="true" />加入学习计划</a>
        <a href="/learn"><Volume2 aria-hidden="true" />今日学习</a>
      </div>
    </section>
  );
}
