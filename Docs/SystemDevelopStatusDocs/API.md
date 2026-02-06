# 📡 API 接口文档

**项目**: Trilingual Records
**API 版本**: v1
**更新日期**: 2026-02-05

---

## 📋 目录

1. [API 总览](#api-总览)
2. [通用规范](#通用规范)
3. [生成接口](#生成接口)
4. [查询接口](#查询接口)
5. [删除接口](#删除接口)
6. [文件系统接口](#文件系统接口)
7. [健康检查接口](#健康检查接口)
8. [Gemini CLI 认证接口](#gemini-cli-认证接口)
9. [错误码](#错误码)

---

## API 总览

### 基础信息

- **Base URL**: `http://localhost:3010/api`
- **协议**: HTTP/1.1
- **Content-Type**: `application/json`
- **认证**: 无需认证（本地部署）

### 端点列表

| 类别 | 方法 | 端点 | 功能 |
|------|------|------|------|
| **生成** | POST | `/generate` | 生成三语学习卡片 |
| **OCR** | POST | `/ocr` | 图像文字识别 |
| **查询** | GET | `/history` | 历史记录列表（分页） |
| | GET | `/history/:id` | 单条记录详情 |
| | GET | `/statistics` | 统计分析 |
| | GET | `/search` | 全文搜索 |
| | GET | `/recent` | 最近记录 |
| | GET | `/experiments/:id` | Few-shot 实验数据导出 |
| **删除** | DELETE | `/records/:id` | 按 ID 删除记录 |
| | DELETE | `/records/by-file` | 按文件删除记录 |
| **文件** | GET | `/folders` | 文件夹列表 |
| | GET | `/folders/:folder/files` | 文件夹内文件列表 |
| | GET | `/folders/:folder/files/:file` | 获取文件内容 |
| | GET | `/records/by-file` | 根据文件定位记录 |
| **健康** | GET | `/health` | 系统健康检查 |
| **Gemini** | GET | `/gemini/auth/status` | Gemini CLI 认证状态 |
| | POST | `/gemini/auth/start` | 启动 Gemini CLI 认证 |
| | POST | `/gemini/auth/submit` | 提交授权码 |
| | POST | `/gemini/auth/cancel` | 取消认证会话 |

---

## 通用规范

### 请求头

```http
Content-Type: application/json
```

### 响应格式

- 生成与查询类接口通常返回 `{ success: true, ... }`
- OCR / 文件列表等轻量接口可能直接返回数据对象

---

## 生成接口

### 1. 生成三语学习卡片（单模型）

**请求**

```http
POST /api/generate
Content-Type: application/json
```

**请求体**

```json
{
  "phrase": "hello world",
  "llm_provider": "local",
  "enable_compare": false,
  "experiment_id": "exp_1700000000_abcd12",
  "variant": "baseline"
}
```

**响应 (200 OK)**

```json
{
  "success": true,
  "generationId": 123,
  "result": {
    "folder": "20260205",
    "baseName": "hello_world",
    "targetDir": "/data/trilingual_records/20260205",
    "files": ["hello_world.md", "hello_world.html"],
    "absPaths": {
      "md": "/data/trilingual_records/20260205/hello_world.md",
      "html": "/data/trilingual_records/20260205/hello_world.html",
      "meta": "/data/trilingual_records/20260205/hello_world.meta.json"
    }
  },
  "audio": {
    "results": [
      {
        "index": 0,
        "filename": "hello_world_en_1.wav",
        "filePath": "/data/trilingual_records/20260205/hello_world_en_1.wav",
        "contentType": "audio/wav"
      }
    ],
    "errors": []
  },
  "prompt": "...",
  "llm_output": {
    "markdown_content": "# Phrase\n...",
    "html_content": "<!doctype html>...",
    "audio_tasks": []
  },
  "observability": {
    "tokens": { "input": 1234, "output": 567, "total": 1801 },
    "cost": { "input": 0, "output": 0, "total": 0 },
    "quality": { "score": 88, "dimensions": { "completeness": 36 } },
    "performance": { "totalTime": 2350, "phases": { "llmCall": 1850 } },
    "prompt": { "full": "...", "sections": { "ROLE": "..." } },
    "metadata": {
      "provider": "local",
      "model": "qwen2.5-coder:latest",
      "promptText": "...",
      "promptParsed": { "full": "...", "sections": { "ROLE": "..." } },
      "outputMode": "json",
      "rawOutput": "{...}",
      "outputStructured": "{...}"
    }
  }
}
```

### 2. 生成三语学习卡片（双模型对比）

**请求**

```http
POST /api/generate
Content-Type: application/json
```

**请求体**

```json
{
  "phrase": "对比模式输入测试_20260205_03",
  "llm_provider": "local",
  "enable_compare": true
}
```

**响应 (200 OK)**

```json
{
  "phrase": "对比模式输入测试_20260205_03",
  "gemini": {
    "success": true,
    "result": { "folder": "20260205", "baseName": "对比模式输入测试_20260205_03_gemini" },
    "output": { "markdown_content": "...", "html_content": "...", "audio_tasks": [] },
    "observability": { "tokens": {}, "cost": {}, "quality": {}, "performance": {}, "metadata": {} },
    "audio": { "results": [], "errors": [] }
  },
  "local": {
    "success": true,
    "result": { "folder": "20260205", "baseName": "对比模式输入测试_20260205_03_local" },
    "output": { "markdown_content": "...", "html_content": "...", "audio_tasks": [] },
    "observability": { "tokens": {}, "cost": {}, "quality": {}, "performance": {}, "metadata": {} },
    "audio": { "results": [], "errors": [] }
  },
  "input": {
    "success": true,
    "result": { "folder": "20260205", "baseName": "对比模式输入测试_20260205_03_input" }
  },
  "comparison": {
    "metrics": { "speed": {}, "quality": {}, "tokens": {}, "cost": {} },
    "winner": "gemini",
    "recommendation": "Gemini wins on speed/quality balance.",
    "promptComparison": { "similarity": "identical", "geminiLength": 1200, "localLength": 1180 }
  }
}
```

**说明**
- 对比模式会生成三份文件记录：`gemini`、`local`、`input`（输入卡片）。
- 输入卡片用于保留原始输入，标题显示为 `【输入】{phrase}`。

---

### 3. OCR 图像识别

**请求**

```http
POST /api/ocr
Content-Type: application/json
```

---

## 实验数据导出

### GET /api/experiments/:id

**说明**：导出 few-shot 实验数据（runs + examples）用于图表分析。

**响应**
```json
{
  "experimentId": "exp_1700000000_abcd12",
  "runs": [
    {
      "id": 1,
      "generation_id": 123,
      "variant": "baseline",
      "fewshot_enabled": 0,
      "quality_score": 72,
      "total_prompt_tokens_est": 1200
    }
  ],
  "examples": [
    {
      "run_id": 2,
      "example_generation_id": 88,
      "example_quality_score": 93
    }
  ]
}
```

**请求体**

```json
{
  "image": "data:image/png;base64,iVBORw0KGgoAAAANS..."
}
```

**响应 (200 OK)**

```json
{ "text": "识别出的文字内容" }
```

---

## 查询接口

### 1. 历史记录列表（分页）

**请求**

```http
GET /api/history?page=1&limit=20&search=hello&provider=local
```

**响应 (200 OK)**

```json
{
  "success": true,
  "records": [
    {
      "id": 123,
      "phrase": "hello world",
      "llm_provider": "local",
      "llm_model": "qwen2.5",
      "folder_name": "20260205",
      "base_filename": "hello_world",
      "created_at": "2026-02-05T10:30:00.000Z",
      "quality_score": 88,
      "tokens_total": 1801,
      "cost_total": 0,
      "performance_total_ms": 2350,
      "audio_count": 2
    }
  ],
  "pagination": {
    "page": 1,
    "limit": 20,
    "total": 342,
    "totalPages": 18,
    "hasNext": true,
    "hasPrev": false
  }
}
```

### 2. 单条记录详情

**请求**

```http
GET /api/history/:id
```

**响应 (200 OK)**

```json
{
  "success": true,
  "record": {
    "id": 123,
    "phrase": "hello world",
    "llm_provider": "local",
    "llm_model": "qwen2.5",
    "folder_name": "20260205",
    "base_filename": "hello_world",
    "md_file_path": "/data/trilingual_records/20260205/hello_world.md",
    "html_file_path": "/data/trilingual_records/20260205/hello_world.html",
    "markdown_content": "# Phrase\n...",
    "audioFiles": [
      {
        "language": "en",
        "file_path": "/data/trilingual_records/20260205/hello_world_en_1.wav",
        "status": "generated"
      }
    ],
    "observability": {
      "tokens_total": 1801,
      "cost_total": 0,
      "performance_total_ms": 2350,
      "quality_score": 88,
      "quality_dimensions": { "completeness": 36 }
    }
  }
}
```

### 3. 统计分析

**请求**

```http
GET /api/statistics?dateFrom=2026-02-01&dateTo=2026-02-05
```

**响应 (200 OK)**

```json
{
  "success": true,
  "statistics": {
    "totalCount": 342,
    "avgQualityScore": 85.3,
    "avgTokensTotal": 1850,
    "avgLatencyMs": 2100,
    "avgCost": 0,
    "totalCost": 0,
    "totalTokens": 632700,
    "providerDistribution": {
      "local": 320,
      "gemini": 22
    },
    "qualityTrend": {
      "7d": [ { "date": "2026-02-05", "avgScore": 88, "count": 15 } ]
    },
    "tokenTrend": {
      "7d": [ { "date": "2026-02-05", "avgTokens": 1820, "count": 15 } ]
    },
    "latencyTrend": {
      "7d": [ { "date": "2026-02-05", "avgMs": 2050, "count": 15 } ]
    },
    "errors": {
      "total": 2,
      "rate": 0.005,
      "byType": { "ValidationError": 2 },
      "recent": []
    },
    "quota": {
      "used": 12000,
      "limit": 1000000,
      "percentage": 1.2,
      "resetDate": "2026-03-01",
      "estimatedDaysRemaining": 26
    }
  },
  "period": { "dateFrom": "2026-02-01", "dateTo": "2026-02-05" }
}
```

---

## 删除接口

### 1. 按 ID 删除记录

```http
DELETE /api/records/:id
```

**响应 (200 OK)**

```json
{ "success": true, "message": "Record deleted successfully", "deletedFiles": 7 }
```

### 2. 按文件名删除记录

```http
DELETE /api/records/by-file?folder=20260205&base=hello_world
```

**响应 (200 OK)**

```json
{ "success": true, "deletedFiles": 7, "recordDeleted": true }
```

---

## 文件系统接口

### 1. 文件夹列表

```http
GET /api/folders
```

**响应**

```json
{ "folders": ["20260205", "20260204"] }
```

### 2. 文件夹内文件列表

```http
GET /api/folders/:folder/files
```

**响应**

```json
{
  "files": [
    { "file": "hello_world.html", "title": "hello world" }
  ]
}
```

### 3. 获取文件内容

```http
GET /api/folders/:folder/files/:file
```

**响应**: `text/html` / `text/markdown` / `audio/wav` / `audio/mpeg`

### 4. 根据文件定位记录

```http
GET /api/records/by-file?folder=20260205&base=hello_world
```

**响应**

```json
{ "record": { "id": 123, "folder_name": "20260205", "base_filename": "hello_world" } }
```

---

## 健康检查接口

### 系统健康检查

```http
GET /api/health
```

**响应 (200 OK)**

```json
{
  "services": [
    { "name": "Local LLM", "type": "llm", "status": "online", "latency": 120, "details": { "endpoint": "...", "model": "..." } },
    { "name": "TTS English", "type": "tts", "status": "online", "latency": 80 },
    { "name": "TTS Japanese", "type": "tts", "status": "online", "latency": 60 },
    { "name": "Storage", "type": "storage", "status": "online", "details": { "used": 123456, "total": 6442450944, "percentage": 1.9, "recordsCount": 342 } }
  ],
  "system": { "uptime": 86400, "version": "1.0.0", "lastRestart": 1738730000000 }
}
```

---

## Gemini CLI 认证接口

> 说明：仅在 `GEMINI_MODE=cli` 时启用，用于容器内 Gemini CLI 认证初始化；当使用 **host-proxy** 模式时可忽略。

### 1. 获取认证状态

```http
GET /api/gemini/auth/status
```

**响应**

```json
{
  "enabled": true,
  "authenticated": false,
  "pending": true,
  "url": "https://accounts.google.com/o/oauth2/...",
  "message": "waiting_for_code"
}
```

### 2. 启动认证

```http
POST /api/gemini/auth/start
```

**响应**

```json
{
  "enabled": true,
  "authenticated": false,
  "pending": true,
  "url": "https://accounts.google.com/o/oauth2/..."
}
```

### 3. 提交授权码

```http
POST /api/gemini/auth/submit
Content-Type: application/json
```

**请求体**

```json
{ "code": "4/0ASc..." }
```

**响应**

```json
{ "status": "success" }
```

### 4. 取消认证

```http
POST /api/gemini/auth/cancel
```

**响应**

```json
{ "cancelled": true }
```

---

## 错误码

| 状态码 | 说明 | 场景 |
|------|------|------|
| 200 | OK | 请求成功 |
| 400 | Bad Request | 缺少必填参数 |
| 404 | Not Found | 资源不存在 |
| 422 | Unprocessable Entity | 验证失败 |
| 429 | Too Many Requests | 速率限制 |
| 500 | Internal Server Error | 服务器错误 |

---

**维护者**: Three LANS Team
**最后更新**: 2026-02-05
