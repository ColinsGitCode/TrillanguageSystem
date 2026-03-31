# Gemini Proxy 与服务端共享队列改造方案

## 目标

本轮改造同时解决两个问题：

1. Gemini CLI 继续以 proxy 方式调用，但执行位置固定为宿主机本地 `gemini` CLI。
2. 卡片生成任务改为服务端共享队列，解决多浏览器队列不一致、页面刷新丢任务的问题。

## 设计原则

- `viewer` 继续作为唯一业务入口。
- `gemini` 调用链收回到本工程内部，不再依赖外部共享 `18888/3210` 服务。
- 宿主机仍是真正执行 `gemini` CLI 的位置，不把 Gemini CLI 装进容器。
- 队列事实来源从浏览器内存/`localStorage` 改为 SQLite。
- 所有浏览器、Mission Control、审计日志都读取同一份队列状态。

## 目标架构

```text
Browser
  -> viewer
  -> gemini-proxy (项目内容器)
  -> gemini-host-proxy (本工程宿主机脚本, 监听 3210)
  -> 本地 Gemini CLI
```

卡片任务链路改为：

```text
Browser
  -> POST /api/generation-jobs
  -> generation_jobs (SQLite)
  -> viewer 内置 worker 串行执行
  -> /api/generate
  -> Gemini / OCR / TTS / TRAIN
  -> generation_jobs 状态回写
  -> 所有浏览器轮询统一状态
```

## 组件职责

### 1. viewer

负责：

- `/api/generate`
- `/api/training/*`
- `/api/knowledge/*`
- `/api/generation-jobs*`
- OCR / TTS / 文件落盘 / TRAIN / UI 数据提供
- 内置 generation worker

### 2. gemini-proxy 容器

负责：

- 项目内统一 Gemini HTTP 入口
- 健康检查 `/health`
- reset `/admin/reset`
- 请求超时控制
- 转发到宿主机 executor

不负责：

- 直接执行 `gemini` CLI
- 隐式模型降级

### 3. gemini-host-proxy 宿主机脚本

负责：

- 真正 spawn 本地 `gemini` CLI
- 使用项目专属运行目录
- 以最小环境变量白名单执行
- 避免污染宿主机日常 Gemini CLI / MCP 配置

## Gemini 运行环境隔离

项目专属运行目录：

- `/Users/xueguodong/WorkTechDir/Three_LANS_PJ_CodeX/.runtime/gemini`

宿主机脚本仅透传必要环境：

- `PATH`
- `HOME`
- `GEMINI_SETTINGS_PATH`
- `NO_COLOR`
- 代理与证书变量（如需要）
- locale 变量

目的：

- 避免共享宿主机杂环境
- 降低 MCP 污染概率
- 保证当前工程的 Gemini 行为可控

## 模型策略

- 默认不做静默 fallback。
- 请求什么模型，就执行什么模型。
- 如果配额不足或限流，直接返回错误，由业务层决定是否重试。
- 业务审计需记录：
  - `requested_model`
  - `executed_model`
  - `fallback_applied`
  - `fallback_reason`

## 服务端共享队列

### 表结构

新增：

- `generation_jobs`
- `generation_job_events`

`generation_jobs` 负责队列事实状态：

- `job_type`
- `phrase_raw`
- `phrase_normalized`
- `source_mode`
- `target_folder`
- `llm_provider`
- `llm_model`
- `enable_compare`
- `status`
- `attempts`
- `max_retries`
- `error_message`
- `result_generation_id`
- `result_folder`
- `result_base_filename`
- `source_context_json`
- `request_payload_json`
- `result_summary_json`
- `created_at / started_at / finished_at / cleared_at`

`generation_job_events` 负责可追踪审计：

- `created`
- `picked`
- `retry_scheduled`
- `succeeded`
- `failed`
- `cancelled`
- 后续可补：`reset_to_queued_after_restart`

### worker 策略

第一阶段采用 `viewer` 内置单 worker：

- 启动时把 `running` 任务恢复为 `queued`
- 单线程串行取 `queued` 任务
- 内部回调现有 `/api/generate`
- 完成后回写 success / failed

这样可以先解决：

- 多浏览器不一致
- 页面刷新丢任务
- Mission Control 与实际执行状态脱节

## 前端改造

### 现状

原队列事实来源是：

- `generationQueueState.tasks`
- `localStorage:generation_queue_snapshot_v1`

问题：

- 不同浏览器各自一份
- 刷新后依赖本地恢复
- Mission Control 看的是本地快照，不是服务端真实状态

### 改造后

前端只做两件事：

1. `POST /api/generation-jobs` 入队
2. 轮询：
   - `GET /api/generation-jobs`
   - `GET /api/generation-jobs/summary`

`localStorage` 队列快照降级为 UI 镜像缓存，不再作为事实来源。

## Mission Control 改造

Mission Control 的队列详情改为读取服务端共享队列：

- 总数
- queued / running / success / failed / cancelled
- 当前 active job
- 最近任务列表

这样不同浏览器看到的 Mission Control 队列状态将保持一致。

## 本轮已实现范围

### 已完成

- `generation_jobs` / `generation_job_events` 表与数据库 API
- `generationJobService` 单 worker
- `POST/GET /api/generation-jobs*` 路由
- 前端主页面改为服务端入队与轮询
- Mission Control 改为读取服务端队列
- 项目内 `gemini-proxy` 容器
- `viewer -> gemini-proxy -> host executor -> 本地 Gemini CLI` 链路配置
- 宿主机 Gemini 执行环境切到项目专属目录

### 尚未完成

- Gemini auth 流程完全迁移到项目内 gateway 转发
- SSE / WebSocket 推送（当前先用轮询）
- 队列 worker 独立进程化
- 更细粒度 job event 展示页

## 风险与对策

### 风险 1：宿主机 executor 未启动

对策：

- `gemini-proxy /health` 暴露上游状态
- `bootstrap_stack.py` 统一管理 start / stop / status

### 风险 2：worker 与 viewer 同进程

对策：

- 第一阶段先保持简单
- 后续若并发复杂度上升，再拆独立 worker

### 风险 3：旧前端本地队列残留

对策：

- 本轮前端已切到服务端队列轮询
- 本地 snapshot 只保留为 UI 镜像，不再恢复执行

## 验证要点

1. 新增任务后，多个浏览器应看到同一份队列状态。
2. 刷新页面后，任务不丢失。
3. Mission Control 与主页面队列数字一致。
4. `viewer` 重启后，原 `running` 任务应回到 `queued` 并继续执行。
5. Gemini 请求应通过项目内 `gemini-proxy` 转发到宿主机 executor，而非外部共享 gateway。
