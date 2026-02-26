# 学习卡片 UI 格式与逻辑编排优化

**版本**: v3.4
**日期**: 2026-02-25
**状态**: 已实施

## 1. 优化概述

本次优化覆盖 7 个维度，全面提升学习卡片 CONTENT 页的阅读体验、视觉层次和内容信息密度。

## 2. 优化清单

### 2.1 P0: H2 语言分隔器重新设计

**之前**: `.mc-content h2 { display: none }` 隐藏所有 H2，三语区块无视觉分隔
**之后**: H2 恢复为带语言颜色竖条 + 右侧延伸线的轻量分隔器

- 英文 → 蓝色 (`--accent-en: #2563eb`)
- 日本語 → 橙色 (`--accent-jp: #f97316`)
- 中文 → 绿色 (`--accent-cn: #10b981`)
- 技术概念 → 灰色

**文件**: `public/modern-card.css`

### 2.2 P0: 音频按钮内联到例句行末

**之前**: `<audio>` 在例句和翻译之间独立一行，打断认知对照流
**之后**: `<audio>` 追加到例句行末尾，前端渲染为内联小型按钮 (28px)

**文件**: `services/htmlRenderer.js` (injectAudioTags), `public/modern-card.css` (.audio-btn)

### 2.3 P1: 外来语标注独立高亮块（升级）

**之前**: `- 外来语标注: English = カタカナ` 普通列表项
**之后**:

- 外来语标注不再与中文释义同行
- 统一渲染为独立 block：
  - `<div class="loanword-block">`
  - `<span class="loanword-label">外来语标注</span>`
  - `<span class="loanword-line"><span class="loanword-tag">English → カタカナ</span></span>`
- 视觉强化：左边框 + 渐变底色 + 粗体胶囊标签

**文件**: `services/contentPostProcessor.js`, `public/modern-card.css`, `services/htmlRenderer.js`, `public/js/modules/app.js`

### 2.4 P1: 中文区块角色重新定位

**之前**: 仅翻译 + 解释（2 字段），视觉单薄
**之后**: 翻译 + 解释 + **语域** + **辨析**（4 字段），淡绿色卡片背景

- **语域**: 正式/口语/书面/通用
- **辨析**: 多义词用法区别或"无"

**文件**: `services/promptEngine.js`, `prompts/phrase_3LANS_markdown.md`, `services/markdownParser.js`, `public/modern-card.css`

### 2.5 P2: 解释字段视觉弱化

**之前**: 翻译、解释、例句视觉权重相同
**之后**: "解释/解説"内容用 `<span class="explanation-text">` 包裹，0.88em + 灰色

**文件**: `services/contentPostProcessor.js` (markExplanationLines), `public/modern-card.css`, `services/htmlRenderer.js`

### 2.6 P2: 渲染管线双路径说明

系统存在两条独立的渲染路径：

| 路径 | 用途 | 文件格式 | 样式体系 |
|------|------|---------|---------|
| 服务端 `renderHtmlFromMarkdown()` | 独立导出/分享 | `.html` | 衬线字体 + 金色主题 |
| 前端 `renderMarkdownWithAudioButtons()` | 弹窗展示 | `.md` → `marked.parse()` | 无衬线 + 蓝色主题 |

两条路径互不干扰。前端不使用 `.html` 文件。

### 2.7 P3: Intel HUD 样式去重

**之前**: `styles.css` 和 `modern-card.css` 各自完整定义了 Intel HUD（2列 vs 3列），`.audio-btn.playing` 定义冲突（蓝色 vs 橙色）
**之后**: 删除 `styles.css` 中约 150 行重复定义，统一以 `modern-card.css` 的 3 列布局为准

**文件**: `public/styles.css`

### 2.8 P0: 历史卡片批量回填（v3.4 新增）

**目标**: 让旧卡片（volume 中历史 md/html）直接升级到新样式，而不是仅依赖运行时兼容。  

**方案**:

- 新增脚本 `scripts/updateLegacyCardStyle.js`
- 扫描 `/data/trilingual_records/**.md`
- 对每张卡片执行：
  1. `contentPostProcessor` 规范化（外来语块、解释行）
  2. `prepareMarkdownForCard` 注音/音频注入
  3. `renderHtmlFromMarkdown` 重新输出 html
- 幂等校验通过：重复执行后 `MD Changed=0, HTML Changed=0`

## 3. 向后兼容性

- 旧卡片（无语域/辨析字段）：正常展示，新字段默认空字符串
- 旧格式外来语标注（`外来语标注: xxx` / 同行内嵌）：
  - 后端生成链路会转换为 block
  - 前端弹窗渲染时也会做一次兼容转换
  - 可通过迁移脚本回填到文件层
- 旧格式音频（独立行 `<audio>`）：前端正则 `<audio\b...src=...>` 不受注入位置影响

## 4. 修改文件索引

| 文件 | 改动类型 |
|------|----------|
| `public/modern-card.css` | H2 分隔器 + 解释弱化 + 外来语高亮块 + 中文卡片 + 按钮尺寸 |
| `public/styles.css` | 删除 HUD 重复定义 + audio-btn.playing 冲突 |
| `services/htmlRenderer.js` | 音频内联注入 + 内嵌 style 同步 |
| `services/contentPostProcessor.js` | 外来语 block 输出 + 旧格式兼容转换 + 解释行幂等修复 |
| `public/js/modules/app.js` | 运行时兼容转换（旧卡片外来语行改写为 block） |
| `scripts/updateLegacyCardStyle.js` | 历史 md/html 批量迁移与幂等回填 |
| `services/markdownParser.js` | initSection 扩展 + 语域/辨析解析 + loanword tag 兼容 |
| `services/promptEngine.js` | 中文区块 prompt 扩展 + few-shot 示例更新 |
| `prompts/phrase_3LANS_markdown.md` | 中文区块模板扩展 |

---

**维护者**: Three LANS Team
