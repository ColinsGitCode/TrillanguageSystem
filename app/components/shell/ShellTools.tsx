import { Activity } from 'lucide-react';

export function ShellTools({ activityCount, activityOpen, onToggleActivity, activityRef }: {
  activityCount: number;
  activityOpen: boolean;
  onToggleActivity: () => void;
  activityRef: React.RefObject<HTMLButtonElement | null>;
}) {
  return (
    <div className="shell-tools" aria-label="全局工具">
      <button
        ref={activityRef}
        className="icon-button shell-activity-trigger"
        type="button"
        aria-label="后台活动"
        aria-expanded={activityOpen}
        onClick={onToggleActivity}
      >
        <Activity aria-hidden="true" />
        {activityCount > 0 && <span>{Math.min(activityCount, 99)}</span>}
      </button>
    </div>
  );
}
