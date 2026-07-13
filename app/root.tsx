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
import '../public/css/tokens.css';
import './styles/poc.css';

export const links: Route.LinksFunction = () => [];

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
  const message = error instanceof Error ? error.message : 'Unknown architecture probe error';
  return (
    <main className="poc-shell">
      <section className="poc-panel">
        <p className="poc-kicker">ARCHITECTURE PROBE</p>
        <h1>React boundary failed</h1>
        <pre>{message}</pre>
      </section>
    </main>
  );
}
