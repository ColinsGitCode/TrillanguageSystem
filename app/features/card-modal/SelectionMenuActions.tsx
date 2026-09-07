import * as DropdownMenu from '@radix-ui/react-dropdown-menu';
import { ChevronDown, Highlighter, Palette, Sparkles } from 'lucide-react';
import type { Ref } from 'react';
import type { AnnotationColor } from '../factory/factory-api';
import type { CardType } from '../factory/types';

export function SelectionHighlightAction({ colorMenuOpen, setColorMenuOpen, toolbarFirstActionRef, annotationMode, isSavingAnnotation, annotationId, colors, saveHighlight }: {
  colorMenuOpen: boolean; setColorMenuOpen: (v: boolean) => void; toolbarFirstActionRef: Ref<HTMLButtonElement>;
  annotationMode: string; isSavingAnnotation: boolean; annotationId: string | null;
  colors: Array<{ value: AnnotationColor; label: string }>; saveHighlight: (color: AnnotationColor) => Promise<void>;
}) { return (<DropdownMenu.Root open={colorMenuOpen} onOpenChange={setColorMenuOpen} modal={false}>
      <DropdownMenu.Trigger asChild>
        <button
          ref={toolbarFirstActionRef}
          type="button"
          className="csa-highlight csa-command-tab"
          disabled={annotationMode !== 'annotations' || isSavingAnnotation}
          aria-label={annotationId ? '更改标记颜色' : '标记选区'}
        >
          {annotationId ? <Palette aria-hidden="true" /> : <Highlighter aria-hidden="true" />}
          {isSavingAnnotation ? '保存中…' : annotationId ? '改色' : '标记'}
          <ChevronDown aria-hidden="true" className="csa-caret" />
        </button>
      </DropdownMenu.Trigger>
      <DropdownMenu.Portal>
        <DropdownMenu.Content
          className="csa-gen-menu csa-color-menu"
          sideOffset={5}
          align="start"
        >
          {colors.map((color) => (
            <DropdownMenu.Item key={color.value} asChild disabled={isSavingAnnotation}>
              <button
                type="button"
                disabled={isSavingAnnotation}
                onClick={() => void saveHighlight(color.value)}
              >
                <span className={`csa-color-swatch is-${color.value}`} aria-hidden="true" />
                {color.label}
              </button>
            </DropdownMenu.Item>
          ))}
        </DropdownMenu.Content>
      </DropdownMenu.Portal>
    </DropdownMenu.Root>); }

export function SelectionGenerateAction({ genMenuOpen, setGenMenuOpen, generateTriggerRef, pending, restoreGenerateTriggerFocus, types, labels, onGenerate }: {
  genMenuOpen: boolean; setGenMenuOpen: (v: boolean) => void; generateTriggerRef: Ref<HTMLButtonElement>; pending: boolean;
  restoreGenerateTriggerFocus: (event: Event) => void; types: CardType[]; labels: Record<CardType, string>; onGenerate: (type: CardType) => void;
}) { return (<div className="csa-generate-wrap">
      <DropdownMenu.Root open={genMenuOpen} onOpenChange={setGenMenuOpen} modal={false}>
        <DropdownMenu.Trigger asChild>
          <button
            ref={generateTriggerRef}
            type="button"
            className="csa-generate csa-command-tab"
            disabled={pending}
          >
            <Sparkles aria-hidden="true" /> {pending ? '入队中…' : '生成卡片'}
            <ChevronDown aria-hidden="true" className="csa-caret" />
          </button>
        </DropdownMenu.Trigger>
        <DropdownMenu.Portal>
          <DropdownMenu.Content
            className="csa-gen-menu"
            sideOffset={5}
            align="end"
            onCloseAutoFocus={restoreGenerateTriggerFocus}
          >
            {types.map((type) => (
              <DropdownMenu.Item key={type} asChild disabled={pending}>
                <button
                  type="button"
                  disabled={pending}
                  onClick={() => onGenerate(type)}
                >
                  {labels[type]}
                </button>
              </DropdownMenu.Item>
            ))}
          </DropdownMenu.Content>
        </DropdownMenu.Portal>
      </DropdownMenu.Root>
    </div>); }
