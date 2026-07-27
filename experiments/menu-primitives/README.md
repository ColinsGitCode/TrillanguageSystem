# 无头菜单原语 POC（CA-D0 §2.3.1）

回答三个问题：**装了之后外观会变吗？要改多少样式？体积增加多少？**

结论见 [`Docs/Features/Card_Annotation_and_Selection_UX_Evaluation.md`](../../Docs/Features/Card_Annotation_and_Selection_UX_Evaluation.md) §2.3.1：
**建议 Radix**（下拉菜单 + 右键菜单均已打包并验证、MIT、稳定版）；接入需去嵌套 3 处 CSS 规则。

## 方法

同一个选区工具条实现三遍，均从 `app/styles/card-modal.css` 的视觉规则出发；Radix 采用 `toolbar-descoped.css`，它只把 Portal 后失效的 3 条后代选择器改为全局菜单规则，不改变 token、尺寸或配色：

| 入口 | 说明 |
|---|---|
| `index-baseline.html` | 手写基准（复刻当前 `CardModal.tsx` 的实现） |
| `index-radix.html` | Radix DropdownMenu + ContextMenu（实际采用候选） |
| `index-aria.html` | React Aria Components |
| `index-radixopen.html` | Radix 受控展开（用于检查 Portal 下的面板渲染） |
| `index-radixfixed.html` | Radix + 去嵌套 CSS（`toolbar-descoped.css`） |

```bash
npm --prefix experiments/menu-primitives install
npm --prefix experiments/menu-primitives run build:baseline
npm --prefix experiments/menu-primitives run build:radix
npm --prefix experiments/menu-primitives run build:aria
npm --prefix experiments/menu-primitives run verify
```

体积对比（各产物 JS 全量 gzip 后相减）：

```bash
cd experiments/menu-primitives
for v in baseline radix aria; do
  printf "%-9s %s B\n" "$v" "$(find dist/$v -name '*.js' -exec cat {} + | gzip -9 | wc -c)"
done
```

交互查看：在同一终端执行：

```bash
cd experiments/menu-primitives
npx vite --port 5199
```

随后访问上述任一 html。不要从仓库根目录执行 `npx vite`，否则 Vite 会误读主项目配置。

## 核心发现

1. **工具条本体零改动即一致**；
2. **菜单面板会先失去全部样式**。两库都把菜单 Portal 到 `document.body`，
   而现有 CSS 是 `.card-selection-toolbar .csa-gen-menu {...}` 这类**后代选择器**，
   菜单移出工具条后全部失配（实测 computed：`position:static`、背景透明、无边框阴影）。
   **修法**：去嵌套 3 处规则——菜单面板、菜单项按钮、按钮基础重置扩展到菜单项。
   见 `src/toolbar-descoped.css` 与 `index-radixfixed.html`。
3. 两库均自动施加正确 ARIA（`aria-haspopup` / `aria-expanded` / `data-state` / 受管 id）。Radix 的实际构建同时引入了 `dropdown-menu` 与 `context-menu`；React Aria 比较范围仅是下拉菜单，不作为右键菜单的等价实现。

## 自动化验证

`npm --prefix experiments/menu-primitives run verify` 会启动隔离 Vite 服务，并使用 Playwright 的可信浏览器事件验证：

- Radix 与 React Aria 的下拉菜单：点击、方向键、Escape；Radix 包装层额外验证 Escape 后焦点返回触发按钮；
- Radix 右键菜单：可信右键点击、方向键、Escape；
- Radix 菜单与手写基准的 computed style / 布局契约一致。

之前失败的是页面内手工派发的合成事件，不是浏览器自动化能力限制。因此不再把“人工点击确认”当成唯一门禁；真人验收仍有价值，但不是证据缺口。生产接入时仍要保留 Radix 的 `onCloseAutoFocus` 包装，因原工具条的全局 `mousedown.preventDefault()` 会影响默认焦点恢复。

## 边界

- 依赖只装在本目录，**未修改根 `package.json`**；
- `node_modules/`、`dist/` 已 gitignore；
- 整个目录可直接删除，不影响主应用。
