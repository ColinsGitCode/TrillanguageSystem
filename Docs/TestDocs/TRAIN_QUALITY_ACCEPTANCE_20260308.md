# TRAIN 资产全量完成与抽样验收报告（2026-03-08）

## 1. 结论

- 当前 `TRAIN` 资产已实现 **全量覆盖**：`266 / 266`
- 当前状态分布：
  - `ready = 265`
  - `repaired = 1`
  - `fallback = 0`
  - `failed = 0`
- 结论：当前系统中的 `TRAIN` 资产已经达到“可直接用于 TRAIN 面板、历史卡片复用、后续知识资产加工”的交付状态。

## 2. 验收范围

- 数据范围：运行中数据库 `card_training_assets`
- 卡片总量：`266`
- 卡片类型：
  - `trilingual = 260`
  - `grammar_ja = 6`
- 验收时间：`2026-03-08`
- 验收目标：
  1. 确认所有卡片都存在 TRAIN 资产
  2. 确认训练包结构满足 schema 要求
  3. 抽样确认内容具备学习价值，而不是仅“结构存在”

## 3. 全量状态结果

### 3.1 覆盖率

- `totalGenerations = 266`
- `withTraining = 266`
- `missingTraining = 0`

### 3.2 状态分布

- `readyCount = 265`
- `repairedCount = 1`
- `fallbackCount = 0`
- `failedCount = 0`

### 3.3 按卡片类型统计

| cardType | total | avgQuality | avgCoverage | avgConfidence | avgTokens | avgLatency(ms) |
|---|---:|---:|---:|---:|---:|---:|
| trilingual | 260 | 99.02 | 0.993 | 0.984 | 2235.69 | 72593.02 |
| grammar_ja | 6 | 99.65 | 1.000 | 0.988 | 1873.17 | 65314.17 |

## 4. 全量结构校验

对 `266` 份 `payload_json` 做了结构检查，结果如下：

- `enCollocations` 最小值：`4`
- `enCollocations` 最大值：`4`
- `jaChunks` 最小值：`4`
- `jaChunks` 最大值：`5`
- `quizzes` 最小值：`4`
- `quizzes` 最大值：`5`
- 平均值：
  - `enCollocations = 4.000`
  - `jaChunks = 4.004`
  - `quizzes = 4.030`
- 不满足最低要求（`en < 4` / `ja < 4` / `quiz < 4`）的记录数：`0`

结论：

- 全量训练包均满足当前 schema 的最低内容门槛
- 当前 `TRAIN` 数据已不再存在“空包”或“半结构化残缺包”

## 5. 质量分布

### 5.1 质量分区间

| 质量区间 | 数量 |
|---|---:|
| `99-100` | 202 |
| `97-98.9` | 40 |
| `95-96.9` | 14 |
| `<95` | 10 |

### 5.2 repaired 记录

当前仅有 `1` 条 `repaired`：

- `generation_id = 510`
- `folder = 20260226`
- `base = 课題に合わせて`
- `status = repaired`
- `qualityScore = 98.5`
- `coverageScore = 1.0`
- `selfConfidence = 0.95`

说明：

- 修复链路是有效的
- repaired 记录数量极低，说明当前主链路输出稳定

### 5.3 低分项观察

低分记录主要集中在 `91.5 ~ 95.0` 区间，例如：

- `带节奏`
- `没关系`
- `容器编排`
- `提示词工程`
- `こまめに`
- `细枝末节`
- `fiddling with`
- `日中は元気に過ごしました`
- `可観測性`

这些记录的共同特征不是结构缺失，而更可能是：

- 源短语本身语义边界较宽
- 中英日映射存在多个合理表述
- distractor 或 chunk 的“区分度”相对略弱

## 6. 抽样内容验收

本次抽样选择了 6 张卡，覆盖：

- 技术术语
- 日语语法卡
- OCR/系统验证类短语
- repaired 样本
- 边界较宽的普通短语

### 样本 A：`かなり`（grammar_ja）

- `qualityScore = 100`
- EN 搭配样例：`quite difficult`
- JA 语块样例：`かなり難しい`
- Quiz 样例：要求在 `今日の試験は______難しかったです。` 中填入 `かなり`

判断：

- 副词语法点明确
- 中英映射、JA chunk、题目三者一致
- distractor 具备学习区分价值

### 样本 B：`課題に合わせて`（repaired）

- `status = repaired`
- `qualityScore = 98.5`
- EN 搭配样例：`according to the task`
- JA 语块样例：`課題に合わせて`
- Quiz 样例：根据句意选择 `according to`

判断：

- repaired 后产物结构与内容质量均可接受
- 没有出现“修复成功但内容退化”的迹象

### 样本 C：`报告`

- `qualityScore = 99.4`
- EN 搭配样例：`finish a report`
- JA 语块样例：`報告しておいて`
- Quiz 样例：`Did you ____ that bug to the dev team yet?`

判断：

- 英语工作场景搭配自然
- 日语块引入 `V-ておく`，具备实际学习价值
- 适合技术/职场语境训练

### 样本 D：`audio path test`

- `qualityScore = 97.1`
- EN 搭配样例：`run an audio path test`
- JA 语块样例：`オーディオパスのテストをやる`
- Quiz 样例：测试动作动词应选 `run`

判断：

- 工程类术语转化为可训练搭配成功
- 口语化日语表达合理
- 适合系统测试语境下的英日学习

### 样本 E：`消息队列`

- `qualityScore = 99.4`
- EN 搭配样例：`implement a message queue`
- JA 语块样例：`メッセージキューを導入する`
- Quiz 样例：围绕 `implement` 的动作动词选择

判断：

- 技术概念在 EN/JA 两侧都保留了“系统设计语义”
- 搭配不是机械翻译，具备领域表达训练价值

### 样本 F：`多模型对比`

- `qualityScore = 95.0`
- EN 搭配样例：`do a multi-model comparison`
- JA 语块样例：`多モデル比較をする`
- Quiz 样例：围绕 `do` 的固定搭配判断

判断：

- 结构完整，题目可用
- 但与高分样本相比，表达的“术语精炼度”和“干扰项锐度”略弱
- 该类卡片更适合作为二次精修候选

## 7. 性能观察

### 7.1 正常区间

- 大多数训练包生成时延在约 `40s ~ 80s`
- 从全量平均看：
  - `trilingual avgLatency ≈ 72.6s`
  - `grammar_ja avgLatency ≈ 65.3s`

### 7.2 明显离群点

发现 2 条明显长尾：

| generation_id | base | latency_ms | qualityScore |
|---|---|---:|---:|
| 441 | 矛盾 | 2537451 | 96.5 |
| 503 | 差不多 | 1102230 | 95.0 |

说明：

- 当前主风险已经不是内容质量，而是少量上游调用会出现极长尾
- 这些长尾记录最终成功，但会拖慢批量任务窗口

## 8. 综合判断

### 8.1 已达到的目标

- 全库 TRAIN 资产覆盖完成
- 全库无 fallback / failed
- 全量训练包均满足最小结构要求
- 抽样内容具备真实学习价值，不是“仅满足 schema”

### 8.2 当前仍建议关注的点

1. 对低分区间（特别是 `<= 95`）做二次人工抽查
2. 对长尾样本补充超时与卡顿观测
3. 后续可为 TRAIN 增加“内容人工评分”闭环，进一步区分高质量可复用样本

## 9. 建议的下一步

1. 把 `qualityScore <= 95` 的样本列为二次精修候选池
2. 在 UI 的 TRAIN 页加入“人工评分 / 评论”入口，形成长期优化闭环
3. 把本报告结论同步到系统状态文档，作为当前 TRAIN 主线已完成的基线

