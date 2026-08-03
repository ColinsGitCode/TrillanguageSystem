import type { Route } from './+types/learn';
import { TodayLearningPage } from '../features/learning/TodayLearningPage';
import '../styles/learning.css';

export const meta: Route.MetaFunction = () => [{ title: '今日学习 - Three LANS' }];

export default function LearnRoute() {
  return <TodayLearningPage />;
}
