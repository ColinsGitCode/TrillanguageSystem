import type { Route } from './+types/learn-session';
import { ReviewSessionPage } from '../features/learning/ReviewSessionPage';

export const meta: Route.MetaFunction = () => [{ title: '复习会话 - Three LANS' }];

export default function LearnSessionRoute() {
  return <ReviewSessionPage />;
}
