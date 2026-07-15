import type { Route } from './+types/textbooks';
import { TextbookCoursesPage } from '../features/textbooks/TextbookCoursesPage';

export const meta: Route.MetaFunction = () => [{ title: '教材课程 - Three LANS' }];

export default function TextbooksRoute() {
  return <TextbookCoursesPage />;
}
