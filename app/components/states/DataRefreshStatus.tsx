import { AlertTriangle, LoaderCircle, RefreshCw } from 'lucide-react';

export function DataRefreshStatus({
  refreshing,
  failed,
  onRetry,
  label = '内容',
  compact = false,
  testId,
}: {
  refreshing?: boolean;
  failed?: boolean;
  onRetry?: () => void;
  label?: string;
  compact?: boolean;
  testId?: string;
}) {
  if (!refreshing && !failed) return null;
  return (
    <div
      className={`data-refresh-status${failed ? ' is-failed' : ' is-refreshing'}${compact ? ' is-compact' : ''}`}
      data-testid={testId}
      role={failed ? 'alert' : 'status'}
      aria-live="polite"
    >
      {failed ? <AlertTriangle aria-hidden="true" /> : <LoaderCircle aria-hidden="true" />}
      <span>
        {failed
          ? `${label}刷新失败，正在显示上次成功读取的内容。`
          : `正在刷新${label}，当前内容仍可使用。`}
      </span>
      {failed && onRetry && (
        <button type="button" onClick={onRetry}>
          <RefreshCw aria-hidden="true" />
          重试
        </button>
      )}
    </div>
  );
}
