import { CheckCircle2, Flag, Save } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { ConfirmDialog } from '../../../components/overlays';
import {
  ErrorSummary,
  filterWorkflowTasks,
  LeaveGuardDialog,
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
  onBulkFlag,
  bulkBusy,
  saveState,
  errors,
  onReload,
  onDirtyChange,
}: {
  workflow: TextbookWorkflow;
  activeTaskId: string | null;
  onSelectTask: (id: string) => void;
  onSave: (task: TextbookReviewTask, changes: Partial<ReviewDraft>) => void;
  onConfirm: (task: TextbookReviewTask) => void;
  onBulkFlag: (tasks: TextbookReviewTask[]) => Promise<void>;
  bulkBusy: boolean;
  saveState: WorkflowSaveState;
  errors: WorkflowError[];
  onReload: () => void;
  onDirtyChange: (dirty: boolean) => void;
}) {
  const tasks = workflow.review.tasks;
  const active = tasks.find((task) => task.id === activeTaskId) || null;
  const [filter, setFilter] = useState<'all' | WorkflowTaskState>(
    workflow.review.needsAttention ? 'needs_attention' : workflow.review.pending ? 'pending' : 'all'
  );
  const [query, setQuery] = useState('');
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [bulkDialogOpen, setBulkDialogOpen] = useState(false);
  const [draft, setDraft] = useState<ReviewDraft | null>(active?.content || null);
  useEffect(() => setDraft(active?.content || null), [active?.id, active?.content]);
  useEffect(() => {
    const valid = new Set(tasks.filter((task) => task.state !== 'needs_attention').map((task) => task.id));
    setSelectedIds((current) => new Set([...current].filter((id) => valid.has(id))));
  }, [tasks]);
  const changes = useMemo(() => {
    if (!active || !draft) return {};
    return Object.fromEntries(Object.entries(draft).filter(([key, value]) => value !== active.content[key as keyof ReviewDraft]));
  }, [active, draft]);
  const dirty = Object.keys(changes).length > 0;
  const visibleTasks = filterWorkflowTasks(tasks, filter, query);
  const selectableVisible = visibleTasks.filter((task) => task.state !== 'needs_attention');
  const selectedTasks = tasks.filter((task) => selectedIds.has(task.id));
  const allVisibleSelected = selectableVisible.length > 0
    && selectableVisible.every((task) => selectedIds.has(task.id));
  const leaveGuard = useLeaveGuard(dirty && saveState !== 'saving');
  useEffect(() => onDirtyChange(dirty), [dirty, onDirtyChange]);
  if (!active || !draft) {
    return <section className="textbook-empty-workbench"><h2>没有待校对表达</h2><p>选择 Track，或进入发布确认。</p></section>;
  }
  const setField = <K extends keyof ReviewDraft>(key: K, value: ReviewDraft[K]) => setDraft({ ...draft, [key]: value });
  return (
    <>
      <ErrorSummary errors={errors} onReload={onReload} />
      <TaskWorkbench
        storageKey="textbook-review"
        tasks={tasks}
        activeId={active.id}
        filter={filter}
        onFilter={setFilter}
        onSelect={onSelectTask}
        query={query}
        onQuery={setQuery}
        searchPlaceholder="搜索英日表达"
        selectedIds={selectedIds}
        onToggleSelection={(id) => setSelectedIds((current) => {
          const next = new Set(current);
          if (next.has(id)) next.delete(id);
          else next.add(id);
          return next;
        })}
        isSelectable={(task) => task.state !== 'needs_attention'}
        railToolbar={(
          <div className="textbook-bulk-triage" data-testid="textbook-bulk-triage">
            <div>
              <button
                type="button"
                disabled={!selectableVisible.length}
                onClick={() => setSelectedIds((current) => {
                  const next = new Set(current);
                  if (allVisibleSelected) selectableVisible.forEach((task) => next.delete(task.id));
                  else selectableVisible.forEach((task) => next.add(task.id));
                  return next;
                })}
              >
                {allVisibleSelected ? '取消当前结果' : '选择当前结果'}
              </button>
              <span>{visibleTasks.length} 条结果</span>
            </div>
            <button
              type="button"
              disabled={!selectedTasks.length || dirty || bulkBusy}
              onClick={() => setBulkDialogOpen(true)}
            >
              <Flag aria-hidden="true" />标记需注意 {selectedTasks.length || ''}
            </button>
          </div>
        )}
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
          <label htmlFor="textbook-review-ruby">日语汉字注音（ruby HTML）<textarea id="textbook-review-ruby" className="code" value={draft.jaRubyHtml} onChange={(event) => setField('jaRubyHtml', event.target.value)} /></label>
          <details>
            <summary>重点短语、语法与编辑备注</summary>
            <label htmlFor="textbook-review-phrases">重点短语（JSON）<textarea id="textbook-review-phrases" className="code" value={draft.phraseAnalysisJson} onChange={(event) => setField('phraseAnalysisJson', event.target.value)} /></label>
            <label htmlFor="textbook-review-grammar">语法点（JSON）<textarea id="textbook-review-grammar" className="code" value={draft.grammarPointsJson} onChange={(event) => setField('grammarPointsJson', event.target.value)} /></label>
            <label htmlFor="textbook-review-note">编辑备注<textarea id="textbook-review-note" value={draft.editorNote || ''} onChange={(event) => setField('editorNote', event.target.value)} /></label>
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
      <LeaveGuardDialog
        guard={leaveGuard}
        description="当前表达还有未保存修改。离开后，这些修改会被丢弃；已经保存的修订和确认记录不会受影响。"
      />
      {bulkDialogOpen && (
        <ConfirmDialog
          ariaLabel="批量标记需注意"
          title={`标记 ${selectedTasks.length} 条表达为需注意？`}
          description={(
            <>
              <p>只更新人工校对状态，不修改英日原文、中文提示、ruby、学习计划或评分。</p>
              <p>所有表达必须仍属于当前教材版本；任一冲突会整批取消。</p>
            </>
          )}
          confirmLabel={`标记 ${selectedTasks.length} 条`}
          pendingLabel="正在标记…"
          busy={bulkBusy}
          tone="warning"
          onCancel={() => setBulkDialogOpen(false)}
          onConfirm={() => {
            void onBulkFlag(selectedTasks)
              .then(() => {
                setSelectedIds(new Set());
                setBulkDialogOpen(false);
              })
              .catch(() => undefined);
          }}
        />
      )}
    </>
  );
}
