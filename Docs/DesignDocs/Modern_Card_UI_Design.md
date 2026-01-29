# 现代学术风学习卡片 UI 设计方案

## 1. 设计目标 (Design Goals)
*   **脱离 iframe**: 摒弃传统的 `iframe` 加载方式，采用原生 DOM 渲染，提升加载速度与交互流畅度。
*   **现代学术美学 (Modern Academic Aesthetic)**: 结合纸质阅读的舒适感与现代 Web 的交互性。风格关键词：**极简、衬线体、呼吸感、结构化**。
*   **沉浸式体验**: 优化查看详情的转场动画与布局，使其更像是在阅读一张精心设计的知识卡片。

## 2. 视觉风格定义 (Visual Identity)

### 2.1 字体系统 (Typography)
采用 **“衬线标题 + 无衬线正文”** 的经典学术搭配：
*   **标题 (Display/Headings)**: `Noto Serif SC` (中), `Playfair Display` 或 `Lora` (英)。营造典雅、权威感。
*   **正文 (Body)**: `Inter`, `Roboto`, `Noto Sans SC`。确保小字号下的易读性。
*   **注音/标签 (Utility)**: `JetBrains Mono` 或 `Roboto Mono`。用于音标、代码块或技术细节。

### 2.2 配色方案 (Color Palette)
模拟高级纸张与印刷油墨的质感：
*   **背景 (Canvas)**: `#FAFAF9` (Warm Paper) 或 `#FFFFFF` (Pure White)。
*   **文字 (Ink)**: `#2D2D2D` (Charcoal) - 避免纯黑，减少视觉疲劳。
*   **次要文字**: `#666666` (Slate)。
*   **强调色 (Accents)**:
    *   *English*: `#3B82F6` (Academic Blue - 沉稳蓝)
    *   *Japanese*: `#BC4749` (Vermilion - 朱红/印泥色)
    *   *Chinese*: `#10B981` (Emerald - 墨绿)
*   **边框/分割**: `#E5E5E5` (Light Gray)。

### 2.3 卡片形态 (Card Physics)
*   **圆角**: `12px` (适中，不圆润也不尖锐)。
*   **阴影**: `0 4px 6px -1px rgba(0, 0, 0, 0.05)` (低投影，强调平面质感)。
*   **边框**: `1px solid rgba(0,0,0,0.05)` (细微描边)。

## 3. 界面布局设计 (Layout)

### 3.1 列表页 (Dashboard)
保持左侧导航，优化右侧文件列表：
*   **Grid View**: 将文件列表从纯文本链接改为**“微缩卡片”**。
    *   每个微缩卡片显示：`Phrase` (大字), `Date` (右下角小字), `Tags` (如有)。
    *   Hover 效果：轻微上浮，阴影加深。

### 3.2 详情页 (Detail View - The "Card")
点击微缩卡片后，不使用模态框，而是使用 **右侧滑动抽屉 (Slide-over)** 或 **中心模态浮层 (Centered Modal)**，内容布局如下：

#### A. 头部 (Header)
*   **核心短语 (Hero Phrase)**: 居中/左对齐，超大字号 (3rem)，衬线体。
*   **音标/注音**: 紧随其后，使用灰色等宽字体。
*   **操作区**: 顶部右侧提供 `Play Audio` (全部播放), `Edit`, `Close` 按钮。

#### B. 内容区 (Content Body)
采用 **“块状结构”** 分隔不同语言的内容：

1.  **释义块 (Definition Block)**:
    *   图标/标签指示语言（如 "EN", "JP"）。
    *   释义文本高亮显示。

2.  **例句块 (Example Block)**:
    *   **句子**: 左侧竖线引用样式。
    *   **交互式音频**: 每句例句旁有一个圆形的 `▶` 按钮。点击变色并播放。
    *   **注音 (Ruby)**: 日文例句默认显示 Ruby，可点击开关隐藏。

#### C. 底部 (Footer)
*   **元数据**: 生成时间、模型版本。
*   **标签**: 自动生成的语义标签（如 #Business, #Casual）。

## 4. 技术实现路径 (Implementation Path)

### 4.1 数据源变更
*   **现状**: 后端直接返回 HTML 字符串。
*   **新方案**:
    *   后端 API `/api/folders/:folder/files/:file` 检测到请求头 `Accept: application/json` 时，**返回 JSON 数据**。
    *   或者，前端直接读取 Markdown 文件，在前端使用 `marked` + 自定义渲染器解析。
    *   **推荐**: 后端增加解析逻辑，返回结构化 JSON：
        ```json
        {
          "phrase": "Take a rain check",
          "phonetic": "/.../",
          "definitions": { "en": "...", "zh": "...", "ja": "..." },
          "examples": [
            { "text": "...", "translation": "...", "lang": "en", "audio": "path/to/audio.m4a" }
          ]
        }
        ```
        *(注：这需要后端具备从 Markdown 反向解析出结构化数据的能力，或者我们在生成时就保存一份 `.json` 副本。考虑到兼容旧数据，前端解析 Markdown 是更通用的方案。)*

### 4.2 前端重构
*   引入 **Markdown 解析库** (如 `marked` 或 `markdown-it`) 到前端。
*   引入 **UI 渲染逻辑**:
    *   使用 Template Literals 或轻量级框架 (如 Alpine.js / Preact，如果不引入重型框架) 来动态生成卡片 HTML。
    *   实现音频播放状态管理 (Playing/Stopped)。

## 5. 交互流程 (User Flow)
1.  用户点击列表中的 "Take a rain check"。
2.  界面变暗，中央浮现一张白色卡片 (带有轻微的入场动画 `fade-in-up`)。
3.  卡片加载时显示骨架屏 (Skeleton)。
4.  前端请求 `.md` 文件内容。
5.  解析 Markdown 为 DOM 结构并填充。
6.  用户点击例句旁的播放按钮，图标变为 `||` (暂停) 或声波动画，音频播放。
7.  点击卡片外区域或关闭按钮，卡片下沉消失。

## 6. 后续扩展
*   **Anki 导出**: 既然有了结构化展示，可以轻松添加“导出为 Anki 卡片”功能。
*   **深色模式**: 基于 CSS Variables 定义颜色，一键切换 Dark Mode。
