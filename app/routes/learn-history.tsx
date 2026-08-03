import type { Route } from './+types/learn-history';
import { LearningHistoryPage } from '../features/learning/LearningHistoryPage';
import '../styles/learning.css';

export const meta: Route.MetaFunction = () => [{ title: '学习记录 - Three LANS' }];

export default function LearnHistoryRoute() {
  return <LearningHistoryPage />;
}
