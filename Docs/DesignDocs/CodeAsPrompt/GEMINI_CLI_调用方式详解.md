# Gemini CLI 调用方式详解（当前系统）

更新时间：2026-02-10

## 1. 文档目的与范围

本文总结当前仓库中 **Gemini CLI 的实际调用路径**、配置方式、运行依赖、故障排查与推荐实践。

说明范围：
- 服务端调用链：`/api/generate` -> Gemini 路径
- 宿主机代理调用链：`gemini-host-proxy`
- 关键环境变量与模型选择
- 与“日期归档”相关的行为（`target_folder`）

---

## 2. 当前三种 Gemini 相关调用形态

### 2.1 形态 A（主用）：Host Proxy 模式

- 入口：`POST /api/generate`，请求体带 `llm_provider=gemini`
- 模式开关：`GEMINI_MODE=host-proxy`
- 运行链路：
  1. `server.js` 在 `generateWithProvider()` 中判断 `useGeminiProxy`
  2. 调用 `services/geminiProxyService.js` 的 `runGeminiProxy()`
  3. `runGeminiProxy()` 发 HTTP 到 `GEMINI_PROXY_URL`
  4. 宿主机 `scripts/gemini-host-proxy.js` 拉起的服务接收 `/api/gemini`
  5. 代理内部 `spawn('gemini', ['--model', '<model>', '-p', '<prompt>'])`
  6. 返回 `{ markdown, rawOutput, model }`
  7. 后端将 markdown 渲染为 html，生成音频任务并落库/落盘

这是当前 Docker 场景下最稳定、最推荐的方式。

### 2.2 形态 B（兼容）：CLI 直连模式

- 模式开关：`GEMINI_MODE=cli`
- 调用：`services/geminiCliService.js` 直接在服务进程所在机器执行 `gemini`
- 典型用途：非容器运行、或容器内已安装并认证 Gemini CLI 的场景

### 2.3 形态 C（历史）：Gemini API 直连

- 文件：`services/geminiService.js`
- 备注：当前项目主线已封存 API 直连，不作为推荐链路。

---

## 3. 关键代码锚点

- 模式分流与调用：`server.js`
  - `const geminiMode = (process.env.GEMINI_MODE || 'cli').toLowerCase();`
  - `useGeminiCli / useGeminiProxy`
  - `runGeminiCli(...)` / `runGeminiProxy(...)`
- Host Proxy HTTP 客户端：`services/geminiProxyService.js`
- CLI 直连客户端：`services/geminiCliService.js`
- Host Proxy 服务端：`scripts/gemini-host-proxy.js`
- Host Proxy 管理脚本：`scripts/start-gemini-proxy.sh`

---

## 4. 环境变量与职责

## 4.1 服务端（viewer）

- `GEMINI_MODE`
  - `host-proxy`：调用宿主机代理（推荐）
  - `cli`：本机/容器直接执行 Gemini CLI
- `GEMINI_PROXY_URL`
  - 默认推荐：`http://host.docker.internal:3210/api/gemini`
- `GEMINI_PROXY_MODEL`
  - 代理默认模型（如果请求未显式透传 `llm_model`）
- `GEMINI_CLI_MODEL`
  - CLI 模式默认模型（`GEMINI_MODE=cli` 时使用）

## 4.2 代理进程（宿主机）

- `GEMINI_PROXY_PORT`：默认 `3210`
- `GEMINI_PROXY_BIN`：默认 `gemini`
- `GEMINI_PROXY_TIMEOUT_MS`：默认 `90000`
- `GEMINI_PROXY_MODEL`：代理默认模型
- `GEMINI_PROXY_MODEL_ARG`：默认 `--model`
- `GEMINI_PROXY_PROMPT_ARG`：默认 `-p`

---

## 5. 请求参数与模型透传

`POST /api/generate`（Gemini）常用字段：

```json
{
  "phrase": "提示词工程",
  "llm_provider": "gemini",
  "llm_model": "gemini-2.5-flash",
  "enable_tts": true,
  "target_folder": "20260129"
}
```

字段语义：
- `llm_provider=gemini`：走 Gemini 路径
- `llm_model`：覆盖默认模型并透传到 proxy/cli
- `target_folder`：强制写入指定日期目录（用于历史重建）

---

## 6. 日期归档行为（重点）

当前支持 `target_folder`：
- 若不传：默认按当天目录（`YYYYMMDD`）保存
- 若传入：按指定目录保存（例如 `20251216`）

实现点：
- `server.js`：`generateWithProvider()` 支持 `options.targetFolder`
- `services/fileManager.js`：`ensureFolderDirectory(folderName)`

注意：
- 文件归档日期由 `folder_name` 体现（这是当前主口径）
- `generations.generation_date` 仍按“实际生成时间”写入，不等同于 `target_folder` 历史日期

---

## 7. 宿主机代理运行方式

启动/停止/状态：

```bash
bash scripts/start-gemini-proxy.sh start
bash scripts/start-gemini-proxy.sh status
bash scripts/start-gemini-proxy.sh stop
```

健康检查：

```bash
curl -s http://localhost:3210/health
```

代理直测：

```bash
curl -s -X POST http://localhost:3210/api/gemini \
  -H 'Content-Type: application/json' \
  -d '{"prompt":"请只回复 ok","baseName":"probe","model":"gemini-2.5-flash"}'
```

---

## 8. 当前模型可用性结论（本机实测）

最近实测结论：
- 可用：`gemini-2.5-flash`、`gemini-2.5-pro`、`gemini-2.0-flash`
- 不可用（当前账号/环境）：`gemini-3-pro`（`ModelNotFoundError 404`）
- 不应作为模型名：`gemini-cli`（不是有效模型 ID）

实践建议：
- 默认模型优先设置为 `gemini-2.5-flash`
- `gemini-3-pro` 仅在账号明确开通后再启用

---

## 9. 常见故障与排查

### 9.1 `fetch failed`（viewer 调用 gemini 失败）

原因：proxy 未启动或 URL 不通。

排查：
1. `bash scripts/start-gemini-proxy.sh status`
2. `curl http://localhost:3210/health`
3. 检查 `GEMINI_PROXY_URL` 是否为 `http://host.docker.internal:3210/api/gemini`

### 9.2 `ModelNotFoundError: 404`

原因：`--model` 指定了当前账号不可用模型。

处理：
- 改为 `gemini-2.5-flash` 或可用模型。

### 9.3 `Rate limit exceeded`（429）

原因：`/api/generate` 内有节流（默认 4 秒）。

处理：
- 批处理时每次调用间隔 >= 4 秒
- 或在脚本中实现 429 重试与退避

### 9.4 `Gemini CLI timeout`

原因：CLI 执行超时。

处理：
- 调大 `GEMINI_PROXY_TIMEOUT_MS` / `GEMINI_CLI_TIMEOUT_MS`
- 缩短 prompt 或拆分批任务

---

## 10. 推荐基线配置（Docker + 宿主机 CLI）

```bash
# viewer
GEMINI_MODE=host-proxy
GEMINI_PROXY_URL=http://host.docker.internal:3210/api/gemini
GEMINI_PROXY_MODEL=gemini-2.5-flash

# host proxy
GEMINI_PROXY_PORT=3210
GEMINI_PROXY_BIN=gemini
GEMINI_PROXY_MODEL=gemini-2.5-flash
GEMINI_PROXY_TIMEOUT_MS=90000
```

---

## 11. 结论

当前系统中，Gemini CLI 的主调用方式是：
- **容器内服务 -> 宿主机 Host Proxy -> Gemini CLI -> 返回 markdown -> 本地渲染与落盘/落库**。

在此架构下：
- 模型可由 `llm_model` 每次请求透传
- 历史重建可通过 `target_folder` 保留原日期目录
- 生产稳定性取决于 proxy 常驻状态、模型可用性与节流重试策略
