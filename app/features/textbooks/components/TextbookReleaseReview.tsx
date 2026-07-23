import { ReviewSummary } from '../../../components/workflow';
import type { TextbookAsset, TextbookWorkflow } from '../types';

export function TextbookReleaseReview({
  workflow,
  officialAudio,
  missingTts,
  busy,
  onRelease,
  onChange,
}: {
  workflow: TextbookWorkflow;
  officialAudio: TextbookAsset | null;
  missingTts: number;
  busy: boolean;
  onRelease: () => void;
  onChange: (target: string) => void;
}) {
  const release = workflow.release;
  return (
    <ReviewSummary
      title="发布前复核"
      description="以下范围来自服务端 preview。发布会建立 Study Item；每日引入数量仍由学习计划控制。"
      items={[
        { id: 'expressions', label: '已确认表达', value: `${workflow.review.confirmed} / ${workflow.review.total}`, tone: release.available ? 'success' : 'danger', changeTarget: 'review' },
        { id: 'units', label: 'Study Items', value: release.unitCount },
        { id: 'official-audio', label: '官方整轨', value: officialAudio?.availability === 'available' ? '可播放' : '不可用', tone: officialAudio?.availability === 'available' ? 'success' : 'warning' },
        { id: 'tts', label: '待生成单句 TTS', value: missingTts, tone: missingTts ? 'warning' : 'success' },
        { id: 'plan', label: '学习计划 revision', value: release.planRevision },
        { id: 'days', label: '最短引入时间', value: release.shortestIntroductionDays ? `${release.shortestIntroductionDays} 学习日` : '由计划范围决定' },
      ]}
      warnings={release.warnings}
      actionLabel={`发布 ${release.expressionCount} 条表达`}
      actionDisabled={!release.available || busy}
      onAction={onRelease}
      onChange={onChange}
    />
  );
}
