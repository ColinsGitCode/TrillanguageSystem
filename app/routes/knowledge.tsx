import type { Route } from './+types/knowledge';
import { KnowledgePointsPage } from '../features/knowledge/KnowledgePointsPage';
import '../styles/knowledge.css';
import '../styles/workflow.css';

export const meta: Route.MetaFunction = () => [{ title: '知识点查找 - Three LANS' }];

export default function KnowledgeRoute() {
  return <KnowledgePointsPage />;
}
