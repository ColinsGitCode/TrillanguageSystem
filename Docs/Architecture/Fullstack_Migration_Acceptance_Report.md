# 全栈架构迁移完成验收报告

> 日期：2026-07-13
> 分支：`SaaS_Modify`
> 范围：D0-P6
> 结论：**通过，前后端架构迁移完成**

## 1. 验收边界

本报告只验收 Cards Factory 当前产品与其运行架构。Mission Control、Knowledge Hub、Knowledge OPS、旧 SRS/复习和旧知识分析已经退役；学习辅助 2.0 与知识图谱 2.0 仍处于冻结状态，不属于本次验收。

## 2. 最终运行链路

    Browser
      -> React Router v7 Cards Factory at /
      -> Express /api/*
      -> generation_jobs persistent queue
      -> single in-process worker
      -> executeGenerationJob adapter
      -> executeCardGeneration use case
      -> DeepSeek / OCR / TTS / filesystem / SQLite

生产 composition root 为 `server.mjs`。React SSR、hashed client assets、Express adapters、CommonJS services、worker 与 better-sqlite3 在同一 viewer 进程中组合；Compose 项目名为 `three_lans_system`。

仓库另保留 `server.js` 作为 integration test 专用的 CommonJS 启动入口。它通过 `lib/httpRuntime.createApp()` / `startServer()` 启动纯 Express API，不挂载 React Router；`tests/integration/_harness.js` 用它在随机端口和隔离数据库上执行路由集成测试。它不是第二个生产入口，也不参与 Compose 运行链路。

## 3. P6 验收结果

| 门禁 | 结果 | 证据 |
|---|---|---|
| worker 直调 use case | 通过 | `executeGenerationJob` 映射持久队列 row 并直接调用 `executeCardGeneration` |
| HTTP bridge 删除 | 通过 | 活跃源码无 self-request、无 `X-Generation-Job-Worker` bypass |
| 原子 claim | 通过 | 单条 `UPDATE ... RETURNING`；双 SQLite 连接只能 claim 一次 |
| SQLite contention | 通过 | WAL + busy timeout + `SQLITE_BUSY/LOCKED` 有界指数退避 |
| 重启恢复 | 通过 | stale `running` 任务回到 `queued` 并记录 `recovered` 审计事件 |
| 优雅停机 | 通过 | SIGTERM/SIGINT 停止 HTTP、排空当前 job、关闭 SQLite、退出 0 |
| 超时保护 | 通过 | worker 未排空时不关闭 SQLite，进程返回非零退出结果 |
| 单 replica 基线 | 通过 | Compose 仅运行一个 viewer worker；原子 claim 防止意外双 claim |

## 4. 全栈完成标准

- `/` 由 React Router 独占，Cards Factory SSR 与 hydration 正常；
- `/index.html`、`/__rr-poc`、旧产品页面和旧 API 保持 404；
- `public/` 只保留 favicon，无旧 browser ESM 运行代码；
- `/api/generate` 是薄 HTTP adapter，队列 worker 不经过 HTTP；
- Markdown-first、ruby、音频、DOMPurify、highlight 和三类卡片契约保持；
- SQLite schema 只保留 Cards Factory 当前领域，启动时清理退役表；
- 生产镜像无源码或 node_modules bind mount，Compose 数据使用命名卷；
- 学习辅助和知识图谱没有以占位路由、旧表或旧服务混回运行时。

## 5. 可重复验收命令

    npm run test:acceptance
    docker compose build
    docker compose up -d --force-recreate
    docker compose ps

`test:acceptance` 串联 React 类型检查、ESLint、unit、integration、架构源码/路由所有权、production smoke，以及 Playwright 功能与视觉回归。Docker 重建后还需检查 `/`、`/api/health`、旧入口 404 和所有默认服务状态。

本次实际执行结果：

| 验收层 | 结果 |
|---|---|
| React typecheck + ESLint | 通过 |
| Unit | 215 / 215 通过 |
| Integration | 42 / 42 通过 |
| Architecture ownership | production build、源码门禁、根路由、SIGTERM 退出全部通过 |
| Production smoke | 7 / 7 probes 通过 |
| Playwright | 26 / 26 功能与视觉测试通过 |
| Docker build | viewer、OCR 构建成功；npm audit 0 vulnerabilities |
| Compose runtime | viewer、OCR、Kokoro、VOICEVOX 全部 Up |
| Runtime probes | `/` 与 `/api/health` 200；7 个退役页面/API 均为 404 |

## 6. 已知非阻塞项

- React Router v8 future flags 是升级提示，不影响当前 v7 验收；
- E2E 使用确定性 DeepSeek/OCR fixture，不替代真实模型质量评估；
- Style-Bert-VITS2 保持 archived profile，默认日语 TTS 仍为 VOICEVOX；
- 当前为本地单用户、单 viewer 架构，不承诺多用户认证或横向扩容。

## 7. 后续阶段

架构迁移没有 P7。下一工作流是新的产品设计阶段：

1. 学习辅助 2.0：用户任务、复习闭环、反馈与成功指标；
2. 知识图谱 2.0：问题边界、节点/边语义、证据与可解释性；
3. 各自完成 ADR、用户流程、原型和数据模型评审后再进入开发。
