import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Archive, Check, Edit3, ListFilter, Plus, Search, Tags } from 'lucide-react';
import { DialogSurface } from '../../components/overlays';
import { ApiError } from '../../lib/api/client';
import { manualTagsApi } from './manual-tags-api';
import type { ManualTag, ManualTagCategory, ManualTagColor, ManualTagTargetKind } from './types';
import '../../styles/manual-tags.css';

const CATEGORIES: Array<{ value: ManualTagCategory; label: string }> = [
  { value: 'priority', label: '优先级' },
  { value: 'status', label: '学习状态' },
  { value: 'skill', label: '技能' },
  { value: 'topic', label: '主题' },
  { value: 'custom', label: '自定义' },
];
const COLORS: ManualTagColor[] = ['gray', 'blue', 'cyan', 'green', 'yellow', 'orange', 'red', 'purple'];
const TARGET_LABELS: Record<ManualTagTargetKind, string> = {
  generation: '学习卡片',
  textbook_track: '教材 Track',
  textbook_expression: '教材表达',
  knowledge_point: '知识点',
};

type EditorState = {
  id: number | null;
  version: number;
  name: string;
  category: ManualTagCategory;
  color: ManualTagColor;
};

function errorMessage(error: unknown) {
  if (error instanceof ApiError && error.status === 409) return '标签已在其它窗口更新，列表已刷新，请重试。';
  return error instanceof Error ? error.message : '标签操作失败，请重试。';
}

export function ManualTagBar({
  targetKind,
  targetId,
  readOnly = false,
  compact = false,
}: {
  targetKind: ManualTagTargetKind;
  targetId: number;
  readOnly?: boolean;
  compact?: boolean;
}) {
  const queryClient = useQueryClient();
  const queryKey = ['manual-tags', targetKind, targetId] as const;
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState('');
  const [selectedIds, setSelectedIds] = useState<number[]>([]);
  const [editor, setEditor] = useState<EditorState | null>(null);
  const [summaryTagId, setSummaryTagId] = useState<number | null>(null);
  const [message, setMessage] = useState('');
  const tagsQuery = useQuery({
    queryKey,
    queryFn: () => manualTagsApi.list(targetKind, targetId),
  });
  const summaryQuery = useQuery({
    queryKey: ['manual-tags', 'targets', summaryTagId],
    queryFn: () => manualTagsApi.targets(summaryTagId as number),
    enabled: summaryTagId !== null,
  });
  const tags = tagsQuery.data?.tags || [];
  const assignedIds = tagsQuery.data?.assignedTagIds || [];
  const assigned = tags.filter((tag) => assignedIds.includes(tag.id));
  const filtered = useMemo(() => {
    const needle = search.trim().toLocaleLowerCase('zh-CN');
    return needle ? tags.filter((tag) => tag.name.toLocaleLowerCase('zh-CN').includes(needle)) : tags;
  }, [search, tags]);

  const refreshAll = async () => {
    await queryClient.invalidateQueries({ queryKey: ['manual-tags'] });
  };
  const assignmentMutation = useMutation({
    mutationFn: () => manualTagsApi.assign({ targetKind, targetId, tagIds: selectedIds }),
    onSuccess: async () => {
      await refreshAll();
      setOpen(false);
      setMessage('');
    },
    onError: (error) => setMessage(errorMessage(error)),
  });
  const saveTagMutation = useMutation({
    mutationFn: async (value: EditorState) => value.id === null
      ? manualTagsApi.create(value)
      : manualTagsApi.update(value.id, {
        expectedVersion: value.version,
        name: value.name,
        category: value.category,
        color: value.color,
      }),
    onSuccess: async (data) => {
      if (!selectedIds.includes(data.tag.id)) setSelectedIds((current) => [...current, data.tag.id]);
      setEditor(null);
      setMessage('');
      await refreshAll();
    },
    onError: async (error) => {
      setMessage(errorMessage(error));
      await refreshAll();
    },
  });
  const archiveMutation = useMutation({
    mutationFn: (tag: ManualTag) => manualTagsApi.archive(tag.id, tag.version),
    onSuccess: async (data) => {
      setSelectedIds((current) => current.filter((id) => id !== data.tag.id));
      setEditor(null);
      setMessage('');
      await refreshAll();
    },
    onError: async (error) => {
      setMessage(errorMessage(error));
      await refreshAll();
    },
  });
  const beginEdit = (tag: ManualTag) => setEditor({
    id: tag.id,
    version: tag.version,
    name: tag.name,
    category: tag.category,
    color: tag.color,
  });

  return (
    <div className={`manual-tag-bar${compact ? ' is-compact' : ''}`} data-testid={`manual-tags-${targetKind}-${targetId}`}>
      <div className="manual-tag-chips" aria-label="页面标签">
        {assigned.map((tag) => <span key={tag.id} className={`manual-tag-chip color-${tag.color}`}><i aria-hidden="true" />{tag.name}</span>)}
        {!assigned.length && !tagsQuery.isLoading && <span className="manual-tag-empty">暂无标签</span>}
      </div>
      <button type="button" className="manual-tag-open" onClick={() => { setSelectedIds(assignedIds); setOpen(true); }} disabled={tagsQuery.isLoading}>
        <Tags aria-hidden="true" />{readOnly ? '查看标签' : '管理标签'}
      </button>

      {open && (
        <DialogSurface
          size="large"
          className="manual-tag-dialog"
          ariaLabelledBy="manual-tag-dialog-title"
          closeLabel="关闭标签管理"
          busy={assignmentMutation.isPending || saveTagMutation.isPending || archiveMutation.isPending}
          onClose={() => setOpen(false)}
        >
          <header className="manual-tag-dialog-head">
            <p className="eyebrow">PAGE LABELS · {TARGET_LABELS[targetKind]}</p>
            <h2 id="manual-tag-dialog-title">标签管理</h2>
            <p>选择已有标签，或创建带类型和颜色的新标签。修改标签后，所有使用位置会同步更新。</p>
          </header>

          <div className="manual-tag-dialog-body">
            <section className="manual-tag-picker">
              <div className="manual-tag-tools">
                <label><Search aria-hidden="true" /><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="搜索标签" /></label>
                {!readOnly && <button type="button" onClick={() => setEditor({ id: null, version: 0, name: '', category: 'custom', color: 'blue' })}><Plus aria-hidden="true" />新建</button>}
              </div>
              <div className="manual-tag-list" role="listbox" aria-label="已有标签" aria-multiselectable="true">
                {filtered.map((tag) => {
                  const selected = selectedIds.includes(tag.id);
                  return (
                    <div key={tag.id} className={selected ? 'is-selected' : ''}>
                      <button
                        type="button"
                        role="option"
                        aria-selected={selected}
                        disabled={readOnly}
                        onClick={() => setSelectedIds((current) => selected ? current.filter((id) => id !== tag.id) : [...current, tag.id])}
                      >
                        <i className={`manual-tag-dot color-${tag.color}`} aria-hidden="true" />
                        <span><strong>{tag.name}</strong><small>{CATEGORIES.find((item) => item.value === tag.category)?.label} · 使用 {tag.usageCount} 次</small></span>
                        {selected && <Check aria-hidden="true" />}
                      </button>
                      <button type="button" className="icon-button" aria-label={`查看 ${tag.name} 的关联页面`} onClick={() => { setSummaryTagId(tag.id); setEditor(null); }}><ListFilter aria-hidden="true" /></button>
                      {!readOnly && <button type="button" className="icon-button" aria-label={`编辑 ${tag.name}`} onClick={() => { beginEdit(tag); setSummaryTagId(null); }}><Edit3 aria-hidden="true" /></button>}
                    </div>
                  );
                })}
                {!filtered.length && <p className="manual-tag-no-results">没有匹配标签，可以新建一个。</p>}
              </div>
            </section>

            <aside className="manual-tag-editor">
              {editor ? (
                <>
                  <h3>{editor.id === null ? '新建标签' : '编辑标签'}</h3>
                  <label>名称<input maxLength={40} value={editor.name} onChange={(event) => setEditor({ ...editor, name: event.target.value })} /></label>
                  <label>类型<select value={editor.category} onChange={(event) => setEditor({ ...editor, category: event.target.value as ManualTagCategory })}>{CATEGORIES.map((category) => <option key={category.value} value={category.value}>{category.label}</option>)}</select></label>
                  <fieldset><legend>颜色</legend><div className="manual-tag-colors">{COLORS.map((color) => <button key={color} type="button" className={`color-${color}${editor.color === color ? ' is-selected' : ''}`} aria-label={color} aria-pressed={editor.color === color} onClick={() => setEditor({ ...editor, color })} />)}</div></fieldset>
                  <div className="manual-tag-editor-actions">
                    {editor.id !== null && <button type="button" className="danger" onClick={() => { const tag = tags.find((item) => item.id === editor.id); if (tag) archiveMutation.mutate(tag); }}><Archive aria-hidden="true" />归档</button>}
                    <button type="button" onClick={() => setEditor(null)}>取消</button>
                    <button type="button" className="primary" disabled={!editor.name.trim()} onClick={() => saveTagMutation.mutate(editor)}>保存标签</button>
                  </div>
                </>
              ) : summaryTagId !== null ? (
                <>
                  <h3>关联页面</h3>
                  <p className="manual-tag-summary-note">汇总所有使用“{tags.find((tag) => tag.id === summaryTagId)?.name}”的内容。</p>
                  {summaryQuery.isLoading && <p>正在汇总…</p>}
                  {summaryQuery.isError && <p className="manual-tag-error">无法读取关联页面。</p>}
                  <div className="manual-tag-targets">
                    {summaryQuery.data?.targets.map((target) => <article key={`${target.targetKind}-${target.targetId}`}><span>{TARGET_LABELS[target.targetKind]}</span><strong>{target.title}</strong><small>{target.subtitle}</small></article>)}
                    {summaryQuery.data && !summaryQuery.data.targets.length && <p>这个标签还没有关联页面。</p>}
                  </div>
                </>
              ) : (
                <div className="manual-tag-editor-empty"><Tags aria-hidden="true" /><h3>统一维护标签</h3><p>选择左侧编辑按钮可修改名称、类型和颜色；选择汇总按钮可查看所有关联页面。</p></div>
              )}
            </aside>
          </div>
          {message && <p className="manual-tag-error" role="alert">{message}</p>}
          <footer className="manual-tag-dialog-footer">
            <span>已选择 {selectedIds.length} 个标签</span>
            <button type="button" onClick={() => setOpen(false)}>取消</button>
            {!readOnly && <button type="button" className="primary" onClick={() => assignmentMutation.mutate()}>应用到当前页面</button>}
          </footer>
        </DialogSurface>
      )}
    </div>
  );
}
