import { NotebookTabs } from 'lucide-react';
import type { TextbookCourse } from '../types';

function statusLabel(status: string) {
  if (status === 'draft') return '待校对';
  if (status === 'verified') return '已确认';
  if (status === 'published') return '已发布';
  return '已归档';
}

export function TextbookTrackRail({
  courses,
  activeTrackId,
  onSelect,
}: {
  courses: TextbookCourse[];
  activeTrackId: number | null;
  onSelect: (trackId: number) => void;
}) {
  return (
    <aside className="textbook-track-rail" aria-label="教材 Track">
      <header><p className="eyebrow">COURSES</p><h2>教材</h2></header>
      {courses.length === 0 && (
        <div className="textbook-empty-list">
          <NotebookTabs aria-hidden="true" />
          <strong>还没有教材草稿</strong>
          <span>在 Codex 中运行 `import-textbook-track` Skill，批准 dry-run 后会直接打开校对页面。</span>
        </div>
      )}
      {courses.map((course) => (
        <section key={course.id}>
          <h3>{course.title}</h3>
          <p>{course.track_count ?? course.tracks?.length ?? 0} tracks · {course.course_key}</p>
          {(course.tracks || []).map((track) => (
            <button
              key={track.id}
              type="button"
              className={track.id === activeTrackId ? 'selected' : ''}
              onClick={() => onSelect(track.id)}
            >
              <span>Track {String(track.track_number).padStart(2, '0')}</span>
              <strong>{track.title}</strong>
              <small>{statusLabel(track.status)} · {track.expression_count || 0} expressions</small>
            </button>
          ))}
        </section>
      ))}
      <details className="textbook-advanced-intake">
        <summary>高级导入信息</summary>
        <p>正常主流程由 Skill 调用正式 API 完成导入，不要求在页面粘贴截图、路径或 OCR 结果。</p>
      </details>
    </aside>
  );
}
