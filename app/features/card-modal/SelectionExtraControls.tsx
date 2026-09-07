import * as DropdownMenu from '@radix-ui/react-dropdown-menu';
import { BookOpen, MoreHorizontal, Search } from 'lucide-react';
import type { Ref } from 'react';
export function SelectionMoreActions({ hasPronunciation, readOnly, onPronunciation, onKnowledge, onNote, triggerRef }: {
  hasPronunciation: boolean; readOnly: boolean; onPronunciation: () => void; onKnowledge: () => void; onNote: () => void; triggerRef: Ref<HTMLButtonElement>;
}) {
  return <DropdownMenu.Root modal={false}>
    <DropdownMenu.Trigger asChild><button ref={triggerRef} type="button" className="csa-icon-action" aria-label="更多学习操作" title="更多学习操作"><MoreHorizontal aria-hidden="true" /></button></DropdownMenu.Trigger>
    <DropdownMenu.Portal><DropdownMenu.Content className="csa-gen-menu" sideOffset={5}>
      {hasPronunciation && <DropdownMenu.Item asChild><button type="button" onClick={onPronunciation}><BookOpen aria-hidden="true" />查看日语读音详情</button></DropdownMenu.Item>}
      <DropdownMenu.Item asChild><button type="button" onClick={onKnowledge}><Search aria-hidden="true" />查知识点</button></DropdownMenu.Item>
      {!readOnly && <DropdownMenu.Item asChild><button type="button" onClick={onNote}>记笔记</button></DropdownMenu.Item>}
    </DropdownMenu.Content></DropdownMenu.Portal>
  </DropdownMenu.Root>;
}
export function SelectionScopeControls({ value, onChange }: {
  value: string; onChange: (value: 'original' | 'word' | 'phrase' | 'sentence') => void;
}) {
  return <div className="csa-scope" role="group" aria-label="调整选区范围">
    {(['original', 'word', 'phrase', 'sentence'] as const).map((scope, index) => <button key={scope} type="button"
      aria-pressed={value === scope} onClick={() => onChange(scope)}>{['原选', '词', '短语', '整句'][index]}</button>)}
  </div>;
}
