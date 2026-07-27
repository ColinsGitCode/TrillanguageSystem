# 无头菜单原语 POC（CA-D0 §2.3.1）

回答三个问题：**装了之后外观会变吗？要改多少样式？体积增加多少？**

结论见 [`Docs/Features/Card_Annotation_and_Selection_UX_Evaluation.md`](../../Docs/Features/Card_Annotation_and_Selection_UX_Evaluation.md) §2.3.1：
**建议 Radix**（+28.5 KB gzip、MIT、稳定版）；接入需去嵌套 3 处 CSS 规则。

## 方法

同一个选区工具条实现三遍，**共用从 `app/styles/card-modal.css` 原样抽出的 `src/toolbar.css`**：

| 入口 | 说明 |
|---|---|
| `index-baseline.html` | 手写基准（复刻当前 `CardModal.tsx` 的实现） |
| `index-radix.html` | Radix DropdownMenu |
| `index-aria.html` | React Aria Components |
| `index-radixopen.html` | Radix 受控展开（用于检查 Portal 下的面板渲染） |
| `index-radixfixed.html` | Radix + 去嵌套 CSS（`toolbar-descoped.css`） |

```bash
npm --prefix experiments/menu-primitives install
npm --prefix experiments/menu-primitives run build:baseline
npm --prefix experiments/menu-primitives run build:radix
npm --prefix experiments/menu-primitives run build:aria
```

体积对比（各产物 JS 全量 gzip 后相减）：

```bash
cd experiments/menu-primitives
for v in baseline radix aria; do
  printf "%-9s %s B\n" "$v" "$(find dist/$v -name '*.js' -exec cat {} + | gzip -9 | wc -c)"
done
```

交互查看：`npx vite --port 5199`，然后访问上述任一 html。

## 核心发现

1. **工具条本体零改动即一致**；
2. **菜单面板会先失去全部样式**。两库都把菜单 Portal 到 `document.body`，
   而现有 CSS 是 `.card-selection-toolbar .csa-gen-menu {...}` 这类**后代选择器**，
   菜单移出工具条后全部失配（实测 computed：`position:static`、背景透明、无边框阴影）。
   **修法**：去嵌套 3 处规则——菜单面板、菜单项按钮、按钮基础重置扩展到菜单项。
   见 `src/toolbar-descoped.css` 与 `index-radixfixed.html`。
3. 两库均自动施加正确 ARIA（`aria-haspopup` / `aria-expanded` / `data-state` / 受管 id）。

## 未验证（重要）

**菜单开合与键盘交互未能在浏览器自动化下验证**：两库均不响应合成事件。
已确认挂载、样式与 ARIA 正确，并用受控 `open` 验证面板渲染；
但「点击是否顺畅打开、方向键 / Escape / 焦点返回」**需人工实机确认**。

## 边界

- 依赖只装在本目录，**未修改根 `package.json`**；
- `node_modules/`、`dist/` 已 gitignore；
- 整个目录可直接删除，不影响主应用。
