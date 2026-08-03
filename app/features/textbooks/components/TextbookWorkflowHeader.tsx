import { Headphones } from 'lucide-react';
import type { RefObject } from 'react';
import { PageHeader } from '../../../components/PageHeader';
import type { TextbookAsset, TextbookWorkflow } from '../types';

export function TextbookWorkflowHeader({
  workflow,
  officialAudio,
  audioRef,
  onOfficialAudioPlay,
}: {
  workflow: TextbookWorkflow | null;
  officialAudio: TextbookAsset | null;
  audioRef: RefObject<HTMLAudioElement | null>;
  onOfficialAudioPlay: () => void;
}) {
  const published = workflow?.track.status === 'published' || workflow?.stage === 'complete';
  return (
    <PageHeader
      className="textbook-workflow-header"
      testId="textbook-page-header"
      eyebrow={published ? '教材课程 · 已发布' : '教材课程 · 人工校对'}
      title={workflow?.track.title || '教材课程'}
      description={workflow && published
        ? `Track ${String(workflow.track.trackNumber).padStart(2, '0')} · ${workflow.release.expressionCount} 条表达已发布，可以直接浏览、朗读或加入学习计划。`
        : workflow
          ? `Track ${String(workflow.track.trackNumber).padStart(2, '0')} · 结构化解析已完成，请在本页完成人工校对和发布。`
          : '教材截图由 Codex Skill 在应用外完成解析；本页从人工确认开始。'}
      actions={<div className={`textbook-audio${officialAudio?.availability === 'available' ? '' : ' unavailable'}`}>
        <div>
          <Headphones aria-hidden="true" />
          <span>官方整轨音频</span>
          <strong>{officialAudio ? `${Math.round((officialAudio.duration_ms || 0) / 1000)}s` : '未绑定'}</strong>
        </div>
        {officialAudio?.availability === 'available'
          ? <audio ref={audioRef} controls preload="none" onPlay={onOfficialAudioPlay} src={`/api/textbooks/assets/${officialAudio.id}/content`} />
          : <small>{officialAudio ? `音频状态：${officialAudio.availability}` : '导入教材时可关联官方音频'}</small>}
      </div>}
    />
  );
}
