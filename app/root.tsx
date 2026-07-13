import { useState } from 'react';
import { QueryClientProvider } from '@tanstack/react-query';
import {
  Links,
  Meta,
  Outlet,
  Scripts,
  ScrollRestoration
} from 'react-router';
import type { Route } from './+types/root';
import { createAppQueryClient } from './lib/query-client';
import './styles/tokens.css';
import './styles/factory.css';
import './styles/card-modal.css';

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
      <Outlet />
    </QueryClientProvider>
  );
}

export function ErrorBoundary({ error }: Route.ErrorBoundaryProps) {
  const message = error instanceof Error ? error.message : 'Unknown application error';
  return (
    <main className="react-error-boundary">
      <section className="surface">
        <p className="eyebrow">CARDS FACTORY</p>
        <h1>页面无法继续运行</h1>
        <pre>{message}</pre>
      </section>
    </main>
  );
}
