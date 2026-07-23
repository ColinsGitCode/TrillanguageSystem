# SaaS Workflow 状态、URL 与 View Model Contract

> 状态：**Accepted（2026-07-23）**
> 范围：桌面复杂长流程；教材课程为首个生产 adapter

## 1. 所有权

服务端领域事实决定 Track、revision、review 与 operation 状态。URL 只恢复用户上下文；React state 只保存未提交表单、焦点和临时展示状态。组件不得根据按钮文案或计数猜测领域状态。

教材截图理解、英日配对、中文提示、ruby、重点和置信度由 Codex `import-textbook-track` Skill 在应用外完成。页面从已导入 draft 的人工确认开始。

## 2. Workflow Stage

```text
intake -> review -> release -> processing -> complete
```

| Stage | 服务端来源 | 可进入条件 |
|---|---|---|
| `intake` | 没有选中 Track，或显式打开受控技术 intake | 无 Track |
| `review` | draft revision + review projection | 已导入 Track |
| `release` | 全部 active expression confirmed + publish preview | review complete |
| `processing` | operation queued/running/partially_failed/failed | operation 存在 |
| `complete` | operation succeeded，或已 published 且无 active operation | published |

非法或过期 Stage 归一化到当前 Track 最早可达 Stage。已导入 Track 默认进入 `review`，不重复展示截图/OCR/intake 流程。

## 3. URL Contract

```text
/textbooks?track=<trackId>&stage=<stage>&task=<expressionRevisionId>&operation=<operationId>
```

- URL 允许：稳定 ID、Stage、筛选与选中项；
- URL 禁止：教材原文、Manifest 路径、宿主机绝对路径、hash、错误详情；
- 过期 Track 回到首个可用 Track；
- 过期 Task 回到首个 `needs_attention`/`pending`，否则回到第一条 active expression；
- operation 不属于 Track 时移除 operation 参数；
- 用户选择对象使用 history push；同一对象内自动规范化使用 replace；
- 刷新、深链接、后退和前进必须恢复同一工作上下文。

## 4. Save 与离开语义

`clean / dirty / saving / saved / failed / conflict` 是 UI 保存状态，不是教材领域状态。只有 `dirty`、`saving`、`failed`、`conflict` 触发离开保护。保存成功不得抢夺输入焦点；失败保留输入；冲突必须提供重新加载与比较入口。

## 5. TextbookWorkflowViewModel

```ts
type TextbookWorkflowViewModel = {
  track: { id: number; title: string; status: string; revisionId: number };
  stage: WorkflowStage;
  stages: Array<{ id: WorkflowStage; state: 'complete' | 'current' | 'available' | 'locked' | 'failed' }>;
  review: {
    total: number;
    confirmed: number;
    needsAttention: number;
    pending: number;
    tasks: TextbookReviewTask[];
  };
  release: {
    available: boolean;
    previewRevision: string | null;
    expressionCount: number;
    unitCount: number;
    warnings: WorkflowWarning[];
  };
  operation: TextbookOperationView | null;
  commands: WorkflowCommandAvailability;
};
```

所有计数来自服务端 projection。原型中的 `6/8` 仅为合成演示，生产组件不得写死。

## 6. 命令映射

| UI 命令 | API |
|---|---|
| 保存表达修改 | `PATCH /api/textbooks/revisions/:id` |
| 更新逐表达确认 | `PUT /api/textbooks/revisions/:id/expressions/:expressionId/review` |
| 创建发布/TTS operation | `POST /api/textbooks/tracks/:id/operations` |
| 恢复 operation | `GET /api/textbooks/operations/:id` |
| 读取事件 | `GET /api/textbooks/operations/:id/events` |
| 重试失败步骤 | `POST /api/textbooks/operations/:id/retry` |

Review Summary 只展示服务端 preview；preview revision 变化必须阻止执行。

## 7. Stage 映射

- draft + review incomplete -> `review`;
- draft + review complete -> `release`;
- verified 且无 operation -> `release`;
- operation queued/running/partially_failed/failed -> `processing`;
- operation succeeded 或 published 且无 active operation -> `complete`;
- archived -> 只读 `complete`。

## 8. 通用原语边界

WorkflowShell、StageNavigation、TaskWorkbench、ContextTools、ReviewSummary、AsyncOperationPanel 只消费 adapter 输出，不调用领域 API。教材 adapter、Learning adapter、KG adapter 分别保留各自领域语义。
