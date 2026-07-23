import { useEffect, useState } from 'react';
import { RotateCcw, Trash2, X } from 'lucide-react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { publishShellFeedback } from '../../components/shell';
import { factoryApi } from './factory-api';
import type { GenerationJob, QueueSummary } from './types';

const STATUS_LABEL: Record<string, string> = {
  queued: 'QUEUED', running: 'RUNNING', success: 'DONE', failed: 'FAILED', cancelled: 'CANCELLED',
};

function formatEventTime(value?: string) {
  if (!value) return '';
  return new Intl.DateTimeFormat('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' })
    .format(new Date(value));
}

export function QueuePanel({
  open,
  onClose,
  jobs,
  summary,
  selectedJobId,
  onSelectJob,
}: {
  open: boolean;
  onClose: () => void;
  jobs: GenerationJob[];
  summary: QueueSummary;
  selectedJobId?: number | null;
  onSelectJob?: (jobId: number) => void;
}) {
  const queryClient = useQueryClient();
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const selected = jobs.find((job) => job.id === selectedId) || jobs[0] || null;
  const eventsQuery = useQuery({
    queryKey: ['queue-events', selected?.id],
    queryFn: () => factoryApi.events(selected!.id),
    enabled: open && Boolean(selected),
    refetchInterval: open && selected?.status === 'running' ? 1500 : false,
  });
  const refresh = async () => {
    await queryClient.invalidateQueries({ queryKey: ['queue'] });
    await queryClient.invalidateQueries({ queryKey: ['queue-events'] });
  };
  const retryMutation = useMutation({
    mutationFn: async () => {
      const failed = jobs.filter((job) => job.status === 'failed');
      await Promise.all(failed.map((job) => factoryApi.retry(job.id)));
      return failed.length;
    },
    onSuccess: async (count) => {
      publishShellFeedback({ tone: 'success', message: `已重新加入 ${count} 个失败任务` });
      await refresh();
    },
    onError: (error) => publishShellFeedback({ tone: 'error', message: `重试失败：${error.message}` }),
  });
  const clearMutation = useMutation({
    mutationFn: factoryApi.clearDone,
    onSuccess: async () => {
      publishShellFeedback({ tone: 'success', message: '已清理完成任务' });
      await refresh();
    },
    onError: (error) => publishShellFeedback({ tone: 'error', message: `清理失败：${error.message}` }),
  });
  const cancelMutation = useMutation({
    mutationFn: factoryApi.cancel,
    onSuccess: async (_, jobId) => {
      publishShellFeedback({ tone: 'warning', message: `任务 #${jobId} 已取消` });
      await refresh();
    },
    onError: (error) => publishShellFeedback({ tone: 'error', message: `取消失败：${error.message}` }),
  });

  useEffect(() => {
    if (!open) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [open, onClose]);

  useEffect(() => {
    if (!open) return;
    if (selectedJobId && jobs.some((job) => job.id === selectedJobId)) {
      setSelectedId(selectedJobId);
      return;
    }
    if (selectedId && jobs.some((job) => job.id === selectedId)) return;
    setSelectedId(jobs[0]?.id || null);
  }, [jobs, open, selectedId, selectedJobId]);

  if (!open) return null;
  return (
    <div className="queue-dialog-backdrop" data-testid="react-queue-backdrop" onMouseDown={(event) => {
      if (event.target === event.currentTarget) onClose();
    }}>
      <section className="queue-dialog" role="dialog" aria-modal="true" aria-labelledby="queue-dialog-title">
        <header>
          <div>
            <p className="eyebrow">TASK QUEUE</p>
            <h2 id="queue-dialog-title">队列管理</h2>
          </div>
          <div className="queue-dialog-actions">
            <button type="button" disabled={!jobs.some((job) => job.status === 'failed') || retryMutation.isPending} onClick={() => retryMutation.mutate()}>
              <RotateCcw aria-hidden="true" /> 重试失败
            </button>
            <button type="button" disabled={clearMutation.isPending} onClick={() => clearMutation.mutate()}>
              <Trash2 aria-hidden="true" /> 清理完成
            </button>
            <button className="icon-button" type="button" aria-label="关闭队列" data-testid="react-queue-close" onClick={onClose}>
              <X aria-hidden="true" />
            </button>
          </div>
        </header>
        <div className="queue-summary-line">
          <span>待执行 <b>{summary.queued || 0}</b></span>
          <span>运行 <b>{summary.running || 0}</b></span>
          <span>完成 <b>{summary.success || 0}</b></span>
          <span>失败 <b>{summary.failed || 0}</b></span>
        </div>
        <div className="queue-dialog-body">
          <div className="queue-job-list" role="listbox" aria-label="生成任务">
            {jobs.length ? jobs.map((job) => (
              <button
                type="button"
                key={job.id}
                role="option"
                aria-selected={selected?.id === job.id}
                className={`queue-job queue-${job.status}${selected?.id === job.id ? ' active' : ''}`}
                onClick={() => {
                  setSelectedId(job.id);
                  onSelectJob?.(job.id);
                }}
              >
                <span className="queue-job-top"><b>#{job.id}</b><i>{STATUS_LABEL[job.status] || job.status}</i></span>
                <strong>{job.phraseNormalized}</strong>
                <small>{job.jobType}</small>
              </button>
            )) : <div className="empty-copy">暂无队列任务</div>}
          </div>
          <div className="queue-timeline" data-testid="react-queue-timeline">
            <div className="queue-timeline-head">
              <div><p className="eyebrow">AUDIT TRAIL</p><h3>{selected ? `#${selected.id}` : '未选择任务'}</h3></div>
              {selected?.status === 'queued' && (
                <button type="button" onClick={() => cancelMutation.mutate(selected.id)}>取消任务</button>
              )}
            </div>
            {eventsQuery.data?.events?.length ? eventsQuery.data.events.map((event) => (
              <article className="queue-event" key={event.id}>
                <span>{event.eventType.replaceAll('_', ' ').toUpperCase()}</span>
                <time>{formatEventTime(event.createdAt)}</time>
                <p>{typeof event.payload === 'string' ? event.payload : JSON.stringify(event.payload || {})}</p>
              </article>
            )) : <div className="empty-copy">暂无审计事件</div>}
          </div>
        </div>
      </section>
    </div>
  );
}
