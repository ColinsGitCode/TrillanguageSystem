// Radix 版：同一套 class，行为交给 DropdownMenu
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import * as DropdownMenu from '@radix-ui/react-dropdown-menu';
import './tokens.css';
import './toolbar.css';

const TYPES = [['trilingual', '单词卡'], ['grammar_ja', '语法卡'], ['scenario_phrase', '场景卡']];

function Toolbar() {
  return (
    <div className="card-selection-toolbar" style={{ top: 90, left: 260 }} role="toolbar" aria-label="选区操作"
      onMouseDown={(e) => e.preventDefault()}>
      <button type="button" className="csa-highlight">标红</button>
      <span className="csa-sep" aria-hidden="true" />
      <div className="csa-generate-wrap">
        <DropdownMenu.Root>
          <DropdownMenu.Trigger asChild>
            <button type="button" className="csa-generate">生成卡片 ▾</button>
          </DropdownMenu.Trigger>
          <DropdownMenu.Portal>
            <DropdownMenu.Content className="csa-gen-menu" sideOffset={5} align="end">
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
createRoot(document.getElementById('root')).render(<StrictMode><div className="stage"><Toolbar /></div></StrictMode>);
