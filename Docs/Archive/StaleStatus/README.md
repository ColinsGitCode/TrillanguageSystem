# StaleStatus — 已过期的现状文档归档

本目录存放历史上的"项目现状"快照文档。这些文档在写作时是准确的，但项目持续演进后已严重偏离当前代码状态。

## 为什么归档而不是删除

- 内容仍记录了项目在某个时间点的真实形态，有历史价值
- 部分章节（生成主链路、TRAIN 策略等）至今仍能作为设计参考
- 删除会丢失版本演进的可追溯性

## 当前现状应以何处为准

不要再依赖本目录的文档判断"项目现在长什么样"。当前现状的权威来源：

- **`CLAUDE.md`**：项目根目录，持续更新的架构与目录索引
- **代码本身**：`routes/`、`services/`、`services/db/`、`services/knowledge/`、`lib/`、`public/js/modules/`
- **`database/schema.sql`**：数据库结构

## 归档清单

| 归档文件 | 原位置 | 时点 | 主要偏差 |
|---|---|---|---|
| `BACKEND_v3.8.2_20260313.md` | `Status/BACKEND.md` | 2026-03-13 | 缺 `lib/`、`routes/`、`services/db/`、`services/knowledge/` 及 8+ 新服务文件 |
| `FRONTEND_v3.8.2_20260313.md` | `Status/FRONTEND.md` | 2026-03-13 | modules 列表缺 `generation-job-detail.js` |
| `API_v1.4_20260402.md` | `Status/API.md` | 2026-04-02 | 53 个端点，routes/ 现已拆为 13 个文件、80+ 路由 |
| `REPO_STATUS_v3.8.4_20260331.md` | `Status/repo_status.md` | 2026-03-31 | 与 `IMPLEMENTATION_LOG_v3.x_20260331.md` 大量重复 |

归档日期：2026-05-28。
