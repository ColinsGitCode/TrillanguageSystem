---
description: 三语短语说明的HTML生成指南（配合 phrase_3LANS.md 使用）
argument-hint: 'phrase'
---

用于在完成 `codex_prompt/phrase_3LANS_markdown.md` 生成的 Markdown 后，再生成同名 HTML 文件，确保排版、注音正确显示。

$ARGUMENTS
- phrase: 待识别的短语，可包含空格或特殊字符。

## 基本规则
1. 先按 `phrase_3LANS_markdown.md` 完成 Markdown 输出，文件保存到 `/Users/xueguodong/Desktop/trilingual_records/<YYYYMMDD>/`（日期为当天，不存在则创建路径；文件名由系统统一安全化处理）。
2. 在同一路径生成对应 HTML（后缀 `.html`），正文内容来源于上一步的 Markdown，保持原有结构、ruby 标签和示例格式。
3. 禁止引入额外颜色主题指令（保持默认主题即可），如需再调色，应与用户确认后单独修改。

## HTML 布局与样式要求
- 使用统一衬线字体栈，兼顾中/日/英显示，无乱码与大小跳变：
  - 正文字体：`'Noto Serif CJK JP', 'Noto Serif CJK SC', 'Source Han Serif', 'Songti SC', 'Hiragino Mincho ProN', 'Yu Mincho', 'SimSun', 'Georgia', 'Times New Roman', serif`
  - ruby 注音字体：`'Noto Sans JP', 'Hiragino Sans', 'Noto Sans SC', 'PingFang SC', 'Microsoft YaHei', 'Source Han Sans', sans-serif`
- 全局字体基准：`html, body` 设置为常规的约 150%（如 `font-size: 1.5rem`），整体字号放大 50% 且保持 rem 比例，不需逐项放大。
- 页面背景：柔和浅色渐变；主体内容卡片居中，宽度在常规设定上放大约 50%（如 `max-width: 1200px; width: 90%;`），圆角、细描边、轻阴影。
- 标题：`h1` ~ `h2` 采用左侧强调线（`h2`），行高 1.35，`h1` 字号约 2.1rem，`h2` 约 1.5rem。
- 列表：去掉默认项目符号，使用自定义圆点（CSS `li::before { content: '•'; color: var(--accent); }`），内边距适配。
- 行高与间距：正文行高 1.6；段落与列表项上下留白适度（约 0.2~0.8em）。
- ruby 注音：`rt` 字号 0.65em，颜色中性灰。若 Markdown 中使用 `漢字(かな)` 格式，需在 HTML 中转换为 `<ruby>漢字<rt>かな</rt></ruby>`。
- 响应式：移动端宽度 <720px 时，卡片左右内边距适当缩小，标题字号略降。
- 语音控件：如有朗读音频，为 `<audio>` 增加 `.audio` 容器，`audio` 宽 100%、最大 360px，控件上下留 0.15~0.45em。

## 生成步骤（脚本思路）
1. 读取 Markdown 文本，保留现有的标题、列表、段落、ruby 标签。
2. 将 Markdown 渲染为 HTML（可用简易解析，或 markdown 库；必要时用基本解析以避免代码块逃逸）。
3. 必须为英文例句与日文例句分别生成朗读音频，命名：`<base_filename>_en_1.wav`、`<base_filename>_en_2.wav`、`<base_filename>_ja_1.wav`、`<base_filename>_ja_2.wav`；其中 `<base_filename>` 由系统提供并统一控制。音频由本地 TTS 接口生成后直接写入 HTML 同目录保存；在对应例句文本后立即插入 `<div class="audio"><audio controls src="<file>"></audio></div>`，保持与 Markdown 顺序一致。
4. 用上述 CSS 包裹为完整 HTML 文档，确保所有日语汉字注音均以 `<ruby>` 结构呈现：
   - `<!doctype html>`，`lang="ja"`，`<meta charset="utf-8">`，viewport 适配。
   - 包含主体容器 `.main` 和 `.card`。
   - 底部可附简短 footer，如“生成: <phrase> — 標準カラー版”。
5. 写入同目录的 `<phrase>.html`，UTF-8 编码。

## 产出位置
- Markdown：`/Users/xueguodong/Desktop/trilingual_records/<YYYYMMDD>/<phrase>.md`
- HTML：同目录 `/Users/xueguodong/Desktop/trilingual_records/<YYYYMMDD>/<phrase>.html`

## 注意
- 保持与 Markdown 内容一致，不新增或删减文本。
- 确保 ruby 标签在 HTML 中原样输出，以便浏览器正确渲染注音。
- 默认配色为温和浅色系 + 深色正文，如需自定义颜色须得到用户明确同意。
- 禁止输出任何 `<script>/<iframe>/<object>/<embed>` 标签或外链资源，仅使用内联 CSS。
