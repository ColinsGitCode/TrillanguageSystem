import type { Route } from './+types/learn-plan';
import { LearningPlanPage } from '../features/learning/LearningPlanPage';

export const meta: Route.MetaFunction = () => [{ title: '学习计划 - Three LANS' }];

export default function LearnPlanRoute() {
  return <LearningPlanPage />;
}
