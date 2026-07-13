import { Link, useLoaderData } from 'react-router';
import type { Route } from './+types/rr-poc';
import { readRuntimeProbe } from '../lib/server/runtime-probe.server';

export const meta: Route.MetaFunction = () => [
  { title: 'React Router Architecture Probe - Three LANS' }
];

export async function loader() {
  return readRuntimeProbe();
}

export default function ReactRouterProbe() {
  const probe = useLoaderData<typeof loader>();
  return (
    <main className="poc-shell" data-testid="react-router-poc">
      <section className="poc-panel">
        <p className="poc-kicker">THREE LANS · P0</p>
        <h1>React Router architecture probe</h1>
        <p className="poc-summary">
          React SSR and the existing Express API now share one process while Cards Factory remains on the legacy root route.
        </p>
        <dl className="poc-facts">
          <div><dt>Route owner</dt><dd>React Router</dd></div>
          <div><dt>Module bridge</dt><dd>{probe.moduleBoundary}</dd></div>
          <div><dt>Native database</dt><dd>{probe.database}</dd></div>
          <div><dt>Stored generations</dt><dd>{probe.generationCount}</dd></div>
          <div><dt>Node runtime</dt><dd>{probe.runtime}</dd></div>
        </dl>
        <Link className="poc-link" to="/">Return to Cards Factory</Link>
      </section>
    </main>
  );
}
