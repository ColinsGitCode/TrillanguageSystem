# DS-W3 横向工作流一致性验收

> 日期：2026-07-23
>
> 状态：Accepted
>
> 范围：Task 29-34，桌面端

## 1. 结论

DS-W3 已完成。共享反馈、Activity、Review、错误恢复和保存状态已形成统一交互语言，但 Cards Factory、Learning Plan、KG unresolved 与 Review Session 仍保留各自的流程模型和领域所有权。

本阶段没有引入 Cloudscape 生产依赖，没有恢复旧 Mission Control、Knowledge Hub、Knowledge OPS 或旧 SRS，也没有开展移动端设计、开发或验收。

## 2. 各领域验收

| 领域 | 采用的流程模型 | 已接入能力 | 保留边界 |
|---|---|---|---|
| ProductShell | 横向协调层 | typed feedback、Activity drawer、右侧 Tools、焦点恢复 | 只保存公开摘要，不拥有教材、生成、学习或 KG 领域状态 |
| Cards Factory | Async job + 直接工作台 | 生成任务 Activity、成功/失败/重试/取消反馈、任务深链接 | 继续使用 `generation_jobs`；不是 Wizard；不迁入 textbook operation |
| Learning Plan | 单页表单 + Review | 范围、数量、预计天数、移出数量和 revision 审阅 | FSRS、队列集合和调度算法不变；revision 变化时阻止过期提交 |
| KG unresolved | Task workbench | TaskRail、ContextTools、ReviewSummary、resolve/dismiss | AI 只提供只读 proposal；split/merge 仍需独立身份迁移；不写 FSRS |
| Review Session | Focused session | ErrorSummary、SaveStatus、Session Summary | 不显示 Stage rail 或复杂 Tools；reveal、四档评分和幂等提交不变 |

## 3. 关键行为证据

- Shell feedback 与 Activity 使用 typed event，不直接操作页面 DOM。
- Activity drawer 仅在用户打开后接管焦点，关闭时恢复到触发按钮。
- Cards Factory 可从 Activity 深链接恢复指定生成任务。
- Learning Plan preview 返回 `planRevision` 与 `profileRevision`，审阅后 revision 漂移会阻止保存。
- KG feature flag 关闭时页面安全降级；AI proposal 不可自行接受。
- Review 评分失败时当前学习项保持不动，用户可重试。
- 动态日期按钮在视觉基线中使用最小遮罩；已批准的壳层活动入口和内容尺寸变化已更新桌面快照。

## 4. 验证结果

| 门禁 | 结果 |
|---|---|
| `npm run typecheck:react` | PASS |
| `npm run lint` | PASS |
| `npm run test:unit` | PASS，347/347 |
| `npm run test:integration` | PASS，63/63 |
| `npm run build:react` | PASS |
| 四域定向 Playwright | PASS，28/28 |
| UI quality + visual | PASS，7/7 |

四域定向 Playwright 包含：

- ProductShell：7 项；
- KG unresolved：2 项；
- Learning Assistance：5 项；
- Cards Factory：14 项。

## 5. 未扩大的范围

- 教材截图继续由 Codex `import-textbook-track` Skill 在应用外解析；页面仍从结构化 draft 的人工确认开始。
- 未新增应用内教材 OCR、截图上传或英日自动配对。
- 未改变 Study Item、Review Event、FSRS 或 Planning provider 的所有权。
- 未把 KG split/merge 伪装为普通 resolve；该能力需要独立身份迁移设计。
- 未做移动端适配或移动端视觉基线。

## 6. 下一门禁

进入 Final Task 35：备份持久化数据，重建 `three_lans_system` 容器，执行完整测试、运行态 smoke、数据不变量与 feature flag/rollback 验证，然后封板文档。
