// React Aria 版：同一套 class
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { MenuTrigger, Button, Popover, Menu, MenuItem } from 'react-aria-components';
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
        <MenuTrigger>
          <Button className="csa-generate">生成卡片 ▾</Button>
          <Popover>
            <Menu className="csa-gen-menu">
              {TYPES.map(([k, label]) => <MenuItem key={k} id={k}>{label}</MenuItem>)}
            </Menu>
          </Popover>
        </MenuTrigger>
      </div>
    </div>
  );
}
createRoot(document.getElementById('root')).render(<StrictMode><div className="stage"><Toolbar /></div></StrictMode>);
