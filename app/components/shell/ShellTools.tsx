import { Activity, CircleHelp } from 'lucide-react';

export function ShellTools({
  activeCount,
  attentionCount,
  activityOpen,
  onToggleActivity,
  activityRef,
  infoOpen,
  onToggleInfo,
  infoRef,
}: {
  activeCount: number;
  attentionCount: number;
  activityOpen: boolean;
  onToggleActivity: () => void;
  activityRef: React.RefObject<HTMLButtonElement | null>;
  infoOpen: boolean;
  onToggleInfo: () => void;
  infoRef: React.RefObject<HTMLButtonElement | null>;
}) {
  const displayedCount = attentionCount || activeCount;
  return (
    <div className="shell-tools" aria-label="全局工具">
      <button
        ref={activityRef}
        className="icon-button shell-activity-trigger"
        type="button"
        aria-label="后台活动"
        aria-expanded={activityOpen}
        data-activity-tone={attentionCount > 0 ? 'attention' : activeCount > 0 ? 'active' : 'idle'}
        onClick={onToggleActivity}
      >
        <Activity aria-hidden="true" />
        {displayedCount > 0 && (
          <span className={attentionCount > 0 ? 'is-attention' : 'is-active'}>
            {Math.min(displayedCount, 99)}
          </span>
        )}
      </button>
      <button
        ref={infoRef}
        className="icon-button shell-info-trigger"
        type="button"
        aria-label="帮助与系统信息"
        title="帮助与系统信息"
        aria-expanded={infoOpen}
        onClick={onToggleInfo}
      >
        <CircleHelp aria-hidden="true" />
      </button>
    </div>
  );
}
