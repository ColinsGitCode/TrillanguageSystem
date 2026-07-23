import { useEffect, useRef, useState } from 'react';
import {
  CalendarCheck2,
  Factory,
  History,
  Menu,
  Moon,
  NotebookTabs,
  SearchCheck,
  PanelLeftClose,
  PanelLeftOpen,
  Settings2,
  Sun,
  X,
} from 'lucide-react';
import { useQuery } from '@tanstack/react-query';
import { factoryApi } from '../features/factory/factory-api';
import {
  ActivityDrawer,
  GlobalFeedback,
  readStoredActivities,
  SHELL_ACTIVITY_EVENT,
  SHELL_FEEDBACK_EVENT,
  ShellTools,
  storeActivities,
  type ShellActivityCommand,
  type ShellFeedbackCommand,
} from './shell';

export type ProductArea = 'factory' | 'today' | 'plan' | 'history' | 'textbooks' | 'knowledge';

type Props = {
  active: ProductArea;
  title: string;
  children: React.ReactNode;
};

function isHealthUnhealthy(data: Awaited<ReturnType<typeof factoryApi.health>> | undefined, isError: boolean) {
  const services = Array.isArray(data?.services) ? data.services : Object.values(data?.services || {});
  const deepSeekOffline = services.some((service) => (
    /deepseek/i.test(String(service.name || ''))
    && ['offline', 'error', 'unhealthy'].includes(String(service.status || '').toLowerCase())
  ));
  return isError || data?.status === 'unhealthy' || data?.system?.criticalOnline === false || deepSeekOffline;
}

export function ProductShell({ active, title, children }: Props) {
  const [theme, setTheme] = useState<'light' | 'dark'>('light');
  const [mobileNav, setMobileNav] = useState(false);
  const [sidebarCompact, setSidebarCompact] = useState(false);
  const [activityOpen, setActivityOpen] = useState(false);
  const [activities, setActivities] = useState<ShellActivityCommand[]>([]);
  const [feedback, setFeedback] = useState<Array<ShellFeedbackCommand & { id: string }>>([]);
  const [shellEventsReady, setShellEventsReady] = useState(false);
  const mobileNavButtonRef = useRef<HTMLButtonElement>(null);
  const mobileNavRef = useRef<HTMLElement>(null);
  const activityButtonRef = useRef<HTMLButtonElement>(null);
  const healthQuery = useQuery({
    queryKey: ['health'],
    queryFn: factoryApi.health,
    refetchInterval: 15_000,
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
    setActivities(readStoredActivities());
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
      setActivities((current) => {
        const next = [
          { ...command, updatedAt: command.updatedAt || new Date().toISOString() },
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

  return (
    <div
      className={`react-app-shell${sidebarCompact ? ' sidebar-compact' : ''}`}
      data-shell-events-ready={shellEventsReady}
    >
      <aside ref={mobileNavRef} id="react-sidebar" className={`react-sidebar${mobileNav ? ' open' : ''}`}>
        <div className="brand-block">
          <span className="brand-bars"><i /><i /><i /></span>
          <div><strong>Three LANS</strong><small>{active === 'factory' ? 'Cards Factory' : active === 'textbooks' ? 'Textbook Courses' : active === 'knowledge' ? 'Knowledge Points' : 'Learning Workbench'}</small></div>
        </div>
        <nav aria-label="主导航">
          <p>学习</p>
          <a className={active === 'today' ? 'active' : ''} href="/learn" aria-current={active === 'today' ? 'page' : undefined} title={sidebarCompact ? '今日学习' : undefined}>
            <CalendarCheck2 aria-hidden="true" /><span className="sidebar-nav-label">今日学习</span>
          </a>
          <a className={active === 'plan' ? 'active' : ''} href="/learn/plan" aria-current={active === 'plan' ? 'page' : undefined} title={sidebarCompact ? '学习计划' : undefined}>
            <Settings2 aria-hidden="true" /><span className="sidebar-nav-label">学习计划</span>
          </a>
          <a className={active === 'history' ? 'active' : ''} href="/learn/history" aria-current={active === 'history' ? 'page' : undefined} title={sidebarCompact ? '学习记录' : undefined}>
            <History aria-hidden="true" /><span className="sidebar-nav-label">学习记录</span>
          </a>
          <a className={active === 'textbooks' ? 'active' : ''} href="/textbooks" aria-current={active === 'textbooks' ? 'page' : undefined} title={sidebarCompact ? '教材课程' : undefined}>
            <NotebookTabs aria-hidden="true" /><span className="sidebar-nav-label">教材课程</span>
          </a>
          <a className={active === 'knowledge' ? 'active' : ''} href="/knowledge" aria-current={active === 'knowledge' ? 'page' : undefined} title={sidebarCompact ? '知识点查找' : undefined}>
            <SearchCheck aria-hidden="true" /><span className="sidebar-nav-label">知识点查找</span>
          </a>
          <p className="sidebar-production-label">生产</p>
          <a className={active === 'factory' ? 'active' : ''} href="/" aria-current={active === 'factory' ? 'page' : undefined} title={sidebarCompact ? 'Cards Factory' : undefined}>
            <Factory aria-hidden="true" /><span className="sidebar-nav-label">Cards Factory</span>
          </a>
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
          activityCount={activities.filter((item) => ['queued', 'running', 'partially_failed', 'failed'].includes(item.status)).length}
          activityOpen={activityOpen}
          onToggleActivity={() => setActivityOpen((open) => !open)}
          activityRef={activityButtonRef}
        />
        <GlobalFeedback items={feedback} onDismiss={(id) => setFeedback((current) => current.filter((item) => item.id !== id))} />
        {children}
      </main>
      <ActivityDrawer
        open={activityOpen}
        items={activities}
        onClose={() => setActivityOpen(false)}
        triggerRef={activityButtonRef}
      />
    </div>
  );
}
