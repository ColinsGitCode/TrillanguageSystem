import { useState } from 'react';
import { factoryApi } from '../factory/factory-api';
import type { CardAnnotation, AnnotationTarget } from '../factory/factory-api';
import type { CardAnnotationSelector } from './annotation-render.mjs';

type Props = {
  initialText: string;
  state: { annotations: CardAnnotation[]; target: AnnotationTarget };
  selector: CardAnnotationSelector;
  generationId: number;
  annotationId: string | null;
  onClose: () => void;
  onToast: (message: string) => void;
  onSaved: (annotations: CardAnnotation[]) => void;
};

export function SelectionNoteEditor({ initialText, state, selector, generationId, annotationId, onClose, onToast, onSaved }: Props) {
  const [text, setText] = useState(initialText);
  const [busy, setBusy] = useState(false);
  const save = async () => {
    if (busy || !text.trim()) return;
    setBusy(true);
    try {
      const current = state.annotations.find((item) => item.id === annotationId);
      const result = current
        ? await factoryApi.updateAnnotation(current.id, { expectedVersion: current.version, noteText: text.trim() })
        : await factoryApi.createAnnotation({ id: crypto.randomUUID(), targetKind: 'generation', targetId: generationId,
          expectedTargetRevision: state.target.targetRevision, selector, annotationKind: 'note', color: 'yellow', noteText: text.trim() });
      onSaved(current ? state.annotations.map((item) => item.id === current.id ? result.annotation : item) : [...state.annotations, result.annotation]);
      onToast('笔记已保存，再次点击标记可查看');
    } catch { onToast('笔记保存失败，请重新选择后重试'); }
    finally { setBusy(false); }
  };
  return <form className="csa-note-editor" onSubmit={(event) => { event.preventDefault(); void save(); }}
    onKeyDown={(event) => { if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); if (!busy) onClose(); } }}>
    <label>阅读笔记<textarea aria-label="阅读笔记" autoFocus value={text} maxLength={2000}
      onChange={(event) => setText(event.target.value)} disabled={busy} /></label>
    <small>关联当前选区，保存后可点击标记查看。</small>
    <button type="submit" disabled={busy || !text.trim()}>保存笔记</button>
    <button type="button" disabled={busy} onClick={onClose}>取消</button>
  </form>;
}
