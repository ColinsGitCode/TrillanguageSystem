# 文本选取即时生成卡片

**版本**: v3.5
**日期**: 2026-02-26
**状态**: 已实施

## 1. 功能概述

在学习卡片 CONTENT 区域增加**文本选取浮动操作按钮 (FAB)**，实现"即选即查"：用户在阅读卡片时遇到不熟悉的词汇，可直接拖选文字，一键送入生成流程，无需手动复制粘贴。

### 交互流程

```
用户在 #cardContent 中拖选文字
        ↓
浮动按钮出现在选区上方（"✦ Generate Card"）
        ↓
用户点击按钮
        ↓
关闭当前卡片弹窗
        ↓
选中文本填入 phraseInput 输入框 + 自动聚焦
        ↓
用户确认后手动点击 Generate
```

> 设计选择：不自动触发生成，给用户机会修改选中内容（如去掉多余空格、调整范围）。

## 2. 技术实现

### 2.1 核心函数

| 函数 | 文件 | 职责 |
|------|------|------|
| `initSelectionToGenerate(container)` | `public/js/modules/app.js` | 创建 FAB 元素、绑定 mouseup/selectionchange/click 事件 |
| `checkSelection(container, fab)` | `public/js/modules/app.js` | 检测选区是否在 container 内、计算 FAB 定位、控制显隐 |

### 2.2 事件机制

- **mouseup** (container): 选取完成后延迟 10ms 检查选区
- **selectionchange** (document): 处理键盘选取与选区清除
- **mousedown** (FAB): `e.preventDefault()` 防止点击时选区被浏览器清除
- **click** (FAB): 读取选中文本 → `closeModal()` → 填入输入框 → 聚焦

### 2.3 选区定位算法

```js
const range = sel.getRangeAt(0);
const rect = range.getBoundingClientRect();
fab.style.top = `${rect.top + window.scrollY - 40}px`;    // 选区上方 40px
fab.style.left = `${rect.left + window.scrollX + rect.width / 2}px`;  // 水平居中
// CSS transform: translateX(-50%) 实现自身居中
```

### 2.4 边界处理

| 场景 | 处理方式 |
|------|----------|
| 选中文字包含 "▶" (音频按钮) | 正则过滤 `text.replace(/▶/g, '')` |
| 选取超过 200 字符 | FAB 不出现（防止将整段文字送入生成） |
| 选取发生在 INTEL / REVIEW tab | FAB 不出现（仅监听 `#cardContent` 容器） |
| 关闭弹窗时 | `closeModal()` 中清理 FAB 显隐 + 清除选区 |
| 重复打开不同卡片 | `initSelectionToGenerate` 先移除旧 FAB 再创建新实例 |

## 3. 样式设计

FAB 使用蓝色主题（与系统 `--accent: #2563eb` 一致），带投影和过渡动画：

```css
.selection-gen-fab {
    position: absolute;
    z-index: 10001;          /* 高于 modal z-index */
    background: #3b82f6;
    color: white;
    border-radius: 6px;
    font-family: 'JetBrains Mono', monospace;
    font-size: 12px;
    box-shadow: 0 4px 12px rgba(59, 130, 246, 0.4);
}
```

隐藏态带 `opacity: 0` + `pointer-events: none` + 微小位移动画，避免闪烁。

卡片内容区选中文字高亮色使用半透明蓝：`rgba(59, 130, 246, 0.2)`。

## 4. 调用链路

```
renderCardModal()                          // app.js:1480
  └── initSelectionToGenerate(cardContent)  // app.js:1072
        ├── mouseup → checkSelection()     // 检测选区
        └── click → closeModal()           // 关闭弹窗
                  → els.phraseInput.value   // 填入输入框
                  → els.phraseInput.focus()  // 聚焦
```

用户后续手动点击 Generate → `initGenerator()` → `api.generate(phrase)` → 正常生成流程。

## 5. 修改文件清单

| 文件 | 改动类型 | 改动量 |
|------|----------|--------|
| `public/js/modules/app.js` | 新增 `initSelectionToGenerate()` + `checkSelection()`，修改 `renderCardModal()` + `closeModal()` | +58 行 |
| `public/styles.css` | 新增 `.selection-gen-fab` 样式 + `#cardContent ::selection` | +30 行 |

## 6. 浏览器兼容性

- `window.getSelection()` / `Range.getBoundingClientRect()`: 所有现代浏览器
- `selectionchange` 事件: Chrome 90+, Firefox 92+, Safari 15.4+
- 最低要求与项目现有基线一致 (Chrome 90+ / Firefox 88+ / Safari 14+)

---

**维护者**: Three LANS Team
