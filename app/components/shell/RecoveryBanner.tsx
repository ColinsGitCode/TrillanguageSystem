import { AlertTriangle, ArrowRight, Gauge, ListTodo, PlayCircle, RotateCcw } from 'lucide-react';
import type { ShellActivityCommand } from './shell-events';

export function RecoveryBanner({ item, count, onViewAll }: {
  item: ShellActivityCommand;
  count: number;
  onViewAll: () => void;
}) {
  const learning = item.kind === 'learning-session';
  const pending = item.status === 'needs_attention';
  const title = count > 1
    ? `有 ${count} 项工作需要处理`
    : learning ? '有一场未结束的学习' : pending ? '有一项工作待处理' : '有一项后台任务需要处理';
  const Icon = learning ? PlayCircle : pending ? ListTodo : AlertTriangle;
  return (
    <section
      className={`shell-recovery-banner${learning ? ' is-learning' : ' is-attention'}`}
      role="status"
      data-testid="recovery-banner"
    >
      <Icon aria-hidden="true" />
      <div>
        <strong>{title}</strong>
        <span>{item.title} · {item.summary}</span>
      </div>
      <a className="shell-recovery-primary" href={item.href}>
        {item.actionLabel || (learning ? '继续学习' : '查看并处理')}
        <ArrowRight aria-hidden="true" />
      </a>
      {count > 1 && (
        <button className="shell-recovery-secondary" type="button" onClick={onViewAll}>
          <ListTodo aria-hidden="true" />
          查看全部
        </button>
      )}
    </section>
  );
}

export function ServiceDegradationBanner({ message, critical, onRetry }: {
  message: string;
  critical: boolean;
  onRetry: () => void;
}) {
  return (
    <section
      className={`service-degradation-banner${critical ? ' is-critical' : ''}`}
      role={critical ? 'alert' : 'status'}
      data-testid="service-degradation-banner"
    >
      <AlertTriangle aria-hidden="true" />
      <div>
        <strong>{critical ? '关键服务暂时不可用' : '部分能力暂时不可用'}</strong>
        <span>{message}</span>
      </div>
      <button type="button" onClick={onRetry}>重新检查</button>
    </section>
  );
}

export function SandboxLimitBanner({
  message,
  onReset,
}: {
  message: string;
  onReset: () => void;
}) {
  return (
    <section
      className="service-degradation-banner sandbox-limit-banner"
      role="status"
      data-testid="sandbox-limit-banner"
    >
      <Gauge aria-hidden="true" />
      <div>
        <strong>当前体验额度已用完</strong>
        <span>{message} 可以继续浏览已有内容，或重置当前短期沙箱。</span>
      </div>
      <button type="button" onClick={onReset}>
        <RotateCcw aria-hidden="true" />
        重置体验数据
      </button>
    </section>
  );
}
