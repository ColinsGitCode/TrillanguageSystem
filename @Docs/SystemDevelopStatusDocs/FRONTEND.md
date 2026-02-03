# 📱 前端架构文档

**项目**: Trilingual Records
**版本**: 2.1 (Sci-Fi Theme & Observability)
**更新日期**: 2026-02-03

---

## 📂 文件结构

```
public/
├── index.html                    # 主应用页面
├── dashboard.html                # Mission Control 仪表盘
├── styles.css                    # 主样式表（含 Sci-Fi 主题系统 & HUD 样式）
├── css/
│   └── dashboard.css             # Mission Control 专用布局样式
└── js/
    ├── dashboard.js              # [已废弃] 旧版 dashboard 脚本
    └── modules/                  # ES6 模块（核心架构）
        ├── app.js                # 主应用入口 (Card Modal, Generator, History)
        ├── dashboard.js          # Mission Control 逻辑 (D3 Charts, Real-time Data)
        ├── api.js                # API 调用封装
        ├── store.js              # 状态管理 (Pub/Sub)
        ├── utils.js              # 工具函数 (Formatter, Sanitizer)
        ├── audio-player.js       # 全局音频播放器单例
        └── virtual-list.js       # 虚拟列表渲染 (Performance)
```

---

## 🏗️ 架构设计

### 技术栈
- **原生 HTML/CSS/JS** - 无构建工具，零依赖，直接运行
- **ES6 Modules** - 浏览器原生模块系统 (`<script type="module">`)
- **外部依赖**:
  - `marked.js` - Markdown 渲染
  - `DOMPurify` - XSS 防护
  - `D3.js v7` - 数据可视化（Dashboard & Card Intel）

### 模块化原则
1. **单一职责** - 每个模块专注一个功能域
2. **显式依赖** - 通过 `import/export` 声明
3. **状态隔离** - 全局状态通过 `store.js` 管理
4. **API 统一** - 所有后端调用通过 `api.js`

---

## 📄 页面结构与 UI 系统

### 1. 主应用 (`index.html`)

#### 视觉风格：Clean & Modern
- **背景**: 柔和渐变与噪点纹理
- **卡片**: 白色悬浮卡片，微阴影
- **字体**: Space Grotesk (标题) + Noto Serif (正文)

#### 核心组件

**A. 生成面板 (Generator)**
- 始终可见，位于左侧
- **文本模式**: 直接输入短语
- **OCR 模式**: 拖拽/粘贴图片自动识别
- **进度条**: 9阶段细粒度可视化 (Init -> Prompt -> LLM -> TTS -> Complete)

**B. 资源浏览区 (Tabbed Panel)**
- **Tab 1: 文件夹**: 按月份/日期分组的折叠列表
- **Tab 2: 历史记录**: 
  - 支持本地防抖搜索
  - Provider 过滤 (Local/Gemini)
  - 虚拟滚动列表 (Virtual List) 以支持大量记录
  - 右键上下文菜单 (Context Menu) 支持删除

**C. Phrase List (Grid View)**
- 多列自适应网格 (`grid-template-columns: repeat(auto-fill, minmax(210px, 1fr))`)
- 卡片式交互，点击打开详情弹窗

**D. 学习卡片弹窗 (Card Modal)**
- **设计**: Sci-Fi 玻璃拟态风格 (Glassmorphism)
- **Tab 1: CONTENT**: 
  - 渲染后的 Markdown 学习内容
  - 集成 TTS 音频播放按钮
- **Tab 2: INTEL (Tactical HUD)**:
  - **Quality Reactor**: 全息圆环展示质量评分 (Rank S/A/B)
  - **Chrono Waterfall**: D3 甘特图展示生成耗时 (Prompt/LLM/Parse/TTS)
  - **Token Flux**: 堆叠能量条展示 Input/Output Token 消耗
  - **Dimensional Scan**: 雷达图展示质量维度分析

### 2. Mission Control (`dashboard.html`)

#### 视觉风格：Sci-Fi / Observability
- **背景**: 深蓝黑 (`#0f172a`) + 动态渐变
- **面板**: 磨砂玻璃 (`backdrop-filter: blur(12px)`) + 霓虹边框
- **配色**: 
  - 🟢 Success / Quality > 80
  - 🔵 Gemini / Cloud
  - 🟣 Local / Compute
  - 🟠 Warning / Latency

#### 核心模块 (Bento Grid v2)

| 模块 | 类型 | 功能描述 |
|------|------|----------|
| **Infrastructure** | Status Matrix | 服务健康状态信号灯 (LLM Core, TTS Engines) |
| **API Fuel** | Gauge Chart | 配额/预算使用率仪表盘 |
| **Data Core** | Progress Bar | 存储空间使用情况可视化 |
| **Model Arena** | VS Panel | Gemini vs Local LLM 性能/质量/成本对比 |
| **Quality Signal** | Area Glow Chart | 7天/30天质量趋势辉光图 |
| **Live Feed** | Ticker | 实时生成的日志流 (模拟终端效果) |

---

## 🔧 核心模块详解

### `app.js` - 主控中心
- 负责 `index.html` 的所有交互逻辑
- **Modal Rendering**: 动态注入 HTML 结构，包括复杂的 HUD 布局
- **D3 Integration**: 在 `renderIntelCharts` 中调用 D3 绘制卡片级图表

### `dashboard.js` - 仪表盘逻辑
- 负责 `dashboard.html` 的数据流
- **Polling**: 每 10s 轮询 `/api/health` 和 `/api/statistics`
- **Visualization**: 使用 D3 `join()` 模式实现图表的平滑过渡更新

### `virtual-list.js` - 性能核心
- 实现定高虚拟滚动
- 仅渲染视口内的 DOM 节点
- 解决数千条历史记录导致的页面卡顿问题

### `audio-player.js` - 音频单例
- 全局唯一的 `Audio` 实例
- 播放新音频时自动停止旧音频
- 管理播放按钮的 UI 状态 (Play/Pause/Loading)

---

## 🚀 性能优化

1.  **Virtual Scrolling**: 文件列表和历史记录列表采用虚拟渲染，DOM 节点数恒定。
2.  **D3 Transitions**: 图表更新使用平滑过渡，而非销毁重建，减少重绘开销。
3.  **Glassmorphism Optimization**: 使用 CSS 变量和合成层优化模糊效果渲染。
4.  **Debounced Search**: 历史记录搜索输入防抖 (500ms)。

---

## 🔗 相关文档
- [repo_status.md](./repo_status.md) - 项目全貌
- [API.md](./API.md) - 后端接口规范
- [CONSISTENCY_CHECK.md](./CONSISTENCY_CHECK.md) - 代码与文档一致性报告

---

**维护者**: Three LANS Team
**最后更新**: 2026-02-03
