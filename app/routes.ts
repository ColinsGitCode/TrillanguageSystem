import { index, route, type RouteConfig } from '@react-router/dev/routes';

export default [
  index('routes/_index.tsx'),
  route('learn', 'routes/learn.tsx'),
  route('learn/plan', 'routes/learn-plan.tsx'),
  route('learn/session', 'routes/learn-session.tsx'),
] satisfies RouteConfig;
