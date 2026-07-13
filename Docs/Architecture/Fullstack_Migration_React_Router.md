# 全栈架构迁移方案：Cards Factory + React Router v7

> 状态：**实施中：D0、P0 已完成** · 2026-07-13
> 目标：先收敛产品边界，再完成前后端架构化改造
> 主框架：React Router v7 Framework Mode · React · TypeScript · Vite
> 运行约束：本地单用户 · Docker Compose · 对外端口 3010 · SQLite · 单生成 worker

## 0. 产品决策

当前阶段只保留 **Cards Factory**：

- 三语卡、日语语法卡、场景表达卡生成；
- DeepSeek 生成、OCR、英文/日文 TTS；
- 服务端共享生成队列、失败重试与审计详情；
- 文件夹、历史卡片、删除与标红；
- Markdown-first 学习卡弹窗的 CONTENT / INTEL。

下列产品域于 2026-07-13 正式退役并彻底删除：

- Mission Control；
- Knowledge Hub；
- Knowledge OPS；
- 旧知识分析、关系、分类、同义边界与问题审计；
- 旧 SRS、复习、每日目标、学习计划与难度分级；
- 卡片 KNOWLEDGE tab、SRS footer 与 Knowledge Hub embed 模式。

旧学习辅助与知识图谱的 UI、API、schema 和算法**不是未来设计基线**。前后端迁移完成后，二者作为新的产品项目重新进行用户目标、信息架构、领域模型和技术方案设计。

## 1. 决策摘要

| 议题 | 决策 | 本阶段不做 |
|---|---|---|
| 产品面 | 只迁移 Cards Factory 一个真实页面 | 不为已退役页面建立 React 占位页 |
| React 形态 | React Router v7 Framework Mode + TypeScript | 不一次性重写后端 |
| HTTP API | 现有 Express contract 暂时保持 | 不批量改成 resource routes |
| 模块系统 | React 使用 TS/ESM；后端继续 CJS | 不在根 package 设置 type: module |
| Server state | TanStack Query 统一缓存、轮询与 mutation | 不重复放进 loader 和全局 store |
| Client state | local state/reducer 优先 | 暂不引入 Zustand |
| 样式 | 复用现有 tokens 与视觉规范 | 不继承旧页面 selector |
| 后台任务 | 抽 generation use case 后让 worker 直调 | 不保留 HTTP self-request 作为目标架构 |
| 数据库 | SQLite + WAL + 单 worker | 不做多用户、Postgres 或横向扩容 |

## 2. 退役完成标准

退役不是隐藏导航，必须同时满足：

1. 删除 dashboard.html、knowledge-hub.html、knowledge-ops.html。
2. 删除对应浏览器模块、CSS、Express routes 和 services。
3. 删除 Knowledge/SRS 数据访问模块与 schema 创建语句。
4. 应用启动时 DROP 所有旧 Knowledge/SRS/preferences 表。
5. 删除旧 E2E fixture、测试与视觉快照。
6. 旧页面和旧 API 返回 404。
7. README、CLAUDE 与 Docs 不再把旧子系统列为当前能力。

历史文档可以保留，但必须标为“退役历史参考”，不得进入当前功能导航或指导新实现。

## 3. 当前架构基线

    Browser
      └─ React Router v7 `/`
           ├─ Cards Factory
           ├─ queue/detail
           ├─ Markdown card modal
           └─ health/theme

    server.mjs composition root
      ├─ React Router SSR + client assets
      ├─ /api/generate
      ├─ /api/generation-jobs/*
      ├─ /api/folders + files + highlights
      ├─ /api/history + statistics + search + recent
      ├─ /api/ocr
      ├─ /api/health
      └─ DELETE /api/records/*

    Runtime
      ├─ generation / llm / ocr / tts / observability services
      ├─ storage services + SQLite
      ├─ records filesystem
      └─ one in-process generation worker

迁移前的主要结构问题：

- app.js 同时持有 DOM、流程和状态，难以组件化测试；
- routes/generate.js 仍承担过多业务编排；
- worker 通过 HTTP 自请求 /api/generate 执行；
- CJS 后端与浏览器 ESM 没有显式 composition boundary；
- 前端 API contract 缺少类型与集中缓存策略。

## 4. 目标架构

    Browser
      └─ React Router UI
           ├─ route shell + error boundary
           ├─ feature/factory
           ├─ feature/queue
           ├─ feature/card-modal
           ├─ feature/ocr
           └─ typed API client + TanStack Query

    Port 3010: Express composition root
      ├─ /api/* -> existing Express adapters
      ├─ React assets/document handler
      └─ health/static compatibility assets

    Application
      └─ executeCardGeneration(command, context)
           ├─ generation domain services
           ├─ TTS/OCR/provider adapters
           ├─ persistence ports
           └─ typed result/errors

    Runtime
      ├─ web process
      ├─ one generation worker calling the use case directly
      ├─ SQLite
      └─ records filesystem

### 4.1 模块边界

- **React route/components**：渲染、交互、可访问性。
- **Query hooks**：server state、轮询、mutation、失效。
- **Express routes**：HTTP parsing、状态码、headers、envelope。
- **Application use case**：完整生成编排和事务边界。
- **Domain services**：prompt、后处理、校验、ruby、audio task。
- **Adapters**：DeepSeek、TTS、OCR、SQLite、filesystem。

React 代码不得直接导入数据库或后端 service；后端 route 不得拼接 React UI 状态。

## 5. React Router 与 Express 并存

P0-P4 曾使用专用探针 `/__rr-poc` 保持双轨验证。P5 已完成根路由切换并删除 legacy frontend，当前所有权为：

    /          -> react
    /api/*     -> express
    /__rr-poc  -> 404
    /index.html -> 404

新增小型 ESM composition root：

1. 组合 Express 与 @react-router/express；
2. 通过 CJS interop 加载现有 route；
3. development 使用 Vite middleware；
4. production 加载 React Router server build；
5. 始终只暴露 3010。

## 6. Cards Factory 前端拆分

    app/
      root.tsx
      routes/
        _index.tsx
      features/
        factory/
        card-modal/
      lib/api/
      styles/

当前实现中 queue 与 OCR 是 Cards Factory 的内部能力，分别由 `factory/QueuePanel.tsx` 与 `factory/ocr.ts` 承载；待出现第二个明确消费者后再提升为独立 feature，避免为目录对称提前抽象。

保留现有设计 tokens、卡型配色、light/dark、响应式约束和 testid 行为契约。迁移是实现替换，不是再次改变已确认的信息架构。

## 7. Markdown-first 卡片契约

    Markdown -> marked -> ruby/audio adapter -> DOMPurify -> React wrapper

必须保持：

- DOMPurify 缺失时 fail closed；
- 日语只给汉字加 ruby 注音；
- 英文 MP3、日文 WAV 与播放按钮不变；
- highlight 迁移、保存、恢复不变；
- CONTENT / INTEL 两个 tab；
- 三种卡型和场景短标题规则；
- 桌面与移动端弹窗满高、focus trap、Escape 与焦点归还。

明确删除：KNOWLEDGE tab、SRS footer、?card=&embed=1。

## 8. Generation use case 与 worker

从 routes/generate.js 提取：

    executeCardGeneration(command, context): Promise<GenerationResult>

use case 负责生成、后处理、验证、Markdown/HTML、TTS、文件、DB 与领域错误；HTTP adapter 只负责 request、限流、status 和 JSON envelope。

worker 分两步迁移：

1. use case 与 route parity tests 通过前继续 HTTP self-request；
2. 通过后改为直接调用 use case，并删除 worker bypass header。

独立 worker 前补齐 SQLite busy_timeout、原子 claim、SQLITE_BUSY 有界重试、单 replica 与重启恢复测试。

## 9. 分阶段任务

| 阶段 | 范围 | 完成门禁 |
|---|---|---|
| **D0 退役（完成）** | 删除 Mission/Knowledge/SRS 全栈实现与数据 | 旧 URL/API 404；旧表不存在；核心测试全绿 |
| **P0 架构探针（完成）** | route ownership、React Router composition POC、不可变 viewer 镜像 | dev/prod/container 的 /__rr-poc 可用 |
| **P1 React 基础（完成）** | root、tokens、Query、error boundary、测试框架 | 不接管 /；现有 Cards Factory 无回归 |
| **P2 生成应用层（完成）** | 抽 executeCardGeneration 与 ports | HTTP/直接调用 parity 全绿 |
| **P3 Cards Factory（完成）** | 表单、OCR、queue、folder/list | light/dark × 3 viewport；核心 E2E 全绿 |
| **P4 Card Modal（完成）** | Markdown、ruby、audio、highlight、INTEL | 三类卡、键盘、移动端、XSS 门禁全绿 |
| **P5 路由切换（完成）** | / owner 切 React，删除 legacy frontend | 3010 容器完整回归 |
| **P6 Worker** | worker 直调 use case、SQLite 并发门禁 | retry/recovery/race/shutdown 全绿 |

## 10. 后置产品项目

架构迁移完成后按以下顺序重新启动产品设计：

1. **学习辅助 2.0**：先定义学习者任务、复习机制、反馈闭环和成功指标，再定 schema。
2. **知识图谱 2.0**：先定义图谱要回答的问题、节点/边语义、证据与可解释性，再选存储和可视化。
3. 两者必须通过新的 ADR、用户流程、原型评审和数据模型评审，不复活旧端点或旧表。

## 11. 完成定义

- 运行时只存在 Cards Factory 产品入口；
- 旧页面/API/表/后台任务不再存在；
- React Router 接管根页面，Express API contract 稳定；
- generation route 已收敛为薄 adapter；
- worker 不再通过 HTTP 调自身；
- lint、unit、integration、E2E、visual、smoke、Docker runtime 全绿；
- 学习辅助与知识图谱仍保持冻结，没有以临时占位方式混入迁移。

当前迁移检查点：P5 已完成，React Router 独占 `/`，旧 browser ESM、`/index.html` 与 `/__rr-poc` 已退役。下一阶段仅剩 P6 worker 直调 use case 与 SQLite 并发门禁。
