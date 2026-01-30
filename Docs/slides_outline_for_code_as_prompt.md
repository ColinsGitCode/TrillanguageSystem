# Code as Prompt: 构建下一代三语智能知识库
## Presentation Outline for PPTX

---

## Slide 1: 封面 (Title Slide)
- **Main Title**: Code as Prompt: 构建下一代三语智能知识库
- **Subtitle**: 从生成式脚本到结构化学习系统的演进
- **Presenter**: [Your Name/Team]
- **Date**: 2026-01-30

---

## Slide 2: 项目愿景与核心痛点 (Vision & Pain Points)
- **当前痛点**:
    - 手工制作语言学习卡片效率低。
    - 静态 HTML 档案难以检索和复习。
    - 缺乏语境化的例句和地道的发音。
- **项目目标**:
    - **自动化**: 输入短语，一键生成中/日/英三语对照卡片。
    - **结构化**: 从非结构化文本转向关系型知识库。
    - **智能化**: 利用 LLM (Gemini) 进行内容生成与定期归纳。

---

## Slide 3: 核心理念: "Code as Prompt" (The Core Philosophy)
- **定义**: 将 Prompt 视为代码的一部分，而非简单的字符串拼接。
- **实施机制**:
    - **模块化**: 将 Prompt 拆分为 Role, Few-shot Examples, Reasoning Steps, JSON Schema。
    - **强契约 (Strict Contract)**: 强制 LLM 输出严格的 JSON 格式，与后端代码的类型定义强耦合。
    - **动态注入**: 根据运行时上下文（如语言检测）动态组装 Prompt。
- **优势**:
    - 降低幻觉 (Hallucination)。
    - 提高输出的可编程性与稳定性。

---

## Slide 4: 架构设计: 生成与编排 (Architecture: Generation)
- **后端中枢 (Node.js/Express)**:
    - 业务编排中心，连接 LLM 与本地服务。
- **AI 逻辑引擎 (Gemini API)**:
    - 模型: Gemini 1.5 Flash/Pro。
    - 职责: 语义理解、多语翻译、HTML/Markdown 结构生成。
- **本地语音引擎 (Local TTS Container)**:
    - **Hybrid 方案**: 结合云端智能与本地隐私/速度。
    - **英文**: Piper HTTP (轻量、快速)。
    - **日文**: VOICEVOX Engine (自然韵律)。
- **Visual**: 展示从 用户输入 -> Prompt Engine -> Gemini -> TTS -> 文件存储 的流程图。

---

## Slide 5: 前端重构: 现代学术风 UI (Modern Academic UI)
- **设计目标**: 摒弃旧版 iframe 嵌套，实现原生 DOM 渲染与沉浸式体验。
- **视觉风格 (Modern Academic)**:
    - **排版**: 衬线体标题 (Noto Serif) + 无衬线正文 (Inter/Roboto)。
    - **配色**: 纸质背景 (#FAFAF9) + 深灰墨色文字 (#2D2D2D)。
    - **强调色**: 英文(蓝)、日文(朱红)、中文(墨绿)。
- **交互创新**:
    - **Markdown 实时渲染**: 前端解析 `.md`，无需后端预生成 HTML。
    - **自定义音频控件**: 替换原生 `<audio>` 标签，使用交互式播放按钮 (▶/||)。

---

## Slide 6: 数据层演进: 从文件到知识库 (Data Evolution)
- **Current State (Phase 1)**:
    - 基于文件系统 (File-based)。
    - 存储为 Markdown + Audio Files。
    - 优点: 便于备份，Human-readable。
- **Future State (Phase 2 - Smart KB)**:
    - 引入 **SQLite + Prisma ORM**。
    - **结构化存储**: Phrase, Example, Translation, Tag 表。
    - **混合存储策略**: 数据库存元数据与索引，文件系统存大文件(音频)。

---

## Slide 7: 智能化升级: 归纳与检索 (Intelligence Upgrade)
- **定期归纳 Agent (Review Agent)**:
    - 后台 Cron Job 定期运行。
    - 利用 Gemini 长窗口能力分析近期词条。
    - 产出: 自动分类标签 (#Business, #Idiom)、语法模式总结报告。
- **高级检索 (Discovery)**:
    - **全文检索**: 跨语言搜索例句与释义。
    - **语义检索**: 基于 Embedding 寻找“意思相近”的表达。
    - **知识图谱**: 自动关联相关词条与语法点。

---

## Slide 8: 落地路线图 (Roadmap)
- **Phase 1: 基础构建 (已完成)**
    - Code as Prompt 引擎。
    - Gemini + 本地 TTS 集成。
    - 现代学术风 UI 重构。
- **Phase 2: 数据结构化 (进行中)**
    - SQLite 数据库集成。
    - 历史数据清洗与入库 (Backfill)。
- **Phase 3: 智能闭环 (规划中)**
    - 开发 Review Agent。
    - 实现语义搜索与知识图谱可视化。

---

## Slide 9: 总结 (Summary)
- 本项目通过 **Code as Prompt** 理念，成功将 LLM 的生成能力工程化。
- 结合 **本地 TTS** 与 **现代 UI**，提供了极致的语言学习体验。
- 向 **智能知识库** 的转型，将把“碎片化输入”转化为“体系化知识”。

---

## Slide 10: Q&A
- Thank you!
