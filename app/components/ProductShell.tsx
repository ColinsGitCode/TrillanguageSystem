import { useEffect, useRef, useState } from 'react';
import {
  CalendarCheck2,
  Factory,
  History,
  Menu,
  Moon,
  Settings2,
  Sun,
  X,
} from 'lucide-react';
import { useQuery } from '@tanstack/react-query';
import { factoryApi } from '../features/factory/factory-api';

export type ProductArea = 'factory' | 'today' | 'plan';

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
  const mobileNavButtonRef = useRef<HTMLButtonElement>(null);
  const mobileNavRef = useRef<HTMLElement>(null);
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
  const healthUnhealthy = isHealthUnhealthy(healthQuery.data, healthQuery.isError);

  return (
    <div className="react-app-shell">
      <aside ref={mobileNavRef} id="react-sidebar" className={`react-sidebar${mobileNav ? ' open' : ''}`}>
        <div className="brand-block">
          <span className="brand-bars"><i /><i /><i /></span>
          <div><strong>Three LANS</strong><small>{active === 'factory' ? 'Cards Factory' : 'Learning Workbench'}</small></div>
        </div>
        <nav aria-label="主导航">
          <p>学习</p>
          <a className={active === 'today' ? 'active' : ''} href="/learn" aria-current={active === 'today' ? 'page' : undefined}>
            <CalendarCheck2 aria-hidden="true" /> 今日学习
          </a>
          <a className={active === 'plan' ? 'active' : ''} href="/learn/plan" aria-current={active === 'plan' ? 'page' : undefined}>
            <Settings2 aria-hidden="true" /> 学习计划
          </a>
          <span className="sidebar-nav-soon" aria-disabled="true">
            <History aria-hidden="true" /> 学习记录 <em>P3</em>
          </span>
          <p className="sidebar-production-label">生产</p>
          <a className={active === 'factory' ? 'active' : ''} href="/" aria-current={active === 'factory' ? 'page' : undefined}>
            <Factory aria-hidden="true" /> Cards Factory
          </a>
        </nav>
        <div className="sidebar-status">
          <span className={healthUnhealthy ? 'offline' : ''} />
          {healthUnhealthy ? '服务异常' : '服务正常'}
          <button className="icon-button" type="button" aria-label="切换主题" onClick={toggleTheme}>
            {theme === 'dark' ? <Sun aria-hidden="true" /> : <Moon aria-hidden="true" />}
          </button>
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
        {children}
      </main>
    </div>
  );
}
