# API 接口文档

**项目**: Trilingual Records  
**API 版本**: v1  
**更新日期**: 2026-02-24

## 1. 总览

- Base URL: `http://localhost:3010/api`
- 协议: HTTP + JSON
- 认证: 本地部署默认无鉴权（Gemini host-proxy 的鉴权在上游 Gateway 18888）

### 1.1 端点列表

| 类别 | 方法 | 路径 | 说明 |
|---|---|---|---|
| 生成 | POST | `/generate` | 生成学习卡片（单模型/对比） |
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
| 记录 | GET | `/records/by-file` | 按 folder+base 查询记录 |
| 记录 | DELETE | `/records/by-file` | 按 folder+base 删除记录与文件 |
| 记录 | DELETE | `/records/:id` | 按 generationId 删除记录与文件 |
| 实验 | GET | `/experiments/:id` | few-shot 实验导出 |
| 评审 | GET | `/review/campaigns` | 评审批次列表 |
| 评审 | GET | `/review/campaigns/active` | 当前激活批次 |
| 评审 | POST | `/review/campaigns` | 创建评审批次（snapshot） |
| 评审 | GET | `/review/campaigns/:id/progress` | 批次进度 |
| 评审 | POST | `/review/campaigns/:id/finalize` | 统一处理并更新注入资格 |
| 评审 | POST | `/review/backfill` | 回填历史记录到评审池 |
| 评审 | GET | `/review/generations/:id/examples` | 获取该卡片例句样本 |
| 评审 | POST | `/review/examples/:id/reviews` | 保存例句评分/评论 |

---

## 2. 生成接口

### 2.1 `POST /api/generate`

#### 请求体（常用字段）

```json
{
  "phrase": "提示词工程",
  "llm_provider": "local",
  "enable_compare": false,
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
- `target_folder`: 指定日期目录；未传则按当前日期
- `llm_model`: 覆盖模型名（gemini 会透传到 host-proxy）
- `fewshot_options.reviewGated/reviewOnly/reviewMinOverall`: 控制人工评审门控注入

#### 单模型成功响应（关键字段）

```json
{
  "success": true,
  "experiment_id": "exp_round_xxx",
  "experiment_round": 1,
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

## 4. 查询与统计接口

### 4.1 `GET /api/history`

参数：`page`、`limit`、`search`、`provider`、`dateFrom`、`dateTo`

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

## 5. 文件与删除接口

### 5.1 文件读取

- `GET /api/folders`
- `GET /api/folders/:folder/files`
- `GET /api/folders/:folder/files/:file`

### 5.2 记录与文件删除

- `DELETE /api/records/:id`
- `DELETE /api/records/by-file?folder=YYYYMMDD&base=xxx`

删除会同时清理：

- `generations` 记录
- `observability_metrics` 记录
- `audio_files` 记录
- 对应 `md/html/meta/audio` 物理文件

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

`finalize` 默认要求批次无 pending 项（可在请求体中策略性放宽）。

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
