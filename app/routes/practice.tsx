import { SentencePracticePage } from '../features/practice/SentencePracticePage';
import '../styles/sentence-practice.css';

export const meta = () => [{ title: '练一句 - Three LANS' }];

export default function PracticeRoute() {
  return <SentencePracticePage />;
}
