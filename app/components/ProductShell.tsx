import { useEffect, useMemo, useRef, useState } from 'react';
import {
  CalendarCheck2,
  Factory,
  FlaskConical,
  History,
  LockKeyhole,
  Menu,
  Moon,
  NotebookTabs,
  RotateCcw,
  SearchCheck,
  PanelLeftClose,
  PanelLeftOpen,
  Settings2,
  ShieldCheck,
  Sun,
  X,
} from 'lucide-react';
import { useQuery } from '@tanstack/react-query';
import { factoryApi } from '../features/factory/factory-api';
import { activityApi } from '../lib/activity/activity';
import {
  SANDBOX_LIMIT_EVENT,
  type SandboxLimitDetail,
} from '../lib/runtime/sandbox-events';
import { workspaceRuntimeApi } from '../lib/runtime/workspace';
import { ConfirmDialog } from './overlays';
import {
  ActivityDrawer,
  GlobalFeedback,
  readStoredActivities,
  RecoveryBanner,
  SandboxLimitBanner,
  SHELL_ACTIVITY_EVENT,
  SHELL_FEEDBACK_EVENT,
  ServiceDegradationBanner,
  ShellTools,
  storeActivities,
  WorkspaceInfoDrawer,
  type ShellActivityCommand,
  type ShellFeedbackCommand,
} from './shell';
import { Link, useLocation } from 'react-router';

export type ProductArea = 'factory' | 'today' | 'plan' | 'history' | 'textbooks' | 'knowledge';
type ActivitySource = NonNullable<ShellActivityCommand['source']>;

type Props = {
  active: ProductArea;
  title: string;
  children: React.ReactNode;
  focusMode?: boolean;
};

function isHealthUnhealthy(data: Awaited<ReturnType<typeof factoryApi.health>> | undefined, isError: boolean) {
  const services = Array.isArray(data?.services) ? data.services : Object.values(data?.services || {});
  const deepSeekOffline = services.some((service) => (
    /deepseek/i.test(String(service.name || ''))
    && ['offline', 'error', 'unhealthy'].includes(String(service.status || '').toLowerCase())
  ));
  return isError || data?.status === 'unhealthy' || data?.system?.criticalOnline === false || deepSeekOffline;
}

function healthDegradation(data: Awaited<ReturnType<typeof factoryApi.health>> | undefined, isError: boolean) {
  if (isError) {
    return {
      critical: false,
      message: '暂时无法确认后台服务状态。页面中的已有内容仍可浏览。',
    };
  }
  const services = Array.isArray(data?.services) ? data.services : Object.values(data?.services || {});
  const unavailable = services.filter((service) => (
    !['online', 'healthy', 'ok'].includes(String(service.status || '').toLowerCase())
  ));
  if (!unavailable.length) return null;
  const critical = unavailable.some((service) => service.critical);
  const names = unavailable.map((service) => String(service.name || '')).join(' ');
  if (/storage/i.test(names)) {
    return {
      critical: true,
      message: '存储服务异常，请暂停生成、评分和发布；只读页面仍可继续查看。',
    };
  }
  if (/deepseek/i.test(names)) {
    return {
      critical,
      message: '卡片生成暂不可用，已有卡片、教材浏览和学习复习仍可继续。',
    };
  }
  if (/tts/i.test(names) && !/ocr/i.test(names)) {
    return {
      critical,
      message: '部分朗读能力暂不可用，文字内容和学习记录不受影响。',
    };
  }
  if (/ocr/i.test(names) && !/tts/i.test(names)) {
    return {
      critical,
      message: '图片识别暂不可用，可以继续使用文本输入创建卡片。',
    };
  }
  return {
    critical,
    message: '部分后台能力暂不可用，未受影响的页面和已有内容仍可继续使用。',
  };
}

const ACTIVITY_SOURCE_BY_AREA: Record<ProductArea, ActivitySource> = {
  factory: 'generation',
  today: 'learning',
  plan: 'learning',
  history: 'learning',
  textbooks: 'textbooks',
  knowledge: 'knowledge',
};

export function ProductShell({ active, title, children, focusMode = false }: Props) {
  const location = useLocation();
  const [theme, setTheme] = useState<'light' | 'dark'>('light');
  const [mobileNav, setMobileNav] = useState(false);
  const [sidebarCompact, setSidebarCompact] = useState(false);
  const [activityOpen, setActivityOpen] = useState(false);
  const [infoOpen, setInfoOpen] = useState(false);
  const [localActivities, setLocalActivities] = useState<ShellActivityCommand[]>([]);
  const [feedback, setFeedback] = useState<Array<ShellFeedbackCommand & { id: string }>>([]);
  const [shellEventsReady, setShellEventsReady] = useState(false);
  const [sandboxResetOpen, setSandboxResetOpen] = useState(false);
  const [sandboxResetBusy, setSandboxResetBusy] = useState(false);
  const [sandboxClock, setSandboxClock] = useState(() => Date.now());
  const [sandboxLimit, setSandboxLimit] = useState<SandboxLimitDetail | null>(null);
  const mobileNavButtonRef = useRef<HTMLButtonElement>(null);
  const mobileNavRef = useRef<HTMLElement>(null);
  const activityButtonRef = useRef<HTMLButtonElement>(null);
  const infoButtonRef = useRef<HTMLButtonElement>(null);
  const healthQuery = useQuery({
    queryKey: ['health'],
    queryFn: factoryApi.health,
    refetchInterval: 15_000,
  });
  const runtimeQuery = useQuery({
    queryKey: ['runtime'],
    queryFn: workspaceRuntimeApi.get,
    staleTime: 60_000,
    refetchInterval: 30_000,
  });
  const activityQuery = useQuery({
    queryKey: ['activity'],
    queryFn: activityApi.get,
    refetchInterval: 5_000,
    retry: false,
  });

  useEffect(() => {
    const stored = localStorage.getItem('three-lans-theme-v1');
    const next = stored === 'dark'
      || (!stored && matchMedia('(prefers-color-scheme: dark)').matches)
      ? 'dark'
      : 'light';
    setTheme(next);
    document.documentElement.dataset.theme = next;
    setSidebarCompact(localStorage.getItem('three-lans-sidebar-compact-v1') === 'true');
    setLocalActivities(readStoredActivities());
  }, []);

  useEffect(() => {
    const onFeedback = (event: Event) => {
      const command = (event as CustomEvent<ShellFeedbackCommand>).detail;
      if (!command?.message) return;
      const item = { ...command, id: command.id || `feedback-${Date.now()}-${Math.random()}` };
      setFeedback((current) => [item, ...current.filter((entry) => entry.id !== item.id)].slice(0, 3));
      window.setTimeout(() => setFeedback((current) => current.filter((entry) => entry.id !== item.id)), 6000);
    };
    const onActivity = (event: Event) => {
      const command = (event as CustomEvent<ShellActivityCommand>).detail;
      if (!command?.id || !command.href) return;
      setLocalActivities((current) => {
        const next = [
          { ...command, source: command.source || 'browser', updatedAt: command.updatedAt || new Date().toISOString() },
          ...current.filter((item) => item.id !== command.id || item.kind !== command.kind),
        ].slice(0, 30);
        storeActivities(next);
        return next;
      });
    };
    window.addEventListener(SHELL_FEEDBACK_EVENT, onFeedback);
    window.addEventListener(SHELL_ACTIVITY_EVENT, onActivity);
    setShellEventsReady(true);
    return () => {
      window.removeEventListener(SHELL_FEEDBACK_EVENT, onFeedback);
      window.removeEventListener(SHELL_ACTIVITY_EVENT, onActivity);
    };
  }, []);

  useEffect(() => {
    if (!mobileNav) return;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    mobileNavRef.current?.querySelector<HTMLElement>('a, button')?.focus();
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      event.preventDefault();
      setMobileNav(false);
      requestAnimationFrame(() => mobileNavButtonRef.current?.focus());
    };
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('keydown', onKeyDown);
      document.body.style.overflow = previousOverflow;
    };
  }, [mobileNav]);

  useEffect(() => {
    if (!focusMode) return;
    setActivityOpen(false);
    setInfoOpen(false);
  }, [focusMode]);

  useEffect(() => {
    if (runtimeQuery.data?.workspace.mode !== 'sandbox') return;
    const timer = window.setInterval(() => setSandboxClock(Date.now()), 60_000);
    return () => window.clearInterval(timer);
  }, [runtimeQuery.data?.workspace.mode]);

  useEffect(() => {
    const onSandboxLimit = (event: Event) => {
      const detail = (event as CustomEvent<SandboxLimitDetail>).detail;
      if (!detail?.message) return;
      setSandboxLimit(detail);
      void runtimeQuery.refetch();
    };
    window.addEventListener(SANDBOX_LIMIT_EVENT, onSandboxLimit);
    return () => window.removeEventListener(SANDBOX_LIMIT_EVENT, onSandboxLimit);
  }, [runtimeQuery]);

  const toggleTheme = () => {
    const next = theme === 'dark' ? 'light' : 'dark';
    setTheme(next);
    document.documentElement.dataset.theme = next;
    localStorage.setItem('three-lans-theme-v1', next);
  };
  const toggleSidebar = () => {
    const next = !sidebarCompact;
    setSidebarCompact(next);
    localStorage.setItem('three-lans-sidebar-compact-v1', String(next));
  };
  const healthUnhealthy = isHealthUnhealthy(healthQuery.data, healthQuery.isError);
  const workspace = runtimeQuery.data?.workspace;
  const sandbox = runtimeQuery.data?.sandbox;
  const readOnlySandbox = workspace?.mode === 'sandbox' && workspace.access === 'read-only';
  const sandboxRemainingMinutes = sandbox?.expiresAtUtc
    ? Math.max(0, Math.ceil((Date.parse(sandbox.expiresAtUtc) - sandboxClock) / 60_000))
    : null;
  const sandboxQuota = sandbox?.quota?.categories;
  const exhaustedSandboxCategories = workspace?.mode === 'sandbox'
    && workspace.capabilities.highCostOperations
    && sandboxQuota
    ? Object.entries(sandboxQuota)
      .filter(([, quota]) => quota.remaining <= 0)
      .map(([category]) => category)
    : [];
  const sandboxLimitMessage = sandboxLimit?.message
    || (exhaustedSandboxCategories.length
      ? `本轮${exhaustedSandboxCategories.map((category) => ({
          generation: '生成',
          ocr: '图片识别',
          tts: '即时朗读',
        }[category] || category)).join('、')}额度已经用完。`
      : '');
  const sandboxSummary = workspace?.mode === 'sandbox'
    ? [
        workspace.capabilities.highCostOperations
          ? sandboxQuota ? `生成 ${sandboxQuota.generation.remaining} 次` : null
          : '生成、图片识别和即时朗读未开放',
        workspace.capabilities.highCostOperations && sandboxQuota
          ? `识别 ${sandboxQuota.ocr.remaining} 次`
          : null,
        workspace.capabilities.highCostOperations && sandboxQuota
          ? `朗读 ${sandboxQuota.tts.remaining} 次`
          : null,
        sandboxRemainingMinutes !== null ? `${sandboxRemainingMinutes} 分钟后清理` : null,
      ].filter(Boolean).join(' · ')
    : '';
  const activities = useMemo(() => {
    const serverItems = activityQuery.data?.items;
    if (!serverItems) return localActivities;
    const keys = new Set(serverItems.map((item) => `${item.kind}:${item.id}`));
    const degradedSources = new Set(
      activityQuery.data?.sources.filter((source) => source.status === 'degraded').map((source) => source.id)
    );
    const sourceForKind = {
      'generation-job': 'generation',
      'textbook-operation': 'textbooks',
      'textbook-review': 'textbooks',
      'learning-session': 'learning',
      'knowledge-sync': 'knowledge',
      'knowledge-resolution': 'knowledge',
    } as const satisfies Record<ShellActivityCommand['kind'], string>;
    const retainedLocal = localActivities.filter((item) => (
      !keys.has(`${item.kind}:${item.id}`)
      && (
        degradedSources.has(sourceForKind[item.kind])
        || Date.now() - Date.parse(item.updatedAt || '') <= 10_000
      )
    ));
    return [...serverItems, ...retainedLocal]
      .sort((left, right) => Date.parse(right.updatedAt || '') - Date.parse(left.updatedAt || ''))
      .slice(0, 30);
  }, [activityQuery.data, localActivities]);
  const activityDegraded = activityQuery.isError
    || Boolean(activityQuery.data?.sources.some((source) => source.status === 'degraded'));
  const pageOwnsLearningRecovery = location.pathname === '/learn'
    || location.pathname === '/learn/session';
  const pageOwnsTextbookRecovery = location.pathname.startsWith('/textbooks');
  const pageOwnsKnowledgeRecovery = location.pathname.startsWith('/knowledge');
  const currentActivitySource = ACTIVITY_SOURCE_BY_AREA[active];
  const recoveryItems = activities.filter((item) => {
    if (item.kind === 'learning-session' && item.status === 'running') {
      return !pageOwnsLearningRecovery;
    }
    if (['failed', 'partially_failed'].includes(item.status)) return true;
    if (item.status === 'needs_attention' && item.source !== currentActivitySource) return false;
    if (item.kind === 'textbook-review' && pageOwnsTextbookRecovery) return false;
    if (item.kind === 'knowledge-resolution' && pageOwnsKnowledgeRecovery) return false;
    return item.status === 'needs_attention';
  });
  const recoveryItem = recoveryItems.find((item) => ['failed', 'partially_failed'].includes(item.status))
    || recoveryItems[0]
    || null;
  const serviceDegradation = healthDegradation(healthQuery.data, healthQuery.isError);
  const visibleFeedback = focusMode
    ? feedback.filter((item) => item.tone === 'warning' || item.tone === 'error')
    : feedback;

  return (
    <div
      className={`react-app-shell${sidebarCompact ? ' sidebar-compact' : ''}${focusMode ? ' is-focus-mode' : ''}`}
      data-shell-events-ready={shellEventsReady}
      data-workspace-mode={workspace?.mode || 'unknown'}
      data-workspace-access={workspace?.access || 'unknown'}
    >
      <aside ref={mobileNavRef} id="react-sidebar" className={`react-sidebar${mobileNav ? ' open' : ''}`}>
        <div className="brand-block">
          <span className="brand-bars"><i /><i /><i /></span>
          <div><strong>Three LANS</strong><small>{active === 'factory' ? 'Cards Factory' : active === 'textbooks' ? 'Textbook Courses' : active === 'knowledge' ? 'Knowledge Points' : 'Learning Workbench'}</small></div>
        </div>
        <div
          className={`workspace-mode-chip${workspace?.mode === 'sandbox' ? ' is-sandbox' : ''}${readOnlySandbox ? ' is-read-only' : ''}`}
          data-testid="workspace-mode"
          title={workspace ? `${workspace.label} · ${workspace.access === 'read-only' ? '只读' : '可读写'}` : '正在确认工作区模式'}
        >
          {workspace?.mode === 'sandbox'
            ? <FlaskConical aria-hidden="true" />
            : <ShieldCheck aria-hidden="true" />}
          <span>
            <strong>{workspace?.label || '确认运行模式'}</strong>
            <small>{workspace?.access === 'read-only'
              ? '只读'
              : workspace?.mode === 'sandbox'
                ? sandboxRemainingMinutes !== null
                  ? `${sandboxRemainingMinutes} 分钟`
                  : `${workspace.retentionHours || 24} 小时保留`
                : workspace?.protection === 'external-gateway'
                  ? '网关保护'
                  : workspace?.exposure === 'private' ? '私有网络' : '本机访问'}</small>
          </span>
        </div>
        <nav aria-label="主导航">
          <p>学习</p>
          <Link className={active === 'today' ? 'active' : ''} to="/learn" aria-current={active === 'today' ? 'page' : undefined} title={sidebarCompact ? '今日学习' : undefined}>
            <CalendarCheck2 aria-hidden="true" /><span className="sidebar-nav-label">今日学习</span>
          </Link>
          <Link className={active === 'plan' ? 'active' : ''} to="/learn/plan" aria-current={active === 'plan' ? 'page' : undefined} title={sidebarCompact ? '学习计划' : undefined}>
            <Settings2 aria-hidden="true" /><span className="sidebar-nav-label">学习计划</span>
          </Link>
          <Link className={active === 'history' ? 'active' : ''} to="/learn/history" aria-current={active === 'history' ? 'page' : undefined} title={sidebarCompact ? '学习记录' : undefined}>
            <History aria-hidden="true" /><span className="sidebar-nav-label">学习记录</span>
          </Link>
          <Link className={active === 'textbooks' ? 'active' : ''} to="/textbooks" aria-current={active === 'textbooks' ? 'page' : undefined} title={sidebarCompact ? '教材课程' : undefined}>
            <NotebookTabs aria-hidden="true" /><span className="sidebar-nav-label">教材课程</span>
          </Link>
          <Link className={active === 'knowledge' ? 'active' : ''} to="/knowledge" aria-current={active === 'knowledge' ? 'page' : undefined} title={sidebarCompact ? '知识点查找' : undefined}>
            <SearchCheck aria-hidden="true" /><span className="sidebar-nav-label">知识点查找</span>
          </Link>
          <p className="sidebar-production-label">创建</p>
          <Link className={active === 'factory' ? 'active' : ''} to="/" aria-current={active === 'factory' ? 'page' : undefined} title={sidebarCompact ? 'Cards Factory' : undefined}>
            <Factory aria-hidden="true" /><span className="sidebar-nav-label">Cards Factory</span>
          </Link>
        </nav>
        <div className="sidebar-status">
          <span className={healthUnhealthy ? 'offline' : ''} />
          <span className="sidebar-status-label">{healthUnhealthy ? '服务异常' : '服务正常'}</span>
          <div className="sidebar-tools">
            <button className="icon-button" type="button" aria-label="切换主题" title="切换主题" onClick={toggleTheme}>
              {theme === 'dark' ? <Sun aria-hidden="true" /> : <Moon aria-hidden="true" />}
            </button>
            <button
              className="icon-button sidebar-collapse-button"
              type="button"
              aria-label={sidebarCompact ? '展开导航' : '收起导航'}
              title={sidebarCompact ? '展开导航' : '收起导航'}
              aria-pressed={sidebarCompact}
              onClick={toggleSidebar}
            >
              {sidebarCompact ? <PanelLeftOpen aria-hidden="true" /> : <PanelLeftClose aria-hidden="true" />}
            </button>
          </div>
        </div>
      </aside>

      <main className="react-workspace">
        <header className="mobile-topbar">
          <button
            ref={mobileNavButtonRef}
            className="icon-button"
            type="button"
            aria-label={mobileNav ? '关闭导航' : '打开导航'}
            aria-controls="react-sidebar"
            aria-expanded={mobileNav}
            onClick={() => setMobileNav(!mobileNav)}
          >
            {mobileNav ? <X aria-hidden="true" /> : <Menu aria-hidden="true" />}
          </button>
          <strong>{title}</strong>
          <button className="icon-button" type="button" aria-label="切换主题" onClick={toggleTheme}>
            {theme === 'dark' ? <Sun aria-hidden="true" /> : <Moon aria-hidden="true" />}
          </button>
        </header>
        <ShellTools
          activeCount={activities.filter((item) => ['queued', 'running'].includes(item.status)).length}
          attentionCount={activities.filter((item) => ['needs_attention', 'partially_failed', 'failed'].includes(item.status)).length}
          activityOpen={activityOpen}
          onToggleActivity={() => {
            setInfoOpen(false);
            setActivityOpen((open) => !open);
          }}
          activityRef={activityButtonRef}
          infoOpen={infoOpen}
          onToggleInfo={() => {
            setActivityOpen(false);
            setInfoOpen((open) => !open);
          }}
          infoRef={infoButtonRef}
        />
        {workspace?.mode === 'sandbox' && (
          <section className={`workspace-access-banner${readOnlySandbox ? ' is-read-only' : ''}`} role="status" data-testid="workspace-access-notice">
            {readOnlySandbox ? <LockKeyhole aria-hidden="true" /> : <FlaskConical aria-hidden="true" />}
            <div>
              <strong>{readOnlySandbox ? '当前是只读体验沙箱' : '当前是独立体验沙箱'}</strong>
              <span>{readOnlySandbox
                ? `可以浏览合成示例，但不会写入数据。${sandboxSummary ? ` ${sandboxSummary}` : ''}`
                : `${sandboxSummary || '数据只保存在当前短期沙箱中'}，不会影响个人工作区。`}</span>
            </div>
            {sandbox?.resetSupported && (
              <button type="button" onClick={() => setSandboxResetOpen(true)}>
                <RotateCcw aria-hidden="true" /> 重置体验数据
              </button>
            )}
          </section>
        )}
        {workspace?.mode === 'sandbox' && sandboxLimitMessage && (
          <SandboxLimitBanner
            message={sandboxLimitMessage}
            onReset={() => setSandboxResetOpen(true)}
          />
        )}
        {serviceDegradation && (!focusMode || serviceDegradation.critical) && (
          <ServiceDegradationBanner
            message={serviceDegradation.message}
            critical={serviceDegradation.critical}
            onRetry={() => void healthQuery.refetch()}
          />
        )}
        {!focusMode && recoveryItem && (
          <RecoveryBanner
            item={recoveryItem}
            count={recoveryItems.length}
            onViewAll={() => setActivityOpen(true)}
          />
        )}
        <GlobalFeedback items={visibleFeedback} onDismiss={(id) => setFeedback((current) => current.filter((item) => item.id !== id))} />
        {children}
      </main>
      <ActivityDrawer
        open={activityOpen}
        items={activities}
        onClose={() => setActivityOpen(false)}
        triggerRef={activityButtonRef}
        syncing={activityQuery.isPending}
        degraded={activityDegraded}
      />
      <WorkspaceInfoDrawer
        open={infoOpen}
        onClose={() => setInfoOpen(false)}
        triggerRef={infoButtonRef}
        active={active}
        pageTitle={title}
        path={location.pathname}
        runtime={runtimeQuery.data}
        health={healthQuery.data}
        healthError={healthQuery.isError}
        healthRefreshing={healthQuery.isFetching}
        onRetryHealth={() => void healthQuery.refetch()}
      />
      {sandboxResetOpen && (
        <ConfirmDialog
          title="重置当前体验沙箱？"
          description="当前沙箱中的卡片、学习记录和操作历史会被删除，并重新载入合成示例。个人工作区不受影响。"
          confirmLabel="重置体验数据"
          pendingLabel="正在重置…"
          cancelLabel="保留当前数据"
          tone="warning"
          busy={sandboxResetBusy}
          onCancel={() => setSandboxResetOpen(false)}
          onConfirm={() => {
            setSandboxResetBusy(true);
            void workspaceRuntimeApi.resetSandbox()
              .then((result) => window.location.assign(result.reload || '/'))
              .catch(() => {
                setSandboxResetBusy(false);
                setSandboxResetOpen(false);
                setFeedback((current) => [{
                  id: `sandbox-reset-${Date.now()}`,
                  tone: 'error' as const,
                  message: '体验数据重置失败，请稍后重试。',
                }, ...current].slice(0, 3));
              });
          }}
        />
      )}
    </div>
  );
}
