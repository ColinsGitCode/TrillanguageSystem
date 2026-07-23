import { CheckCircle2, Save } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import {
  ErrorSummary,
  TaskWorkbench,
  useLeaveGuard,
  type WorkflowError,
  type WorkflowSaveState,
  type WorkflowTaskState,
} from '../../../components/workflow';
import { TextbookContextTools } from './TextbookContextTools';
import type { TextbookReviewTask, TextbookWorkflow } from '../types';

type ReviewDraft = TextbookReviewTask['content'];

export function TextbookReviewWorkbench({
  workflow,
  activeTaskId,
  onSelectTask,
  onSave,
  onConfirm,
  saveState,
  errors,
  onReload,
}: {
  workflow: TextbookWorkflow;
  activeTaskId: string | null;
  onSelectTask: (id: string) => void;
  onSave: (task: TextbookReviewTask, changes: Partial<ReviewDraft>) => void;
  onConfirm: (task: TextbookReviewTask) => void;
  saveState: WorkflowSaveState;
  errors: WorkflowError[];
  onReload: () => void;
}) {
  const tasks = workflow.review.tasks;
  const active = tasks.find((task) => task.id === activeTaskId) || null;
  const [filter, setFilter] = useState<'all' | WorkflowTaskState>(
    workflow.review.needsAttention ? 'needs_attention' : workflow.review.pending ? 'pending' : 'all'
  );
  const [draft, setDraft] = useState<ReviewDraft | null>(active?.content || null);
  useEffect(() => setDraft(active?.content || null), [active?.id, active?.content]);
  const changes = useMemo(() => {
    if (!active || !draft) return {};
    return Object.fromEntries(Object.entries(draft).filter(([key, value]) => value !== active.content[key as keyof ReviewDraft]));
  }, [active, draft]);
  const dirty = Object.keys(changes).length > 0;
  useLeaveGuard(dirty);
  if (!active || !draft) {
    return <section className="textbook-empty-workbench"><h2>没有待校对表达</h2><p>选择 Track，或进入发布确认。</p></section>;
  }
  const setField = <K extends keyof ReviewDraft>(key: K, value: ReviewDraft[K]) => setDraft({ ...draft, [key]: value });
  return (
    <>
      <ErrorSummary errors={errors} onReload={onReload} />
      <TaskWorkbench
        tasks={tasks}
        activeId={active.id}
        filter={filter}
        onFilter={setFilter}
        onSelect={onSelectTask}
        tools={<TextbookContextTools task={active} />}
      >
        <article className="textbook-review-editor">
          <header>
            <div><p className="eyebrow">EXPR {String(active.ordinal).padStart(2, '0')}</p><h2>表达校对</h2></div>
            <span className={`textbook-review-state is-${active.state}`}>{active.state === 'confirmed' ? '已确认' : active.state === 'needs_attention' ? '需注意' : '待确认'}</span>
          </header>
          <div className="textbook-source-legend">
            <span>官方来源：English / Japanese</span>
            <span>AI 派生：中文提示 / ruby / 分析</span>
          </div>
          <label htmlFor="textbook-review-en">English official<textarea id="textbook-review-en" value={draft.officialEnText} onChange={(event) => setField('officialEnText', event.target.value)} /></label>
          <label htmlFor="textbook-review-ja">Japanese official<textarea id="textbook-review-ja" value={draft.officialJaText} onChange={(event) => setField('officialJaText', event.target.value)} /></label>
          <label htmlFor="textbook-review-zh">中文提示<textarea id="textbook-review-zh" value={draft.zhCueText} onChange={(event) => setField('zhCueText', event.target.value)} /></label>
          <label htmlFor="textbook-review-ruby">Kanji-only ruby HTML<textarea id="textbook-review-ruby" className="code" value={draft.jaRubyHtml} onChange={(event) => setField('jaRubyHtml', event.target.value)} /></label>
          <details>
            <summary>重点短语、语法与编辑备注</summary>
            <label htmlFor="textbook-review-phrases">Phrases JSON<textarea id="textbook-review-phrases" className="code" value={draft.phraseAnalysisJson} onChange={(event) => setField('phraseAnalysisJson', event.target.value)} /></label>
            <label htmlFor="textbook-review-grammar">Grammar JSON<textarea id="textbook-review-grammar" className="code" value={draft.grammarPointsJson} onChange={(event) => setField('grammarPointsJson', event.target.value)} /></label>
            <label htmlFor="textbook-review-note">Editor note<textarea id="textbook-review-note" value={draft.editorNote || ''} onChange={(event) => setField('editorNote', event.target.value)} /></label>
          </details>
          <footer>
            <button type="button" disabled={!dirty || saveState === 'saving'} onClick={() => onSave(active, changes)}>
              <Save aria-hidden="true" />{saveState === 'saving' ? '保存中…' : '保存新修订'}
            </button>
            <button className="primary" type="button" disabled={dirty || saveState === 'saving' || active.state === 'confirmed'} onClick={() => onConfirm(active)}>
              <CheckCircle2 aria-hidden="true" />确认此表达
            </button>
          </footer>
        </article>
      </TaskWorkbench>
    </>
  );
}
