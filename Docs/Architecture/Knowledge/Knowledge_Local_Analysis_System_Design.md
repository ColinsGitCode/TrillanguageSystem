# 本地知识分析引擎落地设计（不依赖 Gemini CLI Proxy）

**版本**：v1.0  
**更新时间**：2026-03-03  
**适用范围**：`/data/trilingual_records` + `trilingual_records.db`

---

## 1. 背景与目标

当前系统已有卡片生成、历史、可观测与评审能力，但“知识分析能力”尚未成为可持续运营模块。  
本设计目标是在**不依赖外部模型调用**的前提下，将分析能力直接落地到系统后端，支持手动触发、可追踪、可回滚。

核心目标：

1. 全库卡片自动生成结构化知识资产（索引、语法关联、聚类、问题清单）
2. 分析结果直接进入系统数据库，可被 UI 和后续生成流程复用
3. 支持手动启动分析任务，异步执行，状态可追踪
4. 对历史数据可增量更新，不阻塞主生成链路

非目标（v1 不做）：

- 不接入在线大模型推理
- 不做复杂神经检索（向量库可作为后续增强）
- 不改变现有卡片生成主流程

---

## 2. 总体架构

## 2.1 三层结构

1. **任务层（Job Orchestration）**
   - 接收手动触发请求
   - 切分批次、调度执行、状态管理、失败重试

2. **分析层（Knowledge Analysis Engine）**
   - 纯本地算法：规则 + 统计 + NLP 轻量策略
   - 产出结构化 JSON（可校验）

3. **数据层（Persistence + Serving）**
   - 原始结果留痕
   - 物化知识表供 UI/API 直接查询

## 2.2 模块拆分（建议新增）

- `services/knowledgeJobService.js`：任务生命周期管理
- `services/knowledgeAnalysisEngine.js`：各任务算法实现
- `services/knowledgePersistService.js`：结果校验与入库
- `services/knowledgeQueryService.js`：UI 查询接口
- `scripts/knowledge_backfill.js`：全量/增量回填

---

## 3. 任务类型定义

统一任务类型：

- `summary`：学习内容与质量摘要
- `index`：英日中检索索引
- `synonym_boundary`：易混淆词边界分析
- `grammar_link`：语法点与例句双向关联
- `cluster`：主题聚类与标签化
- `issues_audit`：重复、缺音频、结构异常审计

---

## 4. 数据模型设计

## 4.1 任务主表

`knowledge_jobs`

- `id`（PK）
- `job_type`
- `scope_json`（日期范围、卡片类型、增量游标）
- `status`（queued/running/success/failed/cancelled/partial）
- `total_batches`
- `done_batches`
- `error_batches`
- `started_at`
- `finished_at`
- `triggered_by`
- `engine_version`

索引：
- `idx_kj_status_created(status, started_at desc)`
- `idx_kj_type_created(job_type, started_at desc)`

## 4.2 批次原始结果表

`knowledge_outputs_raw`

- `id`
- `job_id`
- `batch_no`
- `input_digest`
- `output_json`
- `status`
- `error_message`
- `created_at`

## 4.3 物化知识表

1) `knowledge_terms_index`
- `generation_id`（唯一）
- `phrase`
- `lang_profile`
- `en_headword`
- `ja_headword`
- `zh_headword`
- `aliases_json`
- `tags_json`
- `updated_at`

2) `knowledge_synonym_groups`
- `group_id`
- `group_key`
- `tone`
- `register`
- `collocation_note`
- `misuse_risk`
- `recommendation`
- `version`

3) `knowledge_synonym_members`
- `group_id`
- `generation_id`
- `term`
- `lang`

4) `knowledge_grammar_patterns`
- `pattern_id`
- `pattern`
- `explanation_zh`
- `version`

5) `knowledge_grammar_refs`
- `pattern_id`
- `generation_id`
- `sentence_excerpt`

6) `knowledge_clusters`
- `cluster_id`
- `label`
- `description`
- `keywords_json`
- `version`

7) `knowledge_cluster_cards`
- `cluster_id`
- `generation_id`
- `score`

8) `knowledge_issues`
- `issue_type`（duplicate_phrase/audio_missing/format_anomaly/...）
- `severity`
- `generation_id`
- `detail_json`
- `resolved`

## 4.4 版本发布机制

- 物化表增加 `version` + `is_active`
- 新任务先写 `staging version`
- 校验通过后激活版本
- 支持回滚到上一版

---

## 5. 算法设计（本地实现）

## 5.1 Summary

输入：`generations + observability_metrics + issues`  
方法：聚合统计 + 规则模板  
输出：主题分布、质量分布、异常概览、建议动作

## 5.2 Index

输入：卡片基础字段 + Markdown 解析结果  
方法：
- phrase 归一化
- 语言画像识别（zh/en/ja/mixed）
- headword 提取（en/ja/zh）
- 别名聚合（标题、翻译字段、短语变体）

## 5.3 Synonym Boundary

方法：
1. 先按中文翻译/关键词反向聚合候选组
2. 对候选词计算差异特征（语气词、场景词、搭配词）
3. 生成边界标签与误用风险等级

注：v1 使用规则与统计信号；后续可接入向量相似度增强召回。

## 5.4 Grammar Link

方法：
- 从日语例句提取语法 pattern（正则+字典）
- 建立 `pattern -> generation_id` 反向索引
- 记录示例句片段，供卡片弹窗跳转

## 5.5 Cluster

方法：
- 关键词字典 + TF-IDF 特征
- 主题标签打分，分配 1~3 个标签
- 可选 KMeans/HDBSCAN（后续）

## 5.6 Issues Audit

规则：
- 重复短语（归一化后重复）
- 音频缺失（Markdown 引用文件不存在）
- 结构异常（必填段缺失、非法 ruby 进入文件名等）

---

## 6. API 设计

## 6.1 任务控制

- `POST /api/knowledge/jobs/start`
- `GET /api/knowledge/jobs/:id`
- `POST /api/knowledge/jobs/:id/cancel`
- `POST /api/knowledge/jobs/:id/publish`
- `POST /api/knowledge/jobs/:id/rollback`

## 6.2 数据查询

- `GET /api/knowledge/index?query=...`
- `GET /api/knowledge/synonyms?phrase=...`
- `GET /api/knowledge/grammar?pattern=...`
- `GET /api/knowledge/clusters`
- `GET /api/knowledge/issues?severity=...`
- `GET /api/knowledge/summary/latest`

---

## 7. 与现有 UI 的对接

1. Mission Control 新增 `Knowledge Ops` 区块
   - 最近任务状态、覆盖率、异常数、版本号

2. 卡片弹窗新增
   - 易混淆词面板（同义词边界）
   - 相关语法面板（语法反向引用）

3. Phrase List / 历史页新增筛选
   - 按主题标签筛选
   - 按问题状态筛选（仅看异常/未修复）

---

## 8. 可观测性与质量门控

新增任务级指标：

- `job_duration_ms`
- `batch_success_rate`
- `records_covered`
- `output_validation_pass_rate`
- `publish_block_reason`（若未通过门控）

发布门槛建议：

- 覆盖率 >= 95%
- 校验通过率 >= 99%
- 严重错误数（high）= 0

---

## 9. 风险与缓解

1. 历史数据脏值影响分析准确性  
   - 先做清洗与回填，结果标注 `confidence`

2. 规则误判  
   - 增加人工复核入口与黑名单词典

3. 全量任务耗时长  
   - 采用增量模式 + 批处理 + 夜间执行

---

## 10. 结论

该方案可在不依赖外部模型的情况下，把“分析能力”沉淀为系统内可复用资产。  
第一阶段优先打通：`jobs + index + issues`，随后扩展 `synonym_boundary + grammar_link + cluster`。

