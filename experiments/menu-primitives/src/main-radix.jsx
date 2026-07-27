// Radix 版：同一套 class，行为交给 DropdownMenu
import { StrictMode, useRef } from 'react';
import { createRoot } from 'react-dom/client';
import * as ContextMenu from '@radix-ui/react-context-menu';
import * as DropdownMenu from '@radix-ui/react-dropdown-menu';
import './tokens.css';
import './toolbar-descoped.css';

const TYPES = [['trilingual', '单词卡'], ['grammar_ja', '语法卡'], ['scenario_phrase', '场景卡']];

function Toolbar() {
  const triggerRef = useRef(null);
  return (
    <div className="card-selection-toolbar" style={{ top: 90, left: 260 }} role="toolbar" aria-label="选区操作"
      onMouseDown={(event) => {
        if (!(event.target instanceof Element) || !event.target.closest('button')) event.preventDefault();
      }}>
      <button type="button" className="csa-highlight">标红</button>
      <span className="csa-sep" aria-hidden="true" />
      <div className="csa-generate-wrap">
        <DropdownMenu.Root>
          <DropdownMenu.Trigger asChild>
            <button ref={triggerRef} type="button" className="csa-generate">生成卡片 ▾</button>
          </DropdownMenu.Trigger>
          <DropdownMenu.Portal>
            <DropdownMenu.Content
              className="csa-gen-menu"
              sideOffset={5}
              align="end"
              onCloseAutoFocus={(event) => {
                event.preventDefault();
                triggerRef.current?.focus();
              }}
            >
              {TYPES.map(([k, label]) => (
                <DropdownMenu.Item key={k} asChild>
                  <button type="button">{label}</button>
                </DropdownMenu.Item>
              ))}
            </DropdownMenu.Content>
          </DropdownMenu.Portal>
        </DropdownMenu.Root>
      </div>
    </div>
  );
}

function ContextActions() {
  const triggerRef = useRef(null);
  return (
    <ContextMenu.Root>
      <ContextMenu.Trigger asChild>
        <p ref={triggerRef} className="poc-reading-surface" tabIndex="0">在这段阅读内容上右键，验证有选区时可接管的上下文菜单。</p>
      </ContextMenu.Trigger>
      <ContextMenu.Portal>
        <ContextMenu.Content
          className="csa-gen-menu"
          aria-label="选区上下文菜单"
          onCloseAutoFocus={(event) => {
            event.preventDefault();
            triggerRef.current?.focus();
          }}
        >
          <ContextMenu.Item asChild><button type="button">标红</button></ContextMenu.Item>
          <ContextMenu.Item asChild><button type="button">生成单词卡</button></ContextMenu.Item>
        </ContextMenu.Content>
      </ContextMenu.Portal>
    </ContextMenu.Root>
  );
}

createRoot(document.getElementById('root')).render(
  <StrictMode><div className="stage"><Toolbar /><ContextActions /></div></StrictMode>
);
