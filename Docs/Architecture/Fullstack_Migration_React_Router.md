# 全栈迁移方案：React Router v7 · TypeScript（保内核，换外壳）

> 状态：**设计方案（待实施）** · 2026-07
> 已定决策：主框架 **React Router v7 (Remix)** · **TypeScript 全栈** · **Vite** · `better-sqlite3` 保留（自用阶段暂不上 Postgres）· **TanStack Query** · **shadcn/ui + 现有 tokens** · **Playwright 全程兜底** · 逐页并存迁移
> 约束：先产品级化、暂仍自用 · Mac 本地 / Docker · 保护现有测试与生成管线资产
> 关联：[UI 现代化设计系统](../Features/UI_Modernization_Design_System.md) · [Trilingual Card Generation System](Trilingual_Card_Generation_System.md)
> 影响面：`server.js` · `routes/`（12 文件 / 55 端点）· `services/`（64 CJS 文件，TS 化）· `public/`（前端全量）· `package.json`（CJS→ESM）· 测试 harness

本文是"引入前端框架 + 全栈化"的真源。**核心原则：全栈重写只碰 HTTP 边界与 UI；`services/` + `db/` + 生成管线 + 单元测试是内核，保留。** 这样"重写"从高风险推倒变成"换外壳、保内核"。

---

## 0. 与刚完成的 UI 现代化如何衔接（先回答这个）

刚落地的 UI 现代化（`tokens.css` / `app-shell` / `components.css` / 明暗主题）**不是白做**，但要分清哪层保留、哪层被取代：

| UI 现代化产出 | 全栈迁移里的命运 |
|--------------|-----------------|
| `tokens.css`（颜色/间距/圆角/字体/明暗主题） | ✅ **保留**，作为 React 组件的样式底座（shadcn/ui 直接消费 CSS 变量） |
| 设计规范（卡型色、语言色、组件原语定义、无障碍约束） | ✅ **保留**，是 React 组件的验收标准 |
| `app-shell.js` / `dashboard.js` / `app.js`（命令式 DOM + 模板字符串） | ⛔ **被 React 组件取代**——命令式渲染正是引入框架要消除的 |
| Playwright e2e + testid | ✅ **保留**，跨框架兜底 |

一句话：**设计系统层保留并迁入 React,实现层(命令式 DOM)被 React 取代。** UI 现代化把"设计语言"沉淀成了 token 与规范,这正是 React 组件化的输入。

---

## 1. 现状核实（迁移摩擦点，实测）

| 事实 | 数据 | 对迁移的影响 |
|------|------|-------------|
| 后端模块系统 | **64 文件纯 CommonJS**（`module.exports`），0 ESM | Remix/Vite 是 ESM，存在 CJS↔ESM 边界（§4.1） |
| 前端模块系统 | 12 文件 **ESM**（`import/export`） | 前端可较平滑迁入 React |
| HTTP 面 | **12 route 文件 / 55 端点** | 逐端点迁 loader/action 的工作量基准 |
| 后台 worker | `generation_jobs` worker **靠给自己发 HTTP**（`X-Generation-Job-Worker:1`）驱动，绑在 `app.listen` | Remix 无常驻 worker 概念（§4.2） |
| 数据库 | `better-sqlite3` **同步 API** | 在 async loader 里调同步 DB（§4.3） |
| 测试 | 集成测试 `require('server.js')` boot 真实 Express | 过渡期 harness 要指向 Express + Remix（§9） |
| package.json | 无 `"type"` → 默认 CommonJS | 迁移后整体切 ESM |

---

## 2. 资产命运表（保留 vs 重写）

| 资产 | 命运 | 说明 |
|------|------|------|
| `services/`（cardGeneration、knowledge、srs、observability、storage/db） | ✅ 保留（TS 化 + 转 ESM） | 框架无关业务逻辑；从 Express route 调用改为 loader/action 调用 |
| `services/storage/db/*` + `better-sqlite3` | ✅ 保留 | 自用阶段维持 SQLite，不碰 Postgres |
| `lib/`（logger、serverConfig、生成 helpers、throttle） | ✅ 保留（TS 化） | 纯基础设施 |
| 生成管线 / TTS / Markdown-first 渲染 | ✅ 保留 | `card-renderer` adapter 逻辑平移进 React 组件 |
| `database/schema.sql` + 迁移 | ✅ 保留 | 不动数据层 |
| `tests/unit/`（node:test，测 services） | ✅ 保留 | 与 HTTP 框架无关 |
| `tests/integration/`（boot Express） | 🔧 演进 | harness 指向 Remix handler（§9） |
| `tests/e2e/`（Playwright） | ✅ 保留 | testid 跨框架不变 |
| `routes/`（12 文件 / 55 端点） | ⛔ 重写 | 迁成 Remix loader/action |
| `server.js` | 🔧 改造 | 变成 Remix + Express 并存入口（§3），worker 抽出（§4.2） |
| `public/*.html` + `public/js/modules/*`（命令式） | ⛔ 重写 | 迁成 React 路由与组件 |
| `public/css/*` + `tokens.css` | ✅ 保留 | 迁入 React 作样式底座 |

---

## 3. 核心迁移机制：Remix 挂在 Express 上并存（无痛过渡的钥匙）

React Router v7 / Remix 官方支持 `@react-router/express`——**可作为 middleware 挂在现有 Express app 上**。所以过渡不是"两个 server 互相 proxy"，而是**同一个 Express app 里 Remix 与旧 routes 并存**，逐个端点从旧 `routes/` 迁到 Remix：

```js
// server.js（过渡期形态）
app.use(express.static('build/client'));   // Vite 构建产物
// —— 未迁移的旧端点继续走原 routes ——
app.use(require('./routes/knowledge'));    // 尚未迁的保持不动
app.use(require('./routes/srs'));
// —— 已迁移的页面 + 数据走 Remix handler ——
app.all('*', createRequestHandler({ build }));
```

好处：
- **worker bridge 存活**：`server.js` 的 Express app 仍在，`generation_jobs` worker 过渡期不受影响。
- **逐端点迁移**：55 个端点一次迁几个，每迁一批跑一次 e2e，随时可回退。
- **无停机、无双服务**：一个进程、一个端口（3010）。

---

## 4. 三个必须处理的摩擦点（核实驱动）

### 4.1 CJS → ESM 统一（"保留 services/" 的隐藏工序）

后端 64 个 CJS 文件与 Remix 的 ESM 不同源。"保留 services/" **不是零改动**——要统一模块系统。方案：**TS 化时一并转 ESM**（`tsc` 输出 ESM，或源码直接 `import/export`），`package.json` 设 `"type": "module"`。`better-sqlite3` 是 CJS 原生模块，ESM 里 `import Database from 'better-sqlite3'`（default import）可用，已验证兼容。

> 这是有意的一次性工序，不是隐性债务；TS 化本来就要逐文件过，顺带转 ESM 边际成本低。

### 4.2 worker bridge → 独立 worker（消除 HTTP 自请求 hack，正面收益）

现状：`generation_jobs` worker 靠**给自己发 HTTP 请求**（带 `X-Generation-Job-Worker:1` 跳过限流）来复用生成代码路径——这是 Express 单体下的权宜之计。全栈迁移正好是消除它的机会：

- 把 worker 抽成**独立入口** `worker.js`（或 Remix 自定义 server 启动钩子里拉起的后台 loop），**直接调用 `services/generation/*`**，不再走 HTTP 自请求。
- 好处：worker 与 HTTP 层解耦，多实例/云化时 worker 可独立伸缩（对接 §10 的 pg-boss 天然）。
- 过渡期：worker 可继续用旧 HTTP 方式，直到该端点迁移完成再切直调。

### 4.3 同步 SQLite 在 async loader（自用 OK，多用户随 Postgres 解决）

`better-sqlite3` 同步 API 在 Remix 的 async loader/action 里可直接调用（Node 单线程，同步 SQLite 极快，自用并发下不构成阻塞）。**转多用户高并发时**，同步 DB 会阻塞事件循环——那时随 §10 的 SQLite→Postgres（异步驱动）自然解决。当前不处理，留位。

---

## 5. 目标栈与目录结构

```
TypeScript（全栈）
React Router v7 (Remix) · Vite · 一体化
app/
  routes/                      # 文件路由：工作台/概览/知识库/OPS/复习
    _index.tsx                 # Cards Factory
    dashboard.tsx              # Mission Control
    knowledge-hub.tsx
    knowledge-ops.tsx
    api.*.ts                   # resource routes（迁自 routes/*.js）
  features/                    # 按功能域组织（承接上一轮评审建议）
    factory/ queue/ library/ card-modal/ review/ knowledge-explorer/ ocr/
  components/                  # shadcn/ui + 自研原语（消费 tokens.css）
  lib/ services -> 复用根 services/（TS+ESM 化）
  styles/tokens.css            # 保留的设计系统
server/
  worker.ts                    # 抽出的 generation_jobs worker（§4.2）
services/  db/  lib/           # 保留内核（TS+ESM）
tests/unit  integration  e2e   # 保留 + 演进
```

- **服务端数据**：TanStack Query（替 `shell-health.js` / 手写 fetch / 轮询）。
- **客户端 UI 状态**：少量 Zustand（替 `store.js` 的 Pub/Sub）。
- **组件**：shadcn/ui 复制进仓库，消费 `tokens.css` 的 CSS 变量，明暗主题沿用。

---

## 6. TypeScript 化策略（先内核，框架无关）

1. **先 TS 化 `services/` + `lib/` + `db/`**——框架无关、零 UI 风险、`node:test` 立即验证。同步转 ESM（§4.1）。
2. 为 `services/` 的公共边界补类型（生成结果、audio task、SRS 状态、knowledge 输出），loader/action 直接受益。
3. 再 TS 化前端（随 React 组件新写，不回填旧命令式代码——它们本就要删）。

---

## 7. 逐页迁移顺序（并存过渡）

按"独立性 + 价值"排序，每页迁完 e2e 全绿再下一页：

1. **Knowledge OPS**（最独立、纯表格/任务，React 练手最佳）
2. **Mission Control**（观测面板，数据只读，风险低）
3. **Knowledge Hub**（三栏 + 复习/计划 + embed 卡片弹窗，最复杂，放中段）
4. **Cards Factory 首页**（生成流程 + 队列 + OCR + 卡片弹窗，最核心，最后迁）
5. **学习卡弹窗 + card-renderer**（跨页共享原语，随 Factory 收尾统一）

每步：旧 `routes/` 对应端点迁成 `api.*.ts` resource route → 页面迁 React → Playwright 跑该页 spec。

---

## 8. 前端渲染契约（Markdown-first 不变）

`marked → audio-btn 替换 → DOMPurify` 管线保留，只是从命令式挪进 React：

- `card-renderer.js` 的 adapter 逻辑 → React 组件（`dangerouslySetInnerHTML` 承接净化后的 HTML）。
- DOMPurify 缺失 fail-closed 契约保留。
- ruby / 音频按钮 / 标红 / `#cardContent` 作用域 → 组件内等价实现，testid 不变。

---

## 9. 测试策略

- **`tests/unit/`（node:test，测 services）**：TS 化后继续跑，是迁移期最稳的安全网（内核不变）。
- **`tests/integration/`**：过渡期 harness 同时能打 Express（旧端点）与 Remix handler（新端点）；迁移完成后统一到 Remix 的 `createRemixRequestHandler` 测试入口。
- **`tests/e2e/`（Playwright）**：全程兜底，每迁一页跑对应 spec，testid 保留；是跨框架回归的主防线。
- **补测前置**（承接上一轮前端评审的 P1）：迁移前给要动的页面补 e2e 快乐路径覆盖（Factory 生成、队列、OCR、复习各一条），别在零覆盖上重写。

---

## 10. 未来转多用户的接入点（留位，不实施）

目标栈已为"真对外多用户"留好位，届时增量加，不推翻：

| 能力 | 接入点 |
|------|--------|
| 数据库 | `db/` 换 **Drizzle**（SQL-first，贴近现有手写 SQL）+ **PostgreSQL** |
| 多租户 | 各表加 `user_id`，loader/action 注入当前用户做行级隔离 |
| 认证 | **Lucia** / Auth.js，Remix 的 session 机制天然承接 |
| 队列 | worker（§4.2）对接 **pg-boss**（Postgres 即队列，不引 Redis） |
| 文件 | 音频从本地 `records/` → 对象存储（R2/S3） |

---

## 11. 分阶段实施

| 阶段 | 范围 | 门禁 |
|------|------|------|
| **P0** | 补迁移前 e2e 覆盖；起 Remix+Vite 骨架挂在 Express 上（空壳并存） | 现有 55 端点与四页行为不变，e2e 全绿 |
| **P1** | TS + ESM 化 `services/`/`lib/`/`db/`（框架无关） | `node:test` 全绿；`start` 正常 |
| **P2** | 迁 Knowledge OPS + Mission Control（含对应 resource routes） | 两页 React 化，e2e 绿 |
| **P3** | 迁 Knowledge Hub（三栏 + 复习/计划 + embed） | Hub e2e + embed 卡片弹窗绿 |
| **P4** | 迁 Cards Factory + 学习卡弹窗 + card-renderer；worker 抽独立进程 | 全站 React，生成/队列/OCR/弹窗/标红全绿 |
| **P5** | 删除 `routes/` 旧端点、旧 `public/js` 命令式模块、Express 冗余 | 仅 Remix；lint/unit/integration/e2e/visual 全绿 |
| **Future** | （转多用户时）Postgres/Drizzle/Auth/pg-boss/对象存储 | 独立立项 |

---

## 12. 风险与回滚

- **并存过渡是回滚保险**：任何一页迁移失败，该页保留旧 Express route + 旧 HTML，不阻塞其它页。
- **worker 迁移风险**：抽独立进程前，保留 HTTP 自请求方式作 fallback，直到直调路径验证稳定。
- **CJS→ESM 风险**：TS 化按文件推进，每转一批跑 `node:test`；`better-sqlite3` 等原生模块 default import 已验证。
- **最大风险仍是零前端单测**：迁移期唯一函数级安全网靠新写的 React 组件测试 + e2e；P0 的补测前置不可跳过。

---

## 附录 A：React Router v7 (Remix) vs TanStack Start

| 维度 | **React Router v7 (Remix)** ★主推 | TanStack Start |
|------|-----------------------------------|----------------|
| 构建 | Vite 原生 | Vite 原生 |
| 成熟度 | 高（Remix 血统，社区大） | 较新（2025 稳定），上升快 |
| 数据模型 | `loader`/`action`，从 REST 迁移心智最小 | loader + server functions，类型安全更极致 |
| 与现有 Express 并存 | `@react-router/express` 官方支持，**最平滑** | 可行，生态案例较少 |
| 类型安全 | 好 | 极致（端到端推断） |
| 适合本项目 | ✅ 从 Express+REST+55 端点渐进迁移 | 若追求极致类型安全、愿吃较新生态 |

**推荐 React Router v7 (Remix)**：它的 Express 并存能力（§3）是本项目"逐页无痛迁移"的关键，且从现有 REST 端点迁 loader/action 的心智负担最小。TanStack Start 作为强备选，若更看重端到端类型安全可选。

---

## 13. 验收 / 完成定义

- [ ] 四页全部 React 化，共用设计系统 token、shell 组件、明暗主题
- [ ] `services/` / `db/` / 生成管线 / node:test 内核保留并 TS+ESM 化，单测全绿
- [ ] `generation_jobs` worker 抽为独立进程，不再靠 HTTP 自请求
- [ ] Markdown-first 渲染、ruby、英日音频、标红 v1/v2、embed 卡片弹窗行为不回归
- [ ] `routes/` 旧端点与旧 `public/js` 命令式模块清除
- [ ] lint / unit / integration / e2e / visual regression 全绿；Docker 3010 真实环境验收通过
- [ ] 多用户接入点（Postgres/Auth/多租户）在文档与目录结构中留位，未实施
