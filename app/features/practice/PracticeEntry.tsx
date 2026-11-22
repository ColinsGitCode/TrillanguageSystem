import { Link } from 'react-router';
import { ArrowRight, MessageSquare } from 'lucide-react';
import { usePracticeAccess } from './practice-api';

export function PracticeEntry({ generationId }: { generationId?: number }) {
  const { data: allowed } = usePracticeAccess();
  if (!allowed) return null;
  if (generationId) {
    return (
      <Link className="card-practice-entry" to={'/practice?card=' + generationId}>
        <MessageSquare aria-hidden="true" />练一句
      </Link>
    );
  }
  return (
    <section className="factory-practice-entry" aria-labelledby="factory-practice-title">
      <div>
        <h2 id="factory-practice-title">今天练一句</h2>
        <p>日语 · 英语</p>
      </div>
      <Link to="/practice">开始练习 <ArrowRight aria-hidden="true" /></Link>
    </section>
  );
}
