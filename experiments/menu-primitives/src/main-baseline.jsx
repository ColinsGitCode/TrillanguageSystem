// 基准版：复刻当前 CardModal 的手写工具条 + 卡型菜单
import { StrictMode, useState } from 'react';
import { createRoot } from 'react-dom/client';
import './tokens.css';
import './toolbar.css';

const TYPES = [['trilingual', '单词卡'], ['grammar_ja', '语法卡'], ['scenario_phrase', '场景卡']];

function Toolbar() {
  const [open, setOpen] = useState(false);
  return (
    <div className="card-selection-toolbar" style={{ top: 90, left: 260 }} role="toolbar" aria-label="选区操作"
      onMouseDown={(e) => e.preventDefault()}>
      <button type="button" className="csa-highlight">标红</button>
      <span className="csa-sep" aria-hidden="true" />
      <div className="csa-generate-wrap">
        <button type="button" className="csa-generate" aria-haspopup="menu" aria-expanded={open}
          onClick={() => setOpen((v) => !v)}>生成卡片 ▾</button>
        {open && (
          <div className="csa-gen-menu" role="menu">
            {TYPES.map(([k, label]) => (
              <button key={k} type="button" role="menuitem" onClick={() => setOpen(false)}>{label}</button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
createRoot(document.getElementById('root')).render(<StrictMode><div className="stage"><Toolbar /></div></StrictMode>);
