# 📡 API 接口文档

**项目**: Trilingual Records
**API 版本**: v1
**更新日期**: 2026-02-03

---

## 📋 目录

1. [API 总览](#api-总览)
2. [通用规范](#通用规范)
3. [生成接口](#生成接口)
4. [查询接口](#查询接口)
5. [删除接口](#删除接口)
6. [文件系统接口](#文件系统接口)
7. [健康检查接口](#健康检查接口)
8. [错误码](#错误码)

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
| **删除** | DELETE | `/records/:id` | 按 ID 删除记录 |
| | DELETE | `/records/by-file` | 按文件删除记录 |
| **文件** | GET | `/folders` | 文件夹列表 |
| | GET | `/folders/:folder/files` | 文件夹内文件列表 |
| | GET | `/folders/:folder/files/:file` | 获取文件内容 |
| | GET | `/records/by-file` | 根据文件定位记录 |
| **健康** | GET | `/health` | 系统健康检查 |

---

## 通用规范

### 请求头

```http
Content-Type: application/json
```

### 响应格式

#### 成功响应

```json
{
  "success": true,
  "data": { ... },
  "message": "Optional success message"
}
```

#### 错误响应

```json
{
  "error": "Error message",
  "details": ["Additional error details"],
  "code": "ERROR_CODE"
}
```

### 速率限制

- **生成接口**: 4秒/次 (按 IP)
- **其他接口**: 无限制

---

## 生成接口

### 1. 生成三语学习卡片

生成包含中英日三语翻译、定义和例句的学习卡片。

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
  "enable_compare": false
}
```

**参数说明**

| 参数 | 类型 | 必填 | 默认值 | 说明 |
|------|------|------|--------|------|
| `phrase` | string | ✅ | - | 要学习的短语 |
| `llm_provider` | string | ❌ | `"local"` | LLM 提供商 (`local` / `gemini`) |
| `enable_compare` | boolean | ❌ | `false` | 是否启用对比模式（已废弃） |

**响应 (200 OK)**

```json
{
  "success": true,
  "generationId": 123,
  "result": {
    "baseName": "hello_world",
    "targetDir": "/data/trilingual_records/20260203",
    "folderName": "20260203",
    "absPaths": {
      "md": "/data/trilingual_records/20260203/hello_world.md",
      "html": "/data/trilingual_records/20260203/hello_world.html",
      "meta": "/data/trilingual_records/20260203/hello_world.meta.json"
    }
  },
  "audio": {
    "successCount": 4,
    "failCount": 0,
    "tasks": [
      {
        "lang": "en",
        "text": "Hello world",
        "outputFile": "/data/trilingual_records/20260203/hello_world_en_1.wav",
        "status": "success"
      }
    ]
  },
  "prompt": "...",
  "llm_output": {
    "markdown_content": "# Phrase\n...",
    "html_content": "<!doctype html>...",
    "audio_tasks": [...]
  },
  "observability": {
    "tokens": { "input": 1234, "output": 567, "total": 1801 },
    "cost": { "input": 0.00012, "output": 0.00005, "total": 0.00017 },
    "performance": {
      "total_ms": 2350,
      "phases": {
        "promptBuild": 10,
        "llmCall": 1850,
        "fileSave": 8,
        "audioGenerate": 482
      }
    },
    "quality": {
      "score": 88,
      "checks": { "hasMarkdown": true, "hasAudioTasks": true },
      "dimensions": { "completeness": 40, "accuracy": 28, ... }
    }
  }
}
```

**错误响应**

```json
// 400 Bad Request - 缺少必填参数
{
  "error": "Phrase required"
}

// 422 Unprocessable Entity - 验证失败
{
  "error": "Validation failed",
  "details": ["markdown_content is missing or empty"],
  "prompt": "...",
  "llm_output": { ... }
}

// 429 Too Many Requests - 速率限制
{
  "error": "Rate limit exceeded"
}

// 500 Internal Server Error - 服务器错误
{
  "error": "LLM service unavailable"
}
```

**使用示例**

```bash
curl -X POST http://localhost:3010/api/generate \
  -H "Content-Type: application/json" \
  -d '{
    "phrase": "hello world",
    "llm_provider": "local"
  }'
```

---

### 2. OCR 图像识别

从图像中识别文字。

**请求**

```http
POST /api/ocr
Content-Type: application/json
```

**请求体**

```json
{
  "image": "data:image/png;base64,iVBORw0KGgoAAAANS..."
}
```

**参数说明**

| 参数 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `image` | string | ✅ | Base64 编码的图像 (Data URL) |

**响应 (200 OK)**

```json
{
  "text": "识别出的文字内容"
}
```

**错误响应**

```json
// 400 Bad Request
{
  "error": "No image"
}

// 500 Internal Server Error
{
  "error": "OCR service unavailable"
}
```

**使用示例**

```bash
curl -X POST http://localhost:3010/api/ocr \
  -H "Content-Type: application/json" \
  -d '{
    "image": "data:image/png;base64,iVBORw0KGgo..."
  }'
```

---

## 查询接口

### 1. 历史记录列表（分页）

查询历史生成记录，支持搜索、过滤和分页。

**请求**

```http
GET /api/history?page=1&limit=20&search=hello&provider=local
```

**查询参数**

| 参数 | 类型 | 必填 | 默认值 | 说明 |
|------|------|------|--------|------|
| `page` | number | ❌ | `1` | 页码（从1开始） |
| `limit` | number | ❌ | `20` | 每页记录数 |
| `search` | string | ❌ | - | 搜索关键词（短语模糊匹配） |
| `provider` | string | ❌ | - | Provider 过滤 (`local` / `gemini`) |
| `dateFrom` | string | ❌ | - | 开始日期 (YYYY-MM-DD) |
| `dateTo` | string | ❌ | - | 结束日期 (YYYY-MM-DD) |

**响应 (200 OK)**

```json
{
  "success": true,
  "records": [
    {
      "id": 123,
      "phrase": "hello world",
      "llm_provider": "local",
      "llm_model": "qwen2.5:7b",
      "folder_name": "20260203",
      "base_filename": "hello_world",
      "created_at": "2026-02-03T10:30:00.000Z",
      "en_translation": "Hello world",
      "ja_translation": "こんにちは世界",
      "zh_translation": "你好世界",
      "quality_score": 88,
      "tokens_total": 1801,
      "cost_total": 0.00017
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

**使用示例**

```bash
# 基础查询
curl http://localhost:3010/api/history

# 分页查询
curl http://localhost:3010/api/history?page=2&limit=10

# 搜索
curl http://localhost:3010/api/history?search=hello

# 过滤 + 日期范围
curl "http://localhost:3010/api/history?provider=local&dateFrom=2026-02-01&dateTo=2026-02-03"
```

---

### 2. 单条记录详情

获取指定记录的完整详情，包含音频文件和可观测性指标。

**请求**

```http
GET /api/history/:id
```

**路径参数**

| 参数 | 类型 | 说明 |
|------|------|------|
| `id` | number | 记录 ID |

**响应 (200 OK)**

```json
{
  "success": true,
  "record": {
    "id": 123,
    "phrase": "hello world",
    "llm_provider": "local",
    "llm_model": "qwen2.5:7b",
    "folder_name": "20260203",
    "base_filename": "hello_world",
    "md_file_path": "/data/trilingual_records/20260203/hello_world.md",
    "html_file_path": "/data/trilingual_records/20260203/hello_world.html",
    "markdown_content": "# Phrase\n...",
    "en_translation": "Hello world",
    "ja_translation": "こんにちは世界",
    "zh_translation": "你好世界",
    "created_at": "2026-02-03T10:30:00.000Z",

    "audioFiles": [
      {
        "id": 456,
        "language": "en",
        "text": "Hello world",
        "file_path": "/data/trilingual_records/20260203/hello_world_en_1.wav",
        "status": "generated",
        "tts_provider": "kokoro",
        "file_size": 48000
      }
    ],

    "metrics": {
      "tokens_input": 1234,
      "tokens_output": 567,
      "tokens_total": 1801,
      "cost_total": 0.00017,
      "performance_total_ms": 2350,
      "performance_phases": {
        "promptBuild": 10,
        "llmCall": 1850,
        "fileSave": 8
      },
      "quality_score": 88,
      "quality_dimensions": {
        "completeness": 40,
        "accuracy": 28,
        "exampleQuality": 18,
        "formatting": 10
      },
      "prompt_full": "...",
      "llm_output": "..."
    }
  }
}
```

**错误响应**

```json
// 404 Not Found
{
  "error": "Record not found"
}
```

**使用示例**

```bash
curl http://localhost:3010/api/history/123
```

---

### 3. 统计分析

获取指定时间范围和 Provider 的统计数据。

**请求**

```http
GET /api/statistics?provider=local&dateFrom=2026-01-01&dateTo=2026-02-03
```

**查询参数**

| 参数 | 类型 | 必填 | 默认值 | 说明 |
|------|------|------|--------|------|
| `provider` | string | ❌ | - | Provider 过滤 |
| `dateFrom` | string | ❌ | 30天前 | 开始日期 (YYYY-MM-DD) |
| `dateTo` | string | ❌ | 今天 | 结束日期 (YYYY-MM-DD) |

**响应 (200 OK)**

```json
{
  "success": true,
  "statistics": {
    "totalCount": 342,
    "avgQualityScore": 85.3,
    "avgTokensTotal": 1850,
    "avgLatencyMs": 2100,
    "totalCost": 0.058,

    "providerDistribution": {
      "local": 320,
      "gemini": 22
    },

    "qualityTrend": {
      "7d": [
        { "date": "2026-02-03", "avgScore": 88, "count": 15 },
        { "date": "2026-02-02", "avgScore": 86, "count": 12 }
      ],
      "30d": [...],
      "90d": [...]
    },

    "tokenTrend": {
      "7d": [
        { "date": "2026-02-03", "avgTokens": 1820, "count": 15 }
      ]
    },

    "latencyTrend": {
      "7d": [
        { "date": "2026-02-03", "avgMs": 2050, "count": 15 }
      ]
    }
  },
  "period": {
    "dateFrom": "2026-01-01",
    "dateTo": "2026-02-03"
  }
}
```

**使用示例**

```bash
# 默认统计（最近30天）
curl http://localhost:3010/api/statistics

# 指定时间范围
curl "http://localhost:3010/api/statistics?dateFrom=2026-01-01&dateTo=2026-02-03"

# 按 Provider 过滤
curl "http://localhost:3010/api/statistics?provider=local"
```

---

### 4. 全文搜索

使用 FTS5 全文搜索引擎搜索短语、翻译和内容。

**请求**

```http
GET /api/search?q=hello&limit=20
```

**查询参数**

| 参数 | 类型 | 必填 | 默认值 | 说明 |
|------|------|------|--------|------|
| `q` | string | ✅ | - | 搜索关键词 |
| `limit` | number | ❌ | `20` | 返回结果数量 |

**响应 (200 OK)**

```json
{
  "success": true,
  "query": "hello",
  "results": [
    {
      "id": 123,
      "phrase": "hello world",
      "en_translation": "Hello world",
      "ja_translation": "こんにちは世界",
      "zh_translation": "你好世界",
      "rank": 0.85,
      "created_at": "2026-02-03T10:30:00.000Z"
    }
  ],
  "count": 15
}
```

**错误响应**

```json
// 400 Bad Request
{
  "error": "Query parameter \"q\" is required"
}
```

**使用示例**

```bash
# 基础搜索
curl "http://localhost:3010/api/search?q=hello"

# 限制结果数量
curl "http://localhost:3010/api/search?q=world&limit=10"

# 中文搜索
curl "http://localhost:3010/api/search?q=你好"

# 日文搜索
curl "http://localhost:3010/api/search?q=こんにちは"
```

---

### 5. 最近记录

获取最近生成的记录。

**请求**

```http
GET /api/recent?limit=10
```

**查询参数**

| 参数 | 类型 | 必填 | 默认值 | 说明 |
|------|------|------|--------|------|
| `limit` | number | ❌ | `10` | 返回记录数 |

**响应 (200 OK)**

```json
{
  "success": true,
  "records": [
    {
      "id": 125,
      "phrase": "good morning",
      "created_at": "2026-02-03T11:00:00.000Z",
      "quality_score": 90
    },
    {
      "id": 124,
      "phrase": "thank you",
      "created_at": "2026-02-03T10:45:00.000Z",
      "quality_score": 87
    }
  ]
}
```

**使用示例**

```bash
curl http://localhost:3010/api/recent?limit=5
```

---

## 删除接口

### 1. 按 ID 删除记录

删除指定 ID 的记录及其关联的所有文件（Markdown、HTML、音频等）。

**请求**

```http
DELETE /api/records/:id
```

**路径参数**

| 参数 | 类型 | 说明 |
|------|------|------|
| `id` | number | 记录 ID |

**响应 (200 OK)**

```json
{
  "success": true,
  "message": "Record deleted successfully",
  "deletedFiles": 7
}
```

**删除内容**:
- ✅ 数据库记录 (`generations`)
- ✅ 关联音频记录 (`audio_files`) - 级联删除
- ✅ 可观测性指标 (`observability_metrics`) - 级联删除
- ✅ Markdown 文件 (`.md`)
- ✅ HTML 文件 (`.html`)
- ✅ Meta 文件 (`.meta.json`)
- ✅ 所有音频文件 (`.wav`)

**错误响应**

```json
// 404 Not Found
{
  "error": "Record not found"
}
```

**使用示例**

```bash
curl -X DELETE http://localhost:3010/api/records/123
```

---

### 2. 按文件名删除记录

根据文件夹和文件基础名删除记录（支持没有数据库记录的历史文件）。

**请求**

```http
DELETE /api/records/by-file?folder=20260203&base=hello_world
```

**查询参数**

| 参数 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `folder` | string | ✅ | 文件夹名称 (YYYYMMDD) |
| `base` | string | ✅ | 文件基础名 (不含扩展名) |

**响应 (200 OK)**

```json
{
  "success": true,
  "deletedFiles": 7,
  "recordDeleted": true
}
```

**删除逻辑**:
1. 尝试从数据库查找记录并删除
2. 如果数据库中不存在，直接扫描文件系统删除匹配文件
3. 删除所有匹配的文件：`.md`, `.html`, `.meta.json`, `_*.wav`

**错误响应**

```json
// 400 Bad Request
{
  "error": "folder and base are required"
}
```

**使用示例**

```bash
curl -X DELETE "http://localhost:3010/api/records/by-file?folder=20260203&base=hello_world"
```

---

## 文件系统接口

### 1. 文件夹列表

获取所有日期文件夹列表。

**请求**

```http
GET /api/folders
```

**响应 (200 OK)**

```json
{
  "folders": [
    {
      "name": "20260203",
      "displayName": "2026-02-03",
      "htmlCount": 15
    },
    {
      "name": "20260202",
      "displayName": "2026-02-02",
      "htmlCount": 12
    }
  ]
}
```

**使用示例**

```bash
curl http://localhost:3010/api/folders
```

---

### 2. 文件夹内文件列表

获取指定文件夹内的所有 HTML 文件。

**请求**

```http
GET /api/folders/:folder/files
```

**路径参数**

| 参数 | 类型 | 说明 |
|------|------|------|
| `folder` | string | 文件夹名称 (YYYYMMDD) |

**响应 (200 OK)**

```json
{
  "files": [
    {
      "base": "hello_world",
      "html": "hello_world.html",
      "display": "hello world"
    },
    {
      "base": "good_morning",
      "html": "good_morning.html",
      "display": "good morning"
    }
  ]
}
```

**使用示例**

```bash
curl http://localhost:3010/api/folders/20260203/files
```

---

### 3. 获取文件内容

读取指定文件的内容（支持 HTML、Markdown、音频文件）。

**请求**

```http
GET /api/folders/:folder/files/:file
```

**路径参数**

| 参数 | 类型 | 说明 |
|------|------|------|
| `folder` | string | 文件夹名称 |
| `file` | string | 文件名（含扩展名） |

**响应 (200 OK)**

```http
Content-Type: text/html; charset=utf-8
// 或 audio/wav
// 或 audio/mpeg

[文件内容]
```

**错误响应**

```http
404 Not Found
```

**使用示例**

```bash
# 获取 HTML 文件
curl http://localhost:3010/api/folders/20260203/files/hello_world.html

# 获取音频文件
curl http://localhost:3010/api/folders/20260203/files/hello_world_en_1.wav -o audio.wav

# 获取 Markdown 文件
curl http://localhost:3010/api/folders/20260203/files/hello_world.md
```

---

### 4. 根据文件定位记录

根据文件夹和文件名查找数据库记录。

**请求**

```http
GET /api/records/by-file?folder=20260203&base=hello_world
```

**查询参数**

| 参数 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `folder` | string | ✅ | 文件夹名称 |
| `base` | string | ✅ | 文件基础名 |

**响应 (200 OK)**

```json
{
  "record": {
    "id": 123,
    "folder_name": "20260203",
    "base_filename": "hello_world"
  }
}
```

**错误响应**

```json
// 400 Bad Request
{
  "error": "folder and base are required"
}

// 404 Not Found
{
  "error": "Record not found"
}
```

**使用示例**

```bash
curl "http://localhost:3010/api/records/by-file?folder=20260203&base=hello_world"
```

---

## 健康检查接口

### 系统健康检查

检查所有服务的健康状态和系统资源使用情况。

**请求**

```http
GET /api/health
```

**响应 (200 OK)**

```json
{
  "llm": {
    "status": "healthy",
    "message": "LLM service is available",
    "model": "qwen2.5:7b",
    "endpoint": "http://localhost:11434/v1"
  },
  "tts_en": {
    "status": "healthy",
    "message": "TTS English service is available",
    "model": "kokoro-v0_19.onnx",
    "endpoint": "http://tts-en:8000"
  },
  "tts_ja": {
    "status": "healthy",
    "message": "TTS Japanese service is available",
    "speaker": "3",
    "endpoint": "http://tts-ja:50021"
  },
  "storage": {
    "used": 245678901,
    "total": 107374182400,
    "percentage": 0.23,
    "records": 342,
    "files": 2394
  },
  "uptime": 86400
}
```

**服务状态**:
- `healthy` - 服务正常
- `unhealthy` - 服务异常
- `unavailable` - 服务不可用

**使用示例**

```bash
curl http://localhost:3010/api/health
```

---

## 错误码

### HTTP 状态码

| 状态码 | 说明 | 常见场景 |
|--------|------|----------|
| 200 | OK | 请求成功 |
| 400 | Bad Request | 缺少必填参数 |
| 404 | Not Found | 资源不存在 |
| 422 | Unprocessable Entity | 验证失败 |
| 429 | Too Many Requests | 速率限制 |
| 500 | Internal Server Error | 服务器错误 |

### 业务错误码

| 错误码 | 说明 | 解决方案 |
|--------|------|----------|
| `PHRASE_REQUIRED` | 缺少短语参数 | 提供 `phrase` 字段 |
| `RATE_LIMIT_EXCEEDED` | 超过速率限制 | 等待 4 秒后重试 |
| `VALIDATION_FAILED` | 内容验证失败 | 检查 LLM 输出格式 |
| `LLM_SERVICE_UNAVAILABLE` | LLM 服务不可用 | 检查 LLM 服务状态 |
| `TTS_SERVICE_UNAVAILABLE` | TTS 服务不可用 | 检查 TTS 服务状态 |
| `FILE_NOT_FOUND` | 文件不存在 | 检查文件路径 |
| `RECORD_NOT_FOUND` | 记录不存在 | 检查记录 ID |
| `DATABASE_ERROR` | 数据库错误 | 查看服务器日志 |

---

## 使用示例

### 完整生成流程

```bash
# 1. 检查系统健康
curl http://localhost:3010/api/health

# 2. 生成学习卡片
curl -X POST http://localhost:3010/api/generate \
  -H "Content-Type: application/json" \
  -d '{"phrase":"hello world"}'

# 3. 查看最近记录
curl http://localhost:3010/api/recent?limit=1

# 4. 获取记录详情
curl http://localhost:3010/api/history/123

# 5. 获取 HTML 文件
curl http://localhost:3010/api/folders/20260203/files/hello_world.html

# 6. 搜索相关内容
curl "http://localhost:3010/api/search?q=hello"

# 7. 查看统计数据
curl http://localhost:3010/api/statistics
```

### OCR 识别流程

```bash
# 1. 读取图片并转换为 Base64
IMAGE_BASE64=$(base64 -i image.png | tr -d '\n')

# 2. 发送 OCR 请求
curl -X POST http://localhost:3010/api/ocr \
  -H "Content-Type: application/json" \
  -d "{\"image\":\"data:image/png;base64,$IMAGE_BASE64\"}"

# 3. 使用识别结果生成卡片
curl -X POST http://localhost:3010/api/generate \
  -H "Content-Type: application/json" \
  -d '{"phrase":"[OCR识别结果]"}'
```

### 批量查询与删除

```bash
# 1. 查询所有记录
curl "http://localhost:3010/api/history?limit=100"

# 2. 搜索特定短语
curl "http://localhost:3010/api/search?q=test"

# 3. 批量删除（脚本示例）
for id in 120 121 122; do
  curl -X DELETE "http://localhost:3010/api/records/$id"
done

# 4. 按文件名删除
curl -X DELETE "http://localhost:3010/api/records/by-file?folder=20260203&base=test_phrase"
```

---

## 高级用法

### 统计分析查询

```bash
# 按 Provider 对比
curl "http://localhost:3010/api/statistics?dateFrom=2026-01-01&dateTo=2026-02-03" \
  | jq '.statistics.providerDistribution'

# 质量趋势分析
curl "http://localhost:3010/api/statistics" \
  | jq '.statistics.qualityTrend."7d"'

# Token 使用统计
curl "http://localhost:3010/api/statistics" \
  | jq '{total: .statistics.totalCount, avgTokens: .statistics.avgTokensTotal, totalCost: .statistics.totalCost}'
```

### 全文搜索与过滤

```bash
# 搜索 + 分页
curl "http://localhost:3010/api/search?q=hello&limit=5"

# 搜索 + 历史过滤
SEARCH_RESULT=$(curl -s "http://localhost:3010/api/search?q=hello" | jq -r '.results[0].id')
curl "http://localhost:3010/api/history/$SEARCH_RESULT"
```

---

## 🔗 相关文档

- [BACKEND.md](./BACKEND.md) - 后端架构文档
- [FRONTEND.md](./FRONTEND.md) - 前端架构文档
- [repo_status.md](./repo_status.md) - 项目架构总览

---

**维护者**: Three LANS Team
**最后更新**: 2026-02-03
