# SaaS 教材长流程 DS-W2 验收报告

> 日期：2026-07-23
>
> 状态：Accepted
>
> 范围：DS-W2 Task 15-28，桌面端

## 1. 验收结论

DS-W2 已把教材课程迁移为可恢复、可深链接、可人工确认的 SaaS 长流程。教材截图理解和英日配对仍由 Codex `import-textbook-track` Skill 在应用外完成；页面只接收结构化 draft，负责人工校对、copy-on-write 修订、逐表达确认、发布检查、后台处理、浏览和学习接入。

本阶段没有引入应用内教材 OCR、截图上传或自动配对，也没有改变 FSRS、Review Event 和 Study Item 的所有权。

## 2. 实施范围

- migration 006 增加逐表达 review projection、教材 operation 和 append-only operation event；
- Track 修订采用 copy-on-write，未改表达继承确认，已改表达回到 `needs_attention`；
- workflow API 返回服务端派生的 Stage、确认计数、任务和 operation；
- release operation 支持幂等、重启恢复、步骤状态、局部重试和完成摘要；
- publish 成功后 TTS 局部失败不会回滚已提交的教材与学习事实；
- `/textbooks` 使用 `track/stage/task/operation` 恢复工作上下文；
- 校对工作台优先展示低置信度和需注意项；
- 发布前 Review Summary 使用服务端 preview，并校验预览 revision；
- 官方整轨音频、EN/JA 单句 TTS、标红和派生卡行为保留；
- `/learn/plan?textbookTrack=<id>` 只预选 Track，不自动保存计划；
- Skill 在用户批准后只通过正式 import API 写入，并返回 review 深链接。

## 3. 发现并修复的问题

1. 幂等 release 重放在首次操作已发布 Track 后被可变状态门禁提前拒绝。现先识别完整幂等身份，再对新命令执行 review、verified 和 preview 检查；不同 Track、kind、preview 或 payload 仍返回冲突。
2. 完整 E2E 跨套件重置时，多修订 Track 的 `parent_revision_id` 自引用链触发外键约束。测试重置现按叶子到根拓扑删除修订，不修改生产事实。

## 4. 自动化证据

| 门禁 | 结果 |
|---|---|
| `npm run lint` | 通过 |
| `npm run typecheck:react` | 通过 |
| `npm run test:unit` | 347/347 |
| `npm run test:integration` | 63/63 |
| `npm run build:react` | 通过 |
| `npm run smoke` | 7/7 |
| 教材、Shell、Learning 定向 E2E | 14/14 |
| 桌面质量与视觉定向回归 | 7/7 |
| `npm run test:e2e` | 38/38 |
| `npm run test:textbooks:acceptance` | 通过，含 Compose contract |

## 5. 边界确认

- 测试只使用合成 Manifest，不包含真实教材原文、截图、音频或宿主机绝对路径；
- 未进行移动端设计、开发或验收；
- Cards Factory 仍排除 `textbook_track`；
- 页面没有教材 OCR 端点；
- `dailyNewLimit` 仍由学习计划控制；
- DS-W3 才横向扩展 Shell、Cards Factory、Learning Plan、KG unresolved 和 Review Session。
