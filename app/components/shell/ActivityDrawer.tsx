import { Activity, ExternalLink, X } from 'lucide-react';
import { useEffect, useRef } from 'react';
import type { ShellActivityCommand } from './shell-events';

const STATUS_LABEL: Record<ShellActivityCommand['status'], string> = {
  queued: '等待中',
  running: '处理中',
  succeeded: '已完成',
  partially_failed: '部分失败',
  failed: '失败',
  cancelled: '已取消',
};

export function ActivityDrawer({ open, items, onClose, triggerRef }: {
  open: boolean;
  items: ShellActivityCommand[];
  onClose: () => void;
  triggerRef: React.RefObject<HTMLButtonElement | null>;
}) {
  const drawerRef = useRef<HTMLElement>(null);
  const wasOpenRef = useRef(false);

  useEffect(() => {
    if (!open) return;
    drawerRef.current?.focus({ preventScroll: true });
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      event.preventDefault();
      onClose();
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [onClose, open]);

  useEffect(() => {
    if (wasOpenRef.current && !open) {
      triggerRef.current?.focus({ preventScroll: true });
    }
    wasOpenRef.current = open;
  }, [open, triggerRef]);

  if (!open) return null;
  return (
    <div className="shell-activity-backdrop" onMouseDown={(event) => {
      if (event.target === event.currentTarget) onClose();
    }}>
      <aside ref={drawerRef} className="shell-activity-drawer" role="dialog" aria-modal="true" aria-labelledby="shell-activity-title" tabIndex={-1}>
        <header>
          <div><p className="eyebrow">ACTIVITY</p><h2 id="shell-activity-title">后台活动</h2></div>
          <button className="icon-button" type="button" aria-label="关闭后台活动" onClick={onClose}><X aria-hidden="true" /></button>
        </header>
        {items.length ? (
          <ol>
            {items.map((item) => (
              <li className={`is-${item.status}`} key={`${item.kind}:${item.id}`}>
                <Activity aria-hidden="true" />
                <div><strong>{item.title}</strong><p>{item.summary}</p><span>{STATUS_LABEL[item.status]}</span></div>
                <a href={item.href} aria-label={`打开 ${item.title}`}><ExternalLink aria-hidden="true" /></a>
              </li>
            ))}
          </ol>
        ) : <div className="shell-activity-empty"><Activity aria-hidden="true" /><strong>暂无后台活动</strong><p>卡片生成或教材发布后会显示在这里。</p></div>}
      </aside>
    </div>
  );
}
