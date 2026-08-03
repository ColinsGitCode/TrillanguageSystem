import { Activity, ArrowRight, History, ListTodo, LoaderCircle, X } from 'lucide-react';
import { Link } from 'react-router';
import type { ShellActivityCommand } from './shell-events';
import { useModalDrawer } from './useModalDrawer';

const STATUS_LABEL: Record<ShellActivityCommand['status'], string> = {
  queued: '等待中',
  running: '处理中',
  needs_attention: '待处理',
  succeeded: '已完成',
  partially_failed: '部分失败',
  failed: '失败',
  cancelled: '已取消',
};

const SOURCE_LABEL: Record<NonNullable<ShellActivityCommand['source']>, string> = {
  generation: 'Cards Factory',
  textbooks: '教材课程',
  learning: '学习',
  knowledge: '知识点',
  browser: '当前页面',
};

function displayTime(value?: string) {
  if (!value) return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  const today = new Date();
  const sameDay = date.getFullYear() === today.getFullYear()
    && date.getMonth() === today.getMonth()
    && date.getDate() === today.getDate();
  return new Intl.DateTimeFormat('zh-CN', sameDay
    ? { hour: '2-digit', minute: '2-digit', hour12: false }
    : { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false }
  ).format(date);
}

export function ActivityDrawer({ open, items, onClose, triggerRef, syncing = false, degraded = false }: {
  open: boolean;
  items: ShellActivityCommand[];
  onClose: () => void;
  triggerRef: React.RefObject<HTMLButtonElement | null>;
  syncing?: boolean;
  degraded?: boolean;
}) {
  const drawerRef = useModalDrawer({
    open,
    onClose,
    triggerRef,
    initialFocusSelector: '[data-activity-initial-focus]',
  });

  if (!open) return null;
  const groups = [
    {
      id: 'attention',
      title: '待处理',
      icon: ListTodo,
      items: items.filter((item) => ['needs_attention', 'partially_failed', 'failed'].includes(item.status)),
    },
    {
      id: 'active',
      title: '进行中',
      icon: LoaderCircle,
      items: items.filter((item) => ['queued', 'running'].includes(item.status)),
    },
    {
      id: 'recent',
      title: '最近完成',
      icon: History,
      items: items.filter((item) => ['succeeded', 'cancelled'].includes(item.status)),
    },
  ].filter((group) => group.items.length);
  return (
    <div className="shell-activity-backdrop" data-testid="activity-backdrop" onMouseDown={(event) => {
      if (event.target === event.currentTarget) onClose();
    }}>
      <aside ref={drawerRef} className="shell-activity-drawer" role="dialog" aria-modal="true" aria-labelledby="shell-activity-title" tabIndex={-1}>
        <header>
          <div>
            <p className="eyebrow">活动中心</p>
            <h2 id="shell-activity-title">活动中心</h2>
            <small>{syncing ? '正在同步服务端状态' : '来自当前工作区'}</small>
          </div>
          <button className="icon-button" type="button" aria-label="关闭后台活动" data-activity-initial-focus onClick={onClose}><X aria-hidden="true" /></button>
        </header>
        {degraded && (
          <div className="shell-activity-degraded" role="status">
            部分状态暂时无法同步，已保留仍可确认的活动。
          </div>
        )}
        {items.length ? (
          <div className="shell-activity-groups">
            {groups.map((group) => {
              const Icon = group.icon;
              return (
                <section className="shell-activity-group" key={group.id} data-testid={`activity-group-${group.id}`}>
                  <h3><Icon aria-hidden="true" />{group.title}<span>{group.items.length}</span></h3>
                  <ol>
                    {group.items.map((item) => (
                      <li className={`is-${item.status}`} key={`${item.kind}:${item.id}`} data-testid={`activity-${item.kind}-${item.id}`}>
                        <Activity aria-hidden="true" />
                        <div>
                          <strong>{item.title}</strong>
                          <p>{item.summary}</p>
                          <span className="shell-activity-meta">
                            {item.source ? `${SOURCE_LABEL[item.source]} · ` : ''}
                            {STATUS_LABEL[item.status]}
                            {displayTime(item.updatedAt) ? ` · ${displayTime(item.updatedAt)}` : ''}
                          </span>
                        </div>
                        <Link to={item.href} onClick={onClose}>
                          <span>{item.actionLabel || '查看'}</span>
                          <ArrowRight aria-hidden="true" />
                        </Link>
                      </li>
                    ))}
                  </ol>
                </section>
              );
            })}
          </div>
        ) : (
          <div className="shell-activity-empty">
            <Activity aria-hidden="true" />
            <strong>{syncing ? '正在同步活动' : '暂无需要处理的活动'}</strong>
            <p>{syncing ? '正在读取当前工作区的任务状态。' : '新的生成、教材处理或学习会话会显示在这里。'}</p>
          </div>
        )}
      </aside>
    </div>
  );
}
