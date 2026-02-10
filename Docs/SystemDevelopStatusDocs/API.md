# API 接口文档

**项目**: Trilingual Records  
**API 版本**: v1  
**更新日期**: 2026-02-10

## 1. API 总览

- Base URL: `http://localhost:3010/api`
- 协议: HTTP/JSON
- 认证: 本地部署默认无鉴权

### 1.1 端点列表

| 类别 | 方法 | 路径 | 说明 |
|---|---|---|---|
| 生成 | POST | `/generate` | 生成学习卡片（单模型或对比） |
| OCR | POST | `/ocr` | 图片识别为文本 |
| 历史 | GET | `/history` | 分页历史记录 |
| 历史 | GET | `/history/:id` | 单条记录详情 |
| 统计 | GET | `/statistics` | Mission Control 数据 |
| 搜索 | GET | `/search` | FTS 全文搜索 |
| 最近 | GET | `/recent` | 最近记录 |
| 文件 | GET | `/folders` | 日期目录列表 |
| 文件 | GET | `/folders/:folder/files` | 目录下文件列表 |
| 文件 | GET | `/folders/:folder/files/:file` | 文件内容或音频 |
| 文件定位 | GET | `/records/by-file` | 按 folder/base 查询记录 |
| 删除 | DELETE | `/records/:id` | 按记录 ID 删除 |
| 删除 | DELETE | `/records/by-file` | 按 folder/base 删除 |
| 实验 | GET | `/experiments/:id` | few-shot 实验导出 |
| 健康 | GET | `/health` | 服务健康检查 |
| Gemini CLI auth | GET/POST | `/gemini/auth/*` | 仅 `GEMINI_MODE=cli` 使用 |

## 2. 生成接口

### 2.1 `POST /api/generate`

#### 请求体（常用字段）

```json
{
  "phrase": "提示词工程",
  "llm_provider": "local",
  "enable_compare": false,
  "llm_model": "qwen2_5_vl",
  "experiment_id": "exp_round_xxx",
  "experiment_round": 1,
  "round_name": "fewshot_r1",
  "variant": "fewshot_r1",
  "is_teacher_reference": false,
  "fewshot_options": {
    "enabled": true,
    "strategy": "HIGH_QUALITY_GEMINI",
    "count": 3,
    "minScore": 85,
    "contextWindow": 4096,
    "tokenBudgetRatio": 0.25,
    "exampleMaxChars": 900,
    "teacherFirst": true
  }
}
```

#### 字段说明

- `phrase`: 必填，输入短语
- `llm_provider`: `local` 或 `gemini`，默认 `local`
  - 当 `llm_provider=gemini` 且未传 `llm_model` 时，默认使用 `gemini-3-pro-preview`
- `enable_compare`: `true` 时触发双模型对比
- `llm_model`: 模型覆盖字段
  - local 路径用于覆盖本地模型名
  - gemini host-proxy 路径会透传到 proxy 侧 `model`
- `experiment_* / variant / is_teacher_reference / fewshot_options`:
  用于实验追踪与 few-shot 配置

#### 单模型响应（成功）

```json
{
  "success": true,
  "experiment_id": "exp_round_xxx",
  "experiment_round": 1,
  "provider_requested": "gemini",
  "provider_used": "gemini",
  "fallback": null,
  "generationId": 123,
  "result": {
    "folder": "20260206",
    "baseName": "提示词工程",
    "targetDir": "/data/trilingual_records/20260206"
  },
  "audio": { "results": [], "errors": [] },
  "prompt": "...",
  "llm_output": {
    "markdown_content": "...",
    "html_content": "...",
    "audio_tasks": []
  },
  "observability": {
    "tokens": { "input": 0, "output": 0, "total": 0 },
    "cost": { "total": 0 },
    "quality": { "score": 0, "dimensions": {} },
    "performance": { "totalTime": 0, "phases": {} },
    "metadata": {
      "provider": "local",
      "model": "qwen2_5_vl",
      "promptText": "...",
      "promptParsed": {},
      "outputMode": "json",
      "rawOutput": "...",
      "outputStructured": "...",
      "fewShot": {
        "enabled": true,
        "countRequested": 3,
        "countUsed": 2,
        "fallbackReason": "budget_reduction"
      }
    }
  }
}
```

说明：
- `provider_requested`: 前端请求的 provider
- `provider_used`: 实际执行 provider（Gemini 异常时可能自动回退到 `local`）
- `fallback`: 回退信息；无回退时为 `null`

#### 对比模式响应（`enable_compare=true`）

```json
{
  "phrase": "提示词工程",
  "gemini": { "success": true, "result": {}, "output": {}, "observability": {}, "audio": {} },
  "local": { "success": true, "result": {}, "output": {}, "observability": {}, "audio": {} },
  "input": { "success": true, "result": {} },
  "comparison": {
    "metrics": {
      "speed": { "gemini": 1000, "local": 1200 },
      "quality": { "gemini": 90, "local": 82 },
      "tokens": { "gemini": 1300, "local": 900 },
      "cost": { "gemini": 0, "local": 0 }
    },
    "winner": "gemini",
    "recommendation": "Gemini wins on speed/quality balance.",
    "promptComparison": {
      "similarity": "identical",
      "geminiLength": 1234,
      "localLength": 1210
    }
  }
}
```

## 3. OCR 接口

### 3.1 `POST /api/ocr`

请求：

```json
{ "image": "data:image/png;base64,..." }
```

响应：

```json
{ "text": "识别结果" }
```

## 4. 查询与统计接口

### 4.1 `GET /api/history`

- 参数：`page`、`limit`、`search`、`provider`、`dateFrom`、`dateTo`
- 返回：`records + pagination`

### 4.2 `GET /api/history/:id`

- 返回单条完整记录（含 `observability` 和 `audioFiles`）

### 4.3 `GET /api/statistics`

- 参数：`provider`、`dateFrom`、`dateTo`
- 返回：趋势、分布、成本、质量、性能等统计数据

### 4.4 `GET /api/search`

- 参数：`q`（必填）、`limit`
- 基于 SQLite FTS5 检索

### 4.5 `GET /api/recent`

- 参数：`limit`
- 返回最近记录列表

## 5. 文件系统接口

### 5.1 `GET /api/folders`

- 返回有 html 卡片的日期目录

### 5.2 `GET /api/folders/:folder/files`

- 返回该目录下卡片文件列表（含显示标题）

### 5.3 `GET /api/folders/:folder/files/:file`

- 返回文件内容；音频文件会返回对应 content-type

### 5.4 `GET /api/records/by-file`

- 参数：`folder`、`base`
- 返回该文件对应数据库记录（若存在）

## 6. 删除接口

### 6.1 `DELETE /api/records/:id`

- 删除指定记录及其 `md/html/meta/audio` 文件

### 6.2 `DELETE /api/records/by-file`

- 参数：`folder`、`base`
- 先尝试按 DB 记录删除，再做文件系统兜底清理

## 7. 实验数据接口

### 7.1 `GET /api/experiments/:id`

返回结构：

- `runs`: few-shot run 记录
- `examples`: few-shot 示例映射
- `rounds`: round 聚合（质量、token、延迟、teacherGap）
- `samples`: 样本明细
- `teacherRefs`: teacher 输出快照
- `deltas`: 相对 baseline 的增量指标
- `trend`: 汇总信息（roundCount/sampleCount/hasTeacher）

该接口直接服务于：

- `scripts/export_round_trend_dataset.js`
- `d3/render_round_trend_charts.mjs`
- `scripts/generate_round_kpi_report.js`

## 8. 健康与 Gemini 认证接口

### 8.1 `GET /api/health`

- 返回服务可用性与依赖状态

### 8.2 `/api/gemini/auth/*`

- `GET /status`
- `POST /start`
- `POST /submit`
- `POST /cancel`

仅在 `GEMINI_MODE=cli` 有意义。`host-proxy` 模式下通常不走这组接口。

## 9. 错误语义

- `400`: 参数缺失/非法
- `404`: 资源不存在
- `422`: 生成内容校验失败
- `429`: 生成频率限流
  - 响应包含 `retry_after_ms` 与 `hint`
- `500`: 服务内部错误（同时写入 `generation_errors`）

---

**维护者**: Three LANS Team
