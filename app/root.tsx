import { useState } from 'react';
import { QueryClientProvider } from '@tanstack/react-query';
import {
  isRouteErrorResponse,
  Links,
  Meta,
  Outlet,
  Scripts,
  ScrollRestoration
} from 'react-router';
import type { Route } from './+types/root';
import { PageState } from './components/states';
import { RuntimePerformanceObserver } from './lib/performance';
import { createAppQueryClient } from './lib/query-client';
import './styles/tokens.css';
import './styles/shell.css';
import './styles/page-header.css';
import './styles/dialog.css';
import './styles/states.css';

export const links: Route.LinksFunction = () => [
  { rel: 'icon', type: 'image/svg+xml', href: '/favicon-lan.svg' },
];

export function Layout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="zh-CN">
      <head>
        <meta charSet="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <Meta />
        <Links />
      </head>
      <body>
        {children}
        <ScrollRestoration />
        <Scripts />
      </body>
    </html>
  );
}

export default function App() {
  const [queryClient] = useState(createAppQueryClient);
  return (
    <QueryClientProvider client={queryClient}>
      <RuntimePerformanceObserver />
      <Outlet />
    </QueryClientProvider>
  );
}

export function ErrorBoundary({ error }: Route.ErrorBoundaryProps) {
  const status = isRouteErrorResponse(error) ? error.status : null;
  const notFound = status === 404;
  return (
    <main className="react-error-boundary">
      <PageState
        variant="error"
        eyebrow={status ? `页面错误 · HTTP ${status}` : '页面错误'}
        title={notFound ? '没有找到这个页面' : '页面暂时无法继续运行'}
        description={notFound
          ? '链接可能已经失效。现有卡片、教材和学习记录没有被修改。'
          : '系统已停止当前页面操作，避免产生不完整写入。内部错误详情不会在公开页面显示。'}
        actions={(
          <>
            {!notFound && <button className="primary" type="button" onClick={() => window.location.reload()}>重新加载</button>}
            <a href="/">返回 Cards Factory</a>
          </>
        )}
        testId="public-error-boundary"
      />
    </main>
  );
}
