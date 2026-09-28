import { useState } from 'react';
import { factoryApi } from '../factory/factory-api';
import type { CardAnnotation, AnnotationTarget } from '../factory/factory-api';
import type { CardAnnotationSelector } from './annotation-render.mjs';

export type NoteDraft = {
  initialText: string;
  text: string;
  state: { annotations: CardAnnotation[]; target: AnnotationTarget };
  selector: CardAnnotationSelector;
  generationId: number;
  annotationId: string | null;
};

type Props = {
  draft: NoteDraft;
  onChange: (text: string) => void;
  onBusyChange: (busy: boolean) => void;
  onClose: () => void;
  onToast: (message: string) => void;
  onSaved: (annotation: CardAnnotation) => void;
};

export function SelectionNoteEditor({ draft, onChange, onBusyChange, onClose, onToast, onSaved }: Props) {
  const { text, state, selector, generationId, annotationId } = draft;
  const [busy, setBusy] = useState(false);
  const save = async () => {
    if (busy || !text.trim()) return;
    setBusy(true);
    onBusyChange(true);
    try {
      const current = state.annotations.find((item) => item.id === annotationId);
      const result = current
        ? await factoryApi.updateAnnotation(current.id, { expectedVersion: current.version, noteText: text.trim() })
        : await factoryApi.createAnnotation({ id: crypto.randomUUID(), targetKind: 'generation', targetId: generationId,
          expectedTargetRevision: state.target.targetRevision, selector, annotationKind: 'note', color: 'yellow', noteText: text.trim() });
      onSaved(result.annotation);
      onToast('笔记已保存，再次点击标记可查看');
    } catch { onToast('笔记保存失败，草稿已保留；请重试或检查卡片是否已变化'); }
    finally { setBusy(false); onBusyChange(false); }
  };
  return <form className="csa-note-editor" aria-label="选区笔记编辑器" onSubmit={(event) => { event.preventDefault(); void save(); }}
    onKeyDown={(event) => { if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); if (!busy) onClose(); } }}>
    <blockquote title={selector.textQuote.exact}>{selector.textQuote.exact}</blockquote>
    <label>阅读笔记<textarea aria-label="阅读笔记" autoFocus value={text} maxLength={2000}
      onChange={(event) => onChange(event.target.value)} disabled={busy} /></label>
    <small>{text !== draft.initialText ? '草稿未保存 · ' : ''}关联上方原文，滚动或切换视图不会丢失。</small>
    <button type="submit" disabled={busy || !text.trim()}>保存笔记</button>
    <button type="button" disabled={busy} onClick={onClose}>取消</button>
  </form>;
}
