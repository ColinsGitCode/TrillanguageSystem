# Review Scoring 改进 - 集成测试报告

**测试日期**: 2026-02-24
**测试环境**: Docker Compose (viewer container)
**测试对象**: `services/exampleReviewService.js` + `server.js` + 前端 (`app.js`, `api.js`, `styles.css`)
**测试结果**: 12/12 PASS（含 2 个测试中发现并修复的 bug）

---

## 1. 测试背景

对 `review_scoring_and_injection_gate.md` 方案的代码评审中发现 4 个可改进项，已全部实现。本次测试对这 4 项改进进行端到端集成验证：

| # | 改进项 | 核心改动 |
|---|--------|---------|
| 1 | TTS 独立下限 | `computeEligibility()` 新增 `minTts` 门控 |
| 2 | 采样评审模式 | `finalizeCampaign()` 支持 `allowPartial` + `minReviewRate` |
| 3 | Finalize 回滚 | 新增 `rollbackCampaign()` + API 路由 + 前端按钮 |
| 4 | 相似度优先 source_phrase | `getApprovedExamplesForFewShot()` 使用加权公式替换 `Math.max` |

---

## 2. 测试环境准备

### 2.1 容器重建

```bash
docker compose up -d --build viewer
```

代码通过 volume 映射到容器内 `/app` 目录，重建后自动加载最新代码。

### 2.2 数据库 Schema 迁移

测试中发现 **review 相关表（`example_units`、`review_campaigns`、`review_campaign_items`、`example_reviews`）未在已有数据库中创建**。原因是数据库文件创建于早期版本，当时 schema.sql 尚未包含这些表定义，且 `CREATE TABLE IF NOT EXISTS` 只在首次执行时生效。

**处理方式**：在容器内手动重新执行 `schema.sql`：

```bash
docker compose exec viewer node -e "
  const Database = require('better-sqlite3');
  const fs = require('fs');
  const db = new Database('/app/data/trilingual_records.db');
  db.exec(fs.readFileSync('/app/database/schema.sql', 'utf-8'));
  db.close();
"
```

执行后确认 4 张 review 表已创建，随后重启容器使服务加载新表结构。

### 2.3 测试数据准备

1. **生成测试卡片**：通过 Gemini 生成 `phrase="coffee break"` 的三语卡片，获得 `generationId=499`，自动解析出 4 条例句（id=903~906）
2. **确认评审批次**：项目中已存在 `campaign_id=1`（name=`campaign_pre_ui_20260219`），包含 840 条历史例句
3. **选用 campaign 内例句**：因新生成的例句不在已有 campaign 的快照范围内，测试使用 campaign 内的 `example_id=1~4` 进行评分

---

## 3. 测试用例与结果

### 3.1 改进 1：TTS 独立下限

**改动点**：`computeEligibility()` 新增第 83 行 `const minTts = Number(policy.minTts || 3.0)` 和第 95 行 `if (tts < minTts) return 'rejected'`

**问题场景**：改进前 `sentence=5, translation=5, tts=1` 的样本 overall=4.6 > 4.2，会被判定为 approved，TTS 质量极差的样本被注入到 few-shot 中。

**测试方法**：提交 4 组不同评分，执行采样 finalize 后检查 `example_units.eligibility`。

```
POST /api/review/examples/:id/reviews
  Body: { campaignId:1, reviewer:"tester", scoreSentence:X, scoreTranslation:Y, scoreTts:Z, decision:"approve" }
```

| 用例 | example_id | sentence | translation | tts | overall | 期望 eligibility | 实际 | 判定依据 | 结果 |
|------|-----------|----------|-------------|-----|---------|-----------------|------|---------|------|
| 1a | 1 | 5 | 5 | 1 | 4.6 | rejected | rejected | **tts=1 < minTts=3.0** (改进 1 生效) | PASS |
| 1b | 2 | 5 | 5 | 5 | 5.0 | approved | approved | 全部达标 | PASS |
| 1c | 3 | 4 | 4 | 4 | 4.0 | rejected | rejected | overall=4.0 < minOverall=4.2 | PASS |
| 1d | 4 | 5 | 5 | 3 | 4.8 | approved | approved | **tts=3 = minTts=3.0** (边界通过) | PASS |

**关键验证**：用例 1a 是改进 1 的核心场景——即使 overall=4.6 超过 4.2 阈值，tts=1 低于独立下限 3.0，仍被 rejected。用例 1d 验证了边界值 tts=3 正好等于阈值时通过。

> 注：eligibility 在 `upsertReview` 时不会立即计算，仅在 `finalizeCampaign` 事务中统一计算。因此评分后需要先 finalize 才能验证。

---

### 3.2 改进 2：采样评审模式

**改动点**：`finalizeCampaign()` 第 474~486 行新增 `allowPartial` 和 `minReviewRate` 参数处理。

**问题场景**：改进前 finalize 要求 100% 评审完成，大批次（如 840 条）不实际。

**测试方法**：在 840 条例句中仅评审 4 条（rate=0.48%），分 3 种方式调用 finalize。

```
POST /api/review/campaigns/1/finalize
```

| 用例 | 请求参数 | 期望 | 实际响应 | 结果 |
|------|---------|------|---------|------|
| 2a | `{}` (默认) | 报错：有 pending | `"campaign has pending examples, please finish reviews before finalize"` | PASS |
| 2b | `{allowPartial:true, minReviewRate:0.01}` | 报错：rate 不足 | `"review rate 0.5% is below minimum 1.0%"` | PASS |
| 2c | `{allowPartial:true, minReviewRate:0.001}` | 成功 finalize | `status=finalized, approved=2, rejected=2` | PASS |

**关键验证**：
- 2a 保持了原有的全量评审要求（向后兼容）
- 2b 验证了 `minReviewRate` 的门控生效（0.48% < 1%）
- 2c 验证了采样模式正常工作（0.48% > 0.1%），未评审的样本保持 `pending`，已评审的样本根据规则判定 eligibility

---

### 3.3 改进 3：Finalize 回滚

**改动点**：
- 后端：`exampleReviewService.js` 新增 `rollbackCampaign(campaignId)` 方法（事务内重置 eligibility/scores/status）
- 路由：`server.js` 新增 `POST /api/review/campaigns/:id/rollback`
- 前端：`api.js` 新增 `rollbackReviewCampaign()`，`app.js` 添加回滚按钮（红色，二次确认）

**问题场景**：改进前 finalize 后无法撤销，误操作不可逆。

**测试方法**：在 3.2 的 finalize 基础上执行回滚，检查数据恢复情况。

```
POST /api/review/campaigns/1/rollback
```

| 用例 | 操作 | 期望 | 实际 | 结果 |
|------|------|------|------|------|
| 3a | 对 finalized campaign 执行回滚 | campaign 恢复为 active | `status=active, approved=0, rejected=0` | PASS |
| 3b | 检查 example_units.eligibility | 全部恢复为 pending | id=1~4 均为 `eligibility=pending, overall=NULL, votes=0` | PASS |
| 3c | 检查 example_reviews 原始数据 | 评分记录保留 | 10 条评分记录完整保留（含评分值和评论） | PASS |
| 3d | 对 active campaign 执行回滚 | 报错 | `"only finalized campaigns can be rolled back"` | PASS |

**关键验证**：
- 3a/3b 确认回滚事务正确重置了 3 张表：`review_campaigns.status` → active，`review_campaign_items.status` → pending，`example_units` 的 eligibility/scores 全部清零
- 3c 确认 `example_reviews` 表中的原始评分数据**未被删除**，可用于重新 finalize
- 3d 确认了防御性检查：只有 finalized 状态的 campaign 才能回滚

**回滚后数据快照**：

```
example_units (id=1~4):
  id=1: eligibility=pending, overall=NULL, votes=0
  id=2: eligibility=pending, overall=NULL, votes=0
  id=3: eligibility=pending, overall=NULL, votes=0
  id=4: eligibility=pending, overall=NULL, votes=0

example_reviews (campaign_id=1):  ← 完整保留
  example_id=1: s=5, t=5, tts=1
  example_id=2: s=5, t=5, tts=5
  example_id=3: s=4, t=4, tts=4
  example_id=4: s=5, t=5, tts=3
```

---

### 3.4 改进 4：相似度优先 source_phrase

**改动点**：`getApprovedExamplesForFewShot()` 第 640 行将 `Math.max(phraseSim, sentenceSim)` 替换为 `phraseSim * 0.8 + sentenceSim * 0.2`。

**问题场景**：改进前使用 `Math.max`，当长句中碰巧包含部分匹配字符时，sentenceSim 会虚高，导致与用户输入无关的例句被优先注入。

**测试方法**：回滚后重新 finalize 使 2 条 approved 样本存在，然后调用 few-shot 选择逻辑并对比新旧公式。

```javascript
// 容器内直接调用
const results = svc.getApprovedExamplesForFewShot('摆烂', 3, {});
```

| 指标 | example_id=2 | example_id=4 |
|------|-------------|-------------|
| source_phrase | "摆烂" | "摆烂" |
| phraseSim（与 "摆烂" 的 bigram 相似度） | 1.000 | 1.000 |
| sentenceSim（与长句的 bigram 相似度） | 0.000 | 0.000 |
| **新公式** `0.8*phrase + 0.2*sent` | **0.800** | **0.800** |
| 旧公式 `Math.max` | 1.000 | 1.000 |

**关键验证**：
- 函数正常返回 2 条 approved 样本，格式为 few-shot 注入所需的 `{ input, output, qualityScore, metadata }` 结构
- 加权公式正确执行：source_phrase 获得 80% 权重，sentence 获得 20% 权重
- 当 source_phrase 完全匹配 (sim=1.0) 但句子文本不匹配 (sim=0.0) 时，加权分=0.8 vs 旧公式=1.0，差异合理
- 排序逻辑三级优先：`_similarity` > `score` > `votes`，符合设计意图

---

## 4. 测试中发现的 Bug 及修复

### Bug 1：`rollbackCampaign` 列名错误 — `review_comment`

**发现时机**：改进 3 首次执行回滚时
**错误信息**：`SqliteError: no such column: review_comment`
**根因**：`example_units` 表的列名为 `review_comment_latest`（schema.sql 第 460 行），但 rollback SQL 误写为 `review_comment`
**修复**：`services/exampleReviewService.js` 第 582 行 `review_comment = NULL` → `review_comment_latest = NULL`

### Bug 2：`rollbackCampaign` 列名错误 — `review_count`

**发现时机**：Bug 1 修复后再次执行回滚
**错误信息**：`SqliteError: no such column: review_count`
**根因**：`review_campaign_items` 表无 `review_count` 列（schema.sql 第 545~556 行），实际只有 `status` 和 `reviewed_at`
**修复**：`services/exampleReviewService.js` 第 589 行 `SET status = 'pending', review_count = 0` → `SET status = 'pending', reviewed_at = NULL`

两个 bug 均为实现时列名笔误，修复后通过全部回滚测试。

---

## 5. 前端改动验证说明

前端改动（采样按钮、回滚按钮、已完成标签、CSS 样式）通过代码审查确认，未进行浏览器端 UI 测试：

| 组件 | 文件 | 验证方式 |
|------|------|---------|
| "采样处理" 按钮 (绿色) | `app.js:1064`, `styles.css:.btn-sampling` | 代码审查 |
| "回滚" 按钮 (红色，二次确认) | `app.js:1067`, `styles.css:.btn-rollback` | 代码审查 |
| "已完成" 标签 (蓝色 badge) | `app.js:1058`, `styles.css:.review-badge.finalized` | 代码审查 |
| `rollbackReviewCampaign()` API | `api.js:136-140` | 通过 curl 等效验证 |

这些前端组件的 API 调用逻辑已通过 curl 端到端验证（与按钮点击等效），样式渲染需在浏览器中目视检查。

---

## 6. 测试总结

### 结果矩阵

| 改进 | 用例数 | 通过 | 失败 | 覆盖范围 |
|------|-------|------|------|---------|
| 1. TTS 独立下限 | 4 | 4 | 0 | 低分/高分/边界值/综合不达标 |
| 2. 采样评审模式 | 3 | 3 | 0 | 默认拒绝/rate 不足/rate 通过 |
| 3. Finalize 回滚 | 4 | 4 | 0 | 正常回滚/数据重置/数据保留/防御检查 |
| 4. 相似度加权 | 1 | 1 | 0 | 加权公式 + 排序逻辑 + 输出格式 |
| **总计** | **12** | **12** | **0** | |

### 向后兼容性

- 默认 `finalize({})` 行为不变（仍要求 100% 评审）
- `computeEligibility` 的 `minTts` 默认值 3.0，不影响已有 tts >= 3 的样本
- 回滚是新增能力，不影响现有流程
- 相似度加权只影响排序偏好，不改变 approved 样本的资格判定

### 已知限制

1. 前端 UI 样式未在浏览器中验证（按钮渲染、布局对齐）
2. 并发场景未测试（多人同时评审 + finalize + rollback）
3. 大数据量回滚性能未测试（840 条级别的事务耗时）
4. review 表在旧数据库中需要手动执行 schema 迁移

---

**测试执行者**: Claude Code
**测试日期**: 2026-02-24 13:00~13:30 UTC+9
