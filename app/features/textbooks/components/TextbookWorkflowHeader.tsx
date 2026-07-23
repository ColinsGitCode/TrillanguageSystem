import { Headphones } from 'lucide-react';
import type { RefObject } from 'react';
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
  return (
    <header className="textbook-workflow-header">
      <div>
        <p className="eyebrow">TEXTBOOK COURSES · SKILL HANDOFF</p>
        <h1>{workflow?.track.title || '教材课程'}</h1>
        <p>
          {workflow
            ? `Track ${String(workflow.track.trackNumber).padStart(2, '0')} · revision ${workflow.track.revisionNumber} · Skill 已完成结构化解析，本页负责人审、发布与学习。`
            : '教材截图由 Codex Skill 在应用外完成解析；本页从人工确认开始。'}
        </p>
      </div>
      <div className={`textbook-audio${officialAudio?.availability === 'available' ? '' : ' unavailable'}`}>
        <div>
          <Headphones aria-hidden="true" />
          <span>Official Track</span>
          <strong>{officialAudio ? `${Math.round((officialAudio.duration_ms || 0) / 1000)}s` : '未绑定'}</strong>
        </div>
        {officialAudio?.availability === 'available'
          ? <audio ref={audioRef} controls preload="none" onPlay={onOfficialAudioPlay} src={`/api/textbooks/assets/${officialAudio.id}/content`} />
          : <small>{officialAudio ? `音频状态：${officialAudio.availability}` : '可由 Skill 绑定本地官方音频'}</small>}
      </div>
    </header>
  );
}
