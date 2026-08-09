import type { Route } from './+types/dictionary';
import { DictionaryPage } from '../features/dictionary/DictionaryPage';
import '../styles/dictionary.css';

export const meta: Route.MetaFunction = () => [{ title: '本地词典 - Three LANS' }];

export default function DictionaryRoute() {
  return <DictionaryPage />;
}
