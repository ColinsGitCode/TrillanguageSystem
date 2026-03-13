# API 接口文档

**项目**: Trilingual Records  
**API 版本**: v1.4  
**更新日期**: 2026-03-13

## 1. 总览

- Base URL: `http://localhost:3010/api`
- 协议: HTTP + JSON
- 认证: 本地部署默认无鉴权（当前项目内 `gemini-proxy` 第一阶段默认走内网转发）

### 1.1 端点列表

| 类别 | 方法 | 路径 | 说明 |
|---|---|---|---|
| 生成 | POST | `/generate` | 生成学习卡片（单模型/对比） |
| 队列 | POST | `/generation-jobs` | 创建共享生成任务 |
| 队列 | GET | `/generation-jobs` | 获取共享生成任务列表 |
| 队列 | GET | `/generation-jobs/summary` | 获取共享生成任务摘要 |
| 队列 | GET | `/generation-jobs/events` | 获取共享生成任务审计时间线 |
| 队列 | GET | `/generation-jobs/:id` | 获取单任务详情（完整 payload / 错误详情 / 审计事件） |
| 队列 | POST | `/generation-jobs/:id/retry` | 重试失败任务 |
| 队列 | POST | `/generation-jobs/:id/cancel` | 取消排队任务 |
| 队列 | POST | `/generation-jobs/clear-done` | 清理 success/cancelled 任务 |
| OCR | POST | `/ocr` | OCR 识别（tesseract/local/auto） |
| 健康 | GET | `/health` | 服务健康检查 |
| Gemini CLI auth | GET/POST | `/gemini/auth/*` | 仅 `GEMINI_MODE=cli` 有效 |
| 历史 | GET | `/history` | 历史分页查询 |
| 历史 | GET | `/history/:id` | 历史详情 |
| 统计 | GET | `/statistics` | Mission Control 统计数据 |
| 搜索 | GET | `/search` | FTS 全文搜索 |
| 最近 | GET | `/recent` | 最近记录 |
| 文件 | GET | `/folders` | 日期目录列表 |
| 文件 | GET | `/folders/:folder/files` | 指定目录文件列表 |
| 文件 | GET | `/folders/:folder/files/:file` | 读取 md/html/音频 |
| 标红 | GET | `/highlights/by-file` | 按 folder+base+sourceHash 获取标红 |
| 标红 | PUT | `/highlights/by-file` | 保存/更新标红 |
| 标红 | DELETE | `/highlights/by-file` | 删除标红（可按 sourceHash） |
| 记录 | GET | `/records/by-file` | 按 folder+base 查询记录 |
| 记录 | DELETE | `/records/by-file` | 按 folder+base 删除记录与文件 |
| 记录 | DELETE | `/records/:id` | 按 generationId 删除记录与文件 |
| TRAIN | GET | `/training/by-generation/:id` | 按 generationId 获取训练包 |
| TRAIN | GET | `/training/by-file` | 按 folder+base 获取训练包 |
| TRAIN | POST | `/training/by-generation/:id/regenerate` | 重新生成训练包 |
| TRAIN | GET | `/training/backfill/summary` | 查询历史 TRAIN 回填统计 |
| TRAIN | POST | `/training/backfill` | 批量回填历史 TRAIN 资产 |
| Dashboard | GET | `/dashboard/highlight-stats` | 标红聚合统计 |
| 实验 | GET | `/experiments/:id` | few-shot 实验导出 |
| 评审 | GET | `/review/campaigns` | 评审批次列表 |
| 评审 | GET | `/review/campaigns/active` | 当前激活批次 |
| 评审 | POST | `/review/campaigns` | 创建评审批次（snapshot） |
| 评审 | GET | `/review/campaigns/:id/progress` | 批次进度 |
| 评审 | POST | `/review/campaigns/:id/finalize` | 统一处理并更新注入资格 |
| 评审 | POST | `/review/campaigns/:id/rollback` | 回滚已完成批次（重置 eligibility，保留评分） |
| 评审 | POST | `/review/backfill` | 回填历史记录到评审池 |
| 评审 | GET | `/review/generations/:id/examples` | 获取该卡片例句样本 |
| 评审 | POST | `/review/examples/:id/reviews` | 保存例句评分/评论 |
| Knowledge | POST | `/knowledge/jobs/start` | 启动知识分析任务 |
| Knowledge | GET | `/knowledge/jobs` | 任务列表（倒序） |
| Knowledge | GET | `/knowledge/jobs/:id` | 任务详情 |
| Knowledge | POST | `/knowledge/jobs/:id/cancel` | 取消任务（queued/running） |
| Knowledge | GET | `/knowledge/summary/latest` | 最近 summary 结果 |
| Knowledge | GET | `/knowledge/index` | 术语索引查询 |
| Knowledge | GET | `/knowledge/synonyms` | 同义边界分组查询 |
| Knowledge | GET | `/knowledge/grammar` | 语法模式查询 |
| Knowledge | GET | `/knowledge/clusters` | 主题聚类查询 |
| Knowledge | GET | `/knowledge/issues` | 质量问题清单查询 |

---

## 2. 生成接口

### 2.1 `POST /api/generate`

#### 请求体（常用字段）

```json
{
  "phrase": "提示词工程",
  "llm_provider": "local",
  "enable_compare": false,
  "card_type": "trilingual",
  "source_mode": "input",
  "target_folder": "20260224",
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
    "teacherFirst": true,
    "reviewGated": true,
    "reviewOnly": false,
    "reviewMinOverall": 4.2
  }
}
```

#### 说明

- `llm_provider`: `local` / `gemini`
- `enable_compare=true`: 同时执行 Gemini + Local，并返回 `comparison`
- `card_type`: `trilingual` / `grammar_ja`
  - `trilingual`: 现有中英日三语卡片
  - `grammar_ja`: 日语语法卡片（中文讲解 + 日语例句）
- `source_mode`: `input` / `selection` / `ocr`（用于链路追踪）
- `target_folder`: 指定日期目录；未传则按当前日期
- `llm_model`: 覆盖模型名（gemini 会透传到项目内 `gemini-proxy`，再转发到宿主机 executor）
- `fewshot_options.reviewGated/reviewOnly/reviewMinOverall`: 控制人工评审门控注入

### 2.2 `POST /api/generation-jobs`

用于共享队列入队，不直接在当前浏览器内执行。

请求示例：

```json
{
  "phrase": "冷热数据分离",
  "llm_provider": "gemini",
  "card_type": "trilingual",
  "source_mode": "input",
  "target_folder": "",
  "llm_model": "gemini-3-pro-preview",
  "enable_compare": false,
  "source_context": {
    "entry": "main-input"
  }
}
```

响应关键字段：

```json
{
  "success": true,
  "job": {
    "id": 12,
    "jobType": "trilingual",
    "status": "queued",
    "attempts": 0
  },
  "summary": {
    "total": 3,
    "queued": 2,
    "running": 1,
    "success": 8,
    "failed": 0,
    "cancelled": 0
  }
}
```

- 同短语 + 同卡片类型在 `queued/running/failed` 期间会返回 `409`
- `source_context` 仅作审计与 UI 上下文记录，不参与实际生成语义

### 2.3 `GET /api/generation-jobs/events`

用于读取共享队列某个任务的审计时间线，供主页面队列面板与 Mission Control 展示。

请求示例：

```text
GET /api/generation-jobs/events?jobId=12&limit=12
```

响应关键字段：

```json
{
  "success": true,
  "events": [
    {
      "id": 101,
      "jobId": 12,
      "eventType": "created",
      "payload": {
        "phrase": "冷热数据分离",
        "jobType": "trilingual"
      },
      "createdAt": "2026-03-13 12:30:00"
    }
  ]
}
```

- `jobId` 可选；未传时返回最近事件
- 当前 UI 默认优先展示：
  - `running` 任务的时间线
  - 否则展示最近一个 `failed`
  - 再否则展示最近一个任务

#### 单模型成功响应（关键字段）

```json
{
  "success": true,
  "experiment_id": "exp_round_xxx",
  "experiment_round": 1,
  "card_type": "grammar_ja",
  "source_mode": "selection",
  "provider_requested": "gemini",
  "provider_used": "local",
  "fallback": {
    "from": "gemini",
    "to": "local",
    "reason": "upstream timeout"
  },
  "generationId": 123,
  "result": {
    "folder": "20260224",
    "baseName": "提示词工程",
    "targetDir": "/data/trilingual_records/20260224"
  },
  "audio": {
    "tasks": [],
    "errors": []
  },
  "prompt": "...",
  "llm_output": {
    "markdown_content": "...",
    "html_content": "...",
    "audio_tasks": []
  },
  "observability": {
    "tokens": { "input": 0, "output": 0, "total": 0 },
    "quality": { "score": 0, "dimensions": {} },
    "performance": { "totalTime": 0, "phases": {} },
    "metadata": {
      "provider": "local",
      "model": "qwen2_5_vl",
      "cardType": "grammar_ja",
      "sourceMode": "selection",
      "promptText": "...",
      "promptParsed": {},
      "rawOutput": "...",
      "outputStructured": "...",
      "fewShot": {
        "enabled": true,
        "countRequested": 3,
        "countUsed": 2,
        "fallbackReason": "budget_reduction"
      }
    }
  },
  "training": {
    "status": "ready",
    "source": "llm",
    "qualityScore": 88.6,
    "assetId": 456
  }
}
```

#### 对比模式响应（关键字段）

```json
{
  "phrase": "提示词工程",
  "gemini": { "success": true, "result": {}, "output": {}, "observability": {}, "audio": {} },
  "local": { "success": true, "result": {}, "output": {}, "observability": {}, "audio": {} },
  "input": { "success": true, "result": {} },
  "comparison": {
    "winner": "gemini",
    "metrics": {
      "speed": { "gemini": 1000, "local": 1200 },
      "quality": { "gemini": 90, "local": 82 },
      "tokens": { "gemini": 1300, "local": 900 },
      "cost": { "gemini": 0, "local": 0 }
    }
  }
}
```

---

## 3. OCR 接口

### 3.1 `POST /api/ocr`

请求：

```json
{
  "image": "data:image/png;base64,...",
  "provider": "tesseract",
  "langs": "eng+jpn+chi_sim"
}
```

响应：

```json
{
  "text": "识别结果",
  "provider": "tesseract"
}
```

- `provider` 支持：`tesseract` / `local` / `auto`
- `auto` 模式下：优先 tesseract，失败回退 local OCR

---

## 3.2 TRAIN 训练包接口

### `GET /api/training/by-generation/:id`

- 返回指定 generation 的训练包（含 payload、质量、来源、校验错误等）。
- 未命中返回 `404`.

### `GET /api/training/by-file?folder=YYYYMMDD&base=xxx`

- 通过目录+基础文件名查询训练包（用于历史卡片/无 generationId 场景）。
- 未命中返回 `404`.

### `POST /api/training/by-generation/:id/regenerate`

- 使用 teacher LLM 重新生成并覆盖该卡片训练包。
- 同步写入：
  - DB: `card_training_assets`
  - 文件 sidecar: `<base>.training.v1.json`
- 返回最新训练包数据。

### `GET /api/training/backfill/summary`

- 返回历史 TRAIN 资产补全统计：
  - `totalGenerations`
  - `withTraining`
  - `missingTraining`
  - `readyCount / repairedCount / fallbackCount / failedCount`
- 支持筛选参数：
  - `folder`
  - `cardType`
  - `provider`

### `POST /api/training/backfill`

- 对历史卡片批量回填 `TRAIN` 训练包。
- 入参：
  - `limit`
  - `force`
  - `folder`
  - `cardType`
  - `provider`
- 回填策略：
  - `runtimeMode=backfill`
  - 优先走 teacher LLM
  - 若 Gateway breaker 非 `closed`，直接快速回退到 heuristic，避免整批任务长时间阻塞
  - 每张卡片独立收敛，不因单卡异常拖垮整批
- 返回：
  - `processed`
  - `readyCount / repairedCount / fallbackCount / failedCount`
  - `results[]`
  - `summary`

---

## 4. 查询与统计接口

### 4.1 `GET /api/history`

参数：`page`、`limit`、`search`、`provider`、`card_type`、`dateFrom`、`dateTo`

### 4.2 `GET /api/history/:id`

返回单条完整记录（含 `observability` 与 `audioFiles`）

### 4.3 `GET /api/statistics`

参数：`provider`、`dateFrom`、`dateTo`  
返回：质量/Token/延迟趋势、provider 分布、配额估算

### 4.4 `GET /api/search`

参数：`q`（必填）、`limit`

### 4.5 `GET /api/recent`

参数：`limit`

---

## 4.6 Knowledge Ops 接口

### `POST /api/knowledge/jobs/start`

请求：

```json
{
  "jobType": "index",
  "scope": {
    "folderFrom": "2026.03.01",
    "folderTo": "2026.03.05",
    "cardTypes": ["trilingual"],
    "limit": 500
  },
  "batchSize": 50,
  "triggeredBy": "dashboard"
}
```

`jobType` 支持：`summary | index | synonym_boundary | grammar_link | cluster | issues_audit`

### `GET /api/knowledge/jobs`

参数：`limit`（默认 20）  
返回字段：`status/totalBatches/doneBatches/errorBatches/resultSummary/errorMessage/startedAt/finishedAt`

### `POST /api/knowledge/jobs/:id/cancel`

取消 queued/running 的任务，返回 `cancelled: true|false`

### 查询端点（只读）

- `GET /api/knowledge/summary/latest`：最近 summary 输出
- `GET /api/knowledge/index?query=&limit=`
- `GET /api/knowledge/synonyms?phrase=&limit=`
- `GET /api/knowledge/grammar?pattern=&limit=`
- `GET /api/knowledge/clusters?limit=`
- `GET /api/knowledge/issues?issueType=&severity=&resolved=&limit=`

---

## 5. 文件与删除接口

### 5.1 文件读取

- `GET /api/folders`
- `GET /api/folders/:folder/files`
- `GET /api/folders/:folder/files/:file`

`GET /api/folders/:folder/files` 返回项新增：

```json
{
  "file": "〜ざるを得ない.html",
  "title": "〜ざるを得ない",
  "cardType": "grammar_ja"
}
```

### 5.2 删除接口兼容说明

- `DELETE /api/records/by-file` 已兼容历史文件名脏数据（如前导空格）。
- 删除逻辑会同时尝试：
  1. DB 记录删除（含音频与观测关联清理）
  2. 基于 `folder+base` 的文件兜底扫描删除
- 删除记录时会同步清理 `card_highlights` 标红持久化数据。

### 5.2.1 记录与文件删除

- `DELETE /api/records/:id`
- `DELETE /api/records/by-file?folder=YYYYMMDD&base=xxx`

删除会同时清理：

- `generations` 记录
- `observability_metrics` 记录
- `audio_files` 记录
- 对应 `md/html/meta/audio` 物理文件

### 5.3 标红持久化

- `GET /api/highlights/by-file?folder=YYYYMMDD&base=xxx&sourceHash=abc123`
- `PUT /api/highlights/by-file`
- `DELETE /api/highlights/by-file?folder=YYYYMMDD&base=xxx[&sourceHash=abc123]`

保存请求体示例：

```json
{
  "folder": "20260303",
  "base": "高可用性と冗長化",
  "sourceHash": "3f06a8c1",
  "html": "<h1>...</h1><mark class=\"study-highlight-red\">重点</mark>",
  "generationId": 123,
  "version": 1,
  "updatedBy": "owner"
}
```

说明：

- `sourceHash` 用于绑定当前 markdown 源版本，避免旧标红覆盖新内容
- 返回包含 `markCount` 与 `highlightedChars`，用于后续分析

### 5.4 标红统计

- `GET /api/dashboard/highlight-stats?dateFrom=2026-02-01&dateTo=2026-03-03&provider=gemini&cardType=trilingual`

返回核心字段：

- `overview.highlightedCards`：有标红的卡片数
- `overview.totalMarks`：标红 `<mark>` 数量总和
- `overview.totalHighlightedChars`：高亮字符总量
- `byCardType`：按卡片类型聚合
- `byProvider`：按模型来源聚合
- `trend`：按日趋势（近 90 天）

---

## 6. few-shot 实验导出

### 6.1 `GET /api/experiments/:id`

返回字段（核心）：

- `runs`: few-shot run 明细
- `examples`: run 对应注入样本映射
- `rounds`: round 聚合趋势
- `samples`: 样本级明细
- `teacherRefs`: teacher 快照
- `deltas`: 相对 baseline 的质量/Token/延迟变化

---

## 7. 人工评审接口

### 7.1 创建与管理批次

- `GET /api/review/campaigns`
- `GET /api/review/campaigns/active`
- `POST /api/review/campaigns`
- `GET /api/review/campaigns/:id/progress`
- `POST /api/review/campaigns/:id/finalize`
- `POST /api/review/campaigns/:id/rollback`

#### finalize 参数

```json
{
  "allowPartial": true,
  "minReviewRate": 0.3
}
```

- 默认要求批次无 pending 项
- `allowPartial=true`：启用采样模式，允许跳过未评审样本
- `minReviewRate`：采样模式下的最低评审比例（0~1），低于此值拒绝 finalize
- eligibility 判定新增 TTS 独立下限：`tts < 3.0` 直接 rejected

#### rollback 说明

- 仅对 `status=finalized` 的批次有效
- 事务性重置：`example_units.eligibility` → pending，聚合分数清零，`campaign.status` → active
- `example_reviews` 原始评分数据保留不删除，可重新 finalize

### 7.2 样本读取与评分

- `GET /api/review/generations/:id/examples?campaignId=1&reviewer=owner`
- `POST /api/review/examples/:id/reviews`

评分请求示例：

```json
{
  "campaignId": 1,
  "reviewer": "owner",
  "scoreSentence": 5,
  "scoreTranslation": 4,
  "scoreTts": 5,
  "decision": "approve",
  "comment": "例句自然，翻译准确，推荐注入"
}
```

---

## 8. 常见错误码

- `400`: 参数错误（如缺少 phrase / 非法 id）
- `404`: 记录不存在
- `422`: 生成内容校验失败
- `429`: 生成接口限流
- `500`: 服务内部错误

---

**维护者**: Three LANS Team
