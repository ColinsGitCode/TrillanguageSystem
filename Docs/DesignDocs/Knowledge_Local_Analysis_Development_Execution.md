# 本地知识分析引擎开发执行文档（详细版）

**版本**：v1.0  
**更新时间**：2026-03-03  
**对应设计文档**：`Knowledge_Local_Analysis_System_Design.md`

---

## 1. 目标与交付范围

本执行计划用于将“总结/归纳/索引/语法关联/聚类/问题审计”能力落地到系统内，且可通过手动任务触发运行。

本次开发不使用 Gemini CLI Proxy。

---

## 2. 里程碑拆分

## M0：准备阶段（0.5 天）

- [ ] 确认当前 DB 结构与迁移方式（`database/schema.sql` + `services/databaseService.js`）
- [ ] 定义 job_type 枚举与状态机
- [ ] 固化输出 schema（JSON Schema 或代码校验器）

验收：
- 输出《字段字典》与《状态机定义》

## M1：数据层与迁移（1 天）

实现项：

1. 在 `database/schema.sql` 增加知识任务与物化表
2. 在 `services/databaseService.js` 增加迁移语句（兼容旧库）
3. 增加 CRUD 方法：
   - `createKnowledgeJob / updateKnowledgeJobStatus / appendKnowledgeRawOutput`
   - `upsertKnowledgeIndex / replaceKnowledgeSynonymVersion / ...`

验收：
- [ ] 旧库启动后自动迁移成功
- [ ] 新表可插入/查询
- [ ] 回滚不破坏现有生成功能

## M2：分析引擎（1.5 天）

新增文件：
- `services/knowledgeAnalysisEngine.js`

实现函数：

- `runSummary(cards, metrics, issues)`
- `runIndex(cards)`
- `runSynonymBoundary(cards)`
- `runGrammarLink(cards)`
- `runCluster(cards)`
- `runIssuesAudit(cards, files)`

技术要求：
- 纯本地实现（正则、词典、统计）
- 输出结构严格符合 schema
- 每个函数返回 `result + quality(confidence,coverage_ratio) + warnings`

验收：
- [ ] 每种任务都有可运行最小样例
- [ ] 输出通过 schema 校验

## M3：任务编排与 API（1 天）

新增文件：
- `services/knowledgeJobService.js`

改动文件：
- `server.js`（新增 API 路由）

接口：
- `POST /api/knowledge/jobs/start`
- `GET /api/knowledge/jobs/:id`
- `POST /api/knowledge/jobs/:id/cancel`
- `POST /api/knowledge/jobs/:id/publish`

执行逻辑：
- 任务入队（queued）-> 批次执行（running）-> 结果校验 -> 写 raw + 物化 -> success/partial/failed

验收：
- [ ] 手动触发可启动任务
- [ ] 状态可查询
- [ ] 失败可见错误详情

## M4：查询接口与 UI 接入（1 天）

后端接口：
- `GET /api/knowledge/index`
- `GET /api/knowledge/synonyms`
- `GET /api/knowledge/grammar`
- `GET /api/knowledge/clusters`
- `GET /api/knowledge/issues`
- `GET /api/knowledge/summary/latest`

前端改动：
- `public/js/modules/dashboard.js`：Knowledge Ops 面板
- 卡片弹窗：增加“易混淆词/相关语法”区域（先读 API）

验收：
- [ ] Mission Control 可显示最新任务状态
- [ ] 卡片页可看到对应知识扩展信息

## M5：回填与基线报告（0.5~1 天）

新增脚本：
- `scripts/knowledge_backfill.js`

功能：
- 全量扫描历史卡片，按任务类型逐项回填
- 生成回填报告（覆盖率、失败数、异常项）

验收：
- [ ] 全库回填完成
- [ ] 产出报告落到 `Docs/TestDocs/`

---

## 3. 文件级开发清单（按优先顺序）

1. `database/schema.sql`
2. `services/databaseService.js`
3. `services/knowledgeAnalysisEngine.js`（新）
4. `services/knowledgeJobService.js`（新）
5. `server.js`
6. `public/js/modules/dashboard.js`
7. `public/js/modules/app.js`（卡片详情 API 消费）
8. `scripts/knowledge_backfill.js`（新）
9. `Docs/SystemDevelopStatusDocs/API.md`
10. `Docs/SystemDevelopStatusDocs/BACKEND.md`

---

## 4. 任务状态机

状态：
- `queued`
- `running`
- `success`
- `partial`
- `failed`
- `cancelled`

状态转换：
- `queued -> running`
- `running -> success|partial|failed|cancelled`
- `failed -> queued`（仅手动 retry）

取消策略：
- 仅对 `queued/running` 有效
- `running` 任务在当前批次结束后安全退出

---

## 5. 校验与发布流程

## 5.1 校验

- 结构校验：字段完整、类型正确
- 引用校验：`generation_id` 在 `generations` 中存在
- 质量校验：覆盖率和置信度是否达标

## 5.2 发布

- 所有结果先进入 `staging version`
- 满足门槛后执行 `publish`
- 发布时切换 `is_active=1`（旧版置为 0）

---

## 6. 测试计划

## 6.1 单元测试

- `runIndex`：语言画像、headword 抽取
- `runIssuesAudit`：重复/缺音频识别
- `runGrammarLink`：pattern 抽取稳定性

## 6.2 集成测试

- API 全链路：
  - `start -> status -> publish`
- 失败重试：
  - 人工注入脏数据验证 `partial/failed`

## 6.3 UI 测试

- Mission Control 显示任务进度
- 卡片详情展示知识扩展区
- 查询接口响应时间与空态展示

---

## 7. 回滚与安全策略

- 数据回滚：切换 `is_active` 到上一版本
- 代码回滚：保留旧接口不删除，采用 feature flag
- 并发保护：同类任务可限制单实例运行（避免重复写入）

---

## 8. 工时预估

- M0：0.5 天
- M1：1 天
- M2：1.5 天
- M3：1 天
- M4：1 天
- M5：0.5~1 天

总计：**5.5~6 天**

---

## 9. 首次上线建议顺序（务实版）

1. 先上线 `issues_audit + index`
2. 再上线 `summary + grammar_link`
3. 最后上线 `synonym_boundary + cluster`

理由：
- 前两项最容易验证正确性，且立即提升可用性
- 后两项对规则质量要求高，放在第二波更稳妥

---

## 10. 完成定义（DoD）

满足以下条件才算该项目完成：

- [ ] 手动任务可触发、可追踪、可取消
- [ ] 分析结果入库并可被 API 查询
- [ ] 至少 3 类结果在 UI 可见（index/synonym/grammar 或 issues）
- [ ] 历史全量回填执行一次并产出报告
- [ ] 关键文档同步更新（API/BACKEND/repo_status）

