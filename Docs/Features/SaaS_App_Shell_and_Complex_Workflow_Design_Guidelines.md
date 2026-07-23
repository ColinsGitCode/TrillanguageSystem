# SaaS App Shell 与复杂长流程设计及开发规范

> 状态：**Draft · 待可视化原型确认**
>
> 日期：2026-07-23
>
> 定位：React Router 时代的全站横向 UI/UX 与工程增补基线；定义 SaaS App Shell、复杂长流程、异步任务、人工确认和共享原语，不重新定义教材、学习辅助或知识图谱的领域语义
>
> 当前范围：仅桌面端；不启动移动端设计、实现或验收

## 0. 文档角色与权威边界

本文解决两个问题：

1. Three LANS 如何吸收 Cloudscape 的生产力布局与视觉基础，而不直接复制 AWS Console 外观；
2. 教材导入、学习计划、卡片生成、复习和知识点裁决等复杂流程，如何形成一致、可恢复、可测试的 SaaS 用户体验。

权威顺序固定为：

1. 根目录 `CLAUDE.md`、实际代码、`database/schema.sql` 和当前 API contract；
2. 教材课程、学习辅助 2.0、知识图谱 2.0 的 Accepted 产品定义与 ADR；
3. 本文定义的横向 Shell、Workflow 原语、交互和工程约束；
4. `UI_Modernization_Design_System.md` 中仍适用的 token、领域色、安静学习工作台和视觉克制原则；
5. 历史静态页面、已退役 Mission/Knowledge/SRS 方案只作背景，不得恢复。

冲突裁决：

- 领域状态、写入所有权、调度、发布、事件和审计，以各领域 Accepted ADR 为准；
- App Shell、密度、横向反馈、复杂流程导航、焦点与共享组件契约，以本文为准；
- 本文不得通过 UI 设计新增数据库状态或绕过领域门禁；UI 阶段优先从现有领域状态和 Job 状态派生。

### 0.1 教材课程不可改变的责任边界

SaaS 化只改造页面组织、人工确认、发布反馈和学习体验，不改变 TC-D0 已确认的教材处理责任：

1. 用户把教材截图和可选官方 Track 音频提供给当前 Codex 任务；
2. Codex 通过 `import-textbook-track` Skill 在应用外完成图像理解、英日配对、中文学习提示、汉字 ruby、重点与置信度分析，并产出 Git 外 draft Manifest；
3. 页面只接收 Skill 已生成的结构化草稿，并负责人工确认、必要修订、发布检查、音频使用和学习；
4. 页面不提供教材截图上传 OCR、自动版面解析、从空白开始的英日配对或用户重做 Skill 已完成工作的入口；
5. 校对工作台必须预填充 Skill 结果，优先展示低置信度、非直译、错配风险和人工修订项，而不是把全部表达呈现为空白录入任务。

任何 Shell、Stage、Task、Tools 或 Cloudscape 组件决策都不得将上述责任从 Codex Skill 转移到应用页面。

## 1. 已确认决策

### 1.1 Cloudscape 采用方式

1. 采用 Cloudscape Foundation 作为信息架构、密度、层级、反馈和无障碍的参考基线；
2. 采用 `AppLayoutToolbar` 的概念模型：左侧导航、中央工作区、右侧 Tools、Drawer、Split Panel 和全局反馈；
3. 当前 `ProductShell` 演进为应用级布局协调器，不立即整体替换；
4. 保留 Three LANS 现有 tokens、Lucide 图标、语言色、卡型色、Markdown/ruby/音频和安静学习视觉；
5. 先以教材课程制作独立桌面原型和组件 POC，再决定 `@cloudscape-design/components` 的实际引入范围；
6. POC 前不加载 `@cloudscape-design/global-styles`，避免 Open Sans 与全局样式静默覆盖现有视觉；
7. 若后续正式使用 Cloudscape 组件，必须使用单组件导入和官方 test utilities，不依赖其内部 DOM 或 CSS class。

### 1.2 长流程采用方式

复杂流程不等于 Wizard。系统先按用户任务分类，再选择交互结构：

| 流程模型 | 判断标准 | Three LANS 适用场景 | 主结构 |
|---|---|---|---|
| 分阶段配置 | 步骤相互依赖、后一步依赖前一步结果 | 教材 Skill 草稿接收与发布、首次学习计划 | Stage/Wizard + Review |
| 多任务工作台 | 多个任务可独立处理、顺序可变 | 教材逐句校对、KG unresolved | Task list + Detail tools |
| 异步后台执行 | 页面关闭后仍需继续、可失败重试 | 卡片生成、TTS、发布物化、KG worker | Job progress + Activity |
| 连续专注会话 | 用户重复完成同类动作、需要低干扰 | 每日学习、复习评分 | Focused session |

不得把教材的每个表达、每个 unresolved case 或每张卡片做成一个 Wizard 页面。

## 2. 当前实现评估

### 2.1 已具备的基础

- React Router 已提供页面路由、深链接和页面级边界；
- TanStack Query 已统一大部分 query/mutation 生命周期；
- `ProductShell` 已实现左侧导航、折叠模式、明暗主题、服务状态与基础焦点恢复；
- `tokens.css` 已使用 4px 基础间距、语义色、语言/卡型色、暗色映射、减少动效和可见焦点；
- Cards Factory 已有可持久查询的生成任务和审计时间线；
- Learning Review 已有 reveal 门禁、评分锁定、失败重试、会话恢复和结束确认；
- 教材、Learning 与 KG 后端已有明确状态、幂等、事件或异步 worker 基础。

### 2.2 当前缺口

- Shell 尚未统一管理 Flashbar、右侧 Tools、Drawer、Split Panel 和跨页面异步状态；
- 页面各自实现 Banner、Dialog、Retry、Save 状态，视觉语法和焦点行为容易漂移；
- `TextbookCoursesPage.tsx` 同时承担导入、搜索、Track 选择、校对、发布、TTS、标红和派生卡，职责过重；
- 多数流程上下文只保存在组件 state，刷新、后退和深链接恢复能力不足；
- 没有共享的 Workflow revision、Stage navigation、Save status、Error summary 和 Activity log 原语；
- 当前页面能显示结果，但缺少统一的“已保存什么、正在处理什么、失败在哪里、下一步是什么”表达。

## 3. 用户体验原则

### 3.1 以用户目标命名

阶段名称使用用户可控制、可识别的任务：

```text
接收 Skill 草稿 -> 人工确认 -> 发布检查 -> 后台发布 -> 进入学习
```

不得把阶段命名为 `INSERT`、`materialize`、`worker`、`projection` 或模型内部步骤。技术细节进入 Activity 或 Details。

### 3.2 区分 Stage、Task 与 Step

- **Stage**：业务阶段，数量稳定，用户可以理解并返回；
- **Task**：阶段内可独立完成的工作项，例如一条教材表达或一个 unresolved case；
- **Step**：系统执行过程，例如验证 Manifest、写入 draft、生成 EN TTS。

主导航只显示 Stage。Task 使用列表、表格或队列。Step 使用状态列表或 Progressive Steps。

### 3.3 持续定位

每个复杂流程页面必须提供：

- 流程名称和对象身份；
- 当前 Stage；
- 已完成、当前、待处理和失败状态；
- 未保存变更提示；
- 关键选择的简要摘要；
- 明确的下一主动作。

已完成 Stage 可返回；返回前保存当前草稿。不可访问的未来 Stage 显示锁定原因，而不是无解释禁用。

### 3.4 保存、退出与恢复

- 输入型流程必须有 durable draft；
- 自动保存只保存草稿，不执行发布、评分、接受关系等领域命令；
- 界面显示 `未保存 / 保存中 / 已保存 / 保存失败`；
- 刷新后恢复当前对象、Stage、选中 Task、筛选和草稿 revision；
- 用户返回修改时，原值必须预填，不要求重复输入；
- 离开存在未保存变更的页面时，使用浏览器与应用内离开保护。

### 3.5 渐进披露

默认显示完成当前任务所需的信息。以下内容进入右侧 Tools、Popover 或 Expandable details：

- hash、provider、model、rule version；
- 完整原始 payload；
- worker 日志和调试信息；
- 完整 provenance 和审计字段。

错误修复所需的信息不能折叠到不可发现的位置。

### 3.6 Review before commit

以下操作必须在执行前提供 Review Summary：

- 发布教材 Track；
- 修改学习计划范围并移出单元；
- 接受、合并或拆分 KG 关系；
- 批量删除、清理或隔离数据；
- 启用会改变真实队列的规划信号。

Review Summary 必须显示：范围、数量、变化、不可逆影响、警告、来源、执行后的结果，以及返回对应 Stage 修改的入口。主按钮使用具体动词，如“发布 20 条表达”，不使用“提交”。

### 3.7 异步透明度

- API 接受命令后返回可查询 Job；按钮不承担后台生命周期；
- 预计少于 1 秒的操作不闪烁 loading；
- 1-10 秒显示当前动作；
- 超过 10 秒显示步骤、进度或预期时间；
- 页面关闭后 Job 继续，重新进入仍显示状态；
- 失败只重试失败 Step，除非领域 contract 要求整体重跑；
- 完成后提供结果摘要和可展开执行明细；
- 全局 Flashbar 负责跨页面通知，业务面板保留可追溯状态。

### 3.8 恢复优先

错误信息必须回答：

1. 发生了什么；
2. 哪个对象或 Step 失败；
3. 已保存了什么；
4. 是否产生副作用；
5. 用户现在能做什么。

表单错误保留输入，并同时提供顶部 Error Summary 与字段级错误。Error Summary 链接到具体字段并接收焦点。

### 3.9 可逆与风险分级

| 风险 | 交互 |
|---|---|
| 可轻易重建、无副作用 | 直接执行 + 状态反馈 |
| 可恢复但成本明显 | 简单确认 |
| 不可逆或有级联影响 | Review + 明确影响 + 强确认 |

优先提供暂停、归档、撤销或 supersede，不直接物理删除历史事实。

### 3.10 AI Proposal 边界

- AI 输出必须标记 provider、model、版本、来源和生成时间；
- AI 建议与用户已确认事实在视觉和数据上分离；
- 提供 Evidence、diff、接受、修改、拒绝和 abstain；
- 置信度不能替代证据；
- 批量接受默认关闭；
- AI 失败不得阻断确定性流程、学习调度或已发布内容。

## 4. App Shell 桌面结构

```text
+----------------+------------------------------------------------------+
| Global nav     | Breadcrumb / workflow title / save / global actions |
|                +------------------------------------+-----------------+
| Learning       | Stage navigation                   | Context tools   |
| Textbooks      +------------------------------------+                 |
| Knowledge      | Main task workspace                | Evidence       |
| Factory        |                                    | Details        |
|                |                                    | Activity       |
|                +------------------------------------+-----------------+
| Health/theme   | Sticky workflow actions / async status               |
+----------------+------------------------------------------------------+
```

### 4.1 区域职责

- **Global navigation**：产品域切换，不显示领域内部 Stage；
- **Workflow header**：对象身份、Breadcrumb、当前状态、Save status；
- **Stage navigation**：只显示业务阶段和完成状态；
- **Main workspace**：当前 Task 或配置；
- **Context tools**：证据、预览、解释、属性和局部 Activity；
- **Sticky action bar**：返回、保存、继续、确认；主动作最多一个；
- **Global Flashbar**：跨页面成功、失败和长任务完成；
- **Drawer**：低频设置、帮助和系统信息；
- **Split Panel**：大体量任务详情或运行日志，不作为默认阅读区。

### 4.2 密度

- Shell、导航、任务列表、状态表和队列使用 Compact；
- 教材正文、学习答案、解释、错误和 Review Summary 使用 Comfortable；
- 密度通过语义 context 管理，不允许各组件随机缩小 padding；
- 所有间距继续使用当前 4px token 体系；
- 仅桌面端验收，支持的最小桌面视口由现有测试基线决定。

### 4.3 视觉

- 大面积保持中性画布和白/暗色 surface；
- 颜色用于主动作、卡型、语言和状态，不作无语义装饰；
- 普通布局依赖 1px 边框与间距；2px 用于选中、聚焦和高优先交互；
- 阴影只用于 Modal、Popover、悬浮工具栏、Sticky Panel 等重叠元素；
- 不把页面 section 包成层层嵌套卡片；
- 标题服务层级，不使用营销型超大字号。

## 5. 共享 Workflow 原语

以下是产品级原语，不拥有领域数据：

| 原语 | 职责 | 不负责 |
|---|---|---|
| `WorkflowShell` | 组合 header、stage、main、tools、actions | 领域状态转移 |
| `StageNavigation` | 显示阶段、状态和可访问性 | 推断业务完成条件 |
| `TaskList` | 筛选、选择、状态、批量入口 | 自动接受任务 |
| `WorkflowSaveStatus` | 未保存/保存中/成功/失败 | 发布或领域提交 |
| `ReviewSummary` | 范围、diff、警告、Change links | 绕过确认 |
| `AsyncOperationPanel` | Job/Step 进度、重试、结果 | 在浏览器内执行 worker |
| `ErrorSummary` | 聚合错误、定位字段、焦点 | 替代字段错误 |
| `StickyActionBar` | 返回、保存、继续、确认 | 同时放多个主动作 |
| `ActivityLog` | 展示领域事件和 Job 事件 | 成为系统日志全文查看器 |
| `ConfirmationGate` | 按风险提供确认 | 为低风险动作增加无意义摩擦 |

领域页面通过 props/view-model 提供状态和命令，不让共享组件 import 教材、Learning 或 KG service。

## 6. 状态与路由契约

### 6.1 状态分层

```text
Domain state       persisted, authoritative
Job state          persisted, queryable
Workflow view      derived from domain + job state
Draft/UI state     persisted draft or URL state
Transient UI       menu, tooltip, temporary selection
```

不得把 `isPublishing`、`currentStep=4` 之类 React state 当作长期业务事实。

### 6.2 通用状态词汇

```ts
type WorkflowStatus =
  | 'not-started'
  | 'in-progress'
  | 'needs-attention'
  | 'blocked'
  | 'completed';

type CommandStatus =
  | 'idle'
  | 'submitting'
  | 'accepted'
  | 'running'
  | 'succeeded'
  | 'failed';
```

这些是显示词汇，不替换领域表中的正式枚举。

### 6.3 URL

复杂流程 URL 至少表达：

```text
/{area}/{workflowId}/{stage}?task={taskId}&filter={filter}
```

- 刷新恢复当前 Stage 和 Task；
- 已完成 Stage 可深链接；
- 未满足前置条件的 Stage 返回明确 blocked view；
- 浏览器后退不撤销已经提交的领域命令；
- filter/sort/selection 是否入 URL 按恢复价值决定，临时 Popover 不入 URL。

## 7. 工程原则

### 7.1 显式状态机

每个复杂流程在开发前必须有状态转移表：

| 当前状态 | 命令 | 前置条件 | 成功状态 | 可重试 | 副作用 |
|---|---|---|---|---|---|

非法转移由服务端稳定错误码拒绝，客户端禁用只用于减少误操作，不构成安全边界。

### 7.2 Durable draft 与 revision

- Draft 有稳定 ID、revision、updatedAt；
- 保存命令携带 expected revision；
- revision 冲突返回最新版本和可比较摘要，不静默覆盖；
- 自动保存做 debounce，但显式 Save 立即执行；
- 发布、评分、接受关系永不由自动保存触发。

### 7.3 幂等命令

所有可能重试的写命令携带 `idempotencyKey` 或领域 `eventKey`：

- 生成卡片；
- 发布 Track；
- 生成 TTS；
- 评分；
- 手动加入学习；
- 接受 KG proposal；
- 批量维护。

同 key 同 payload 返回原结果；同 key 不同 payload 返回冲突。

### 7.4 异步 Job contract

```ts
type WorkflowJob = {
  id: string;
  kind: string;
  subjectType: string;
  subjectId: string;
  status: 'queued' | 'running' | 'succeeded' | 'failed' | 'cancelled';
  currentStep?: string;
  completedSteps: number;
  totalSteps?: number;
  retryable: boolean;
  errorCode?: string;
  createdAt: string;
  updatedAt: string;
};
```

实际领域可扩展，但必须支持重新查询、局部重试、审计和页面外完成通知。

### 7.5 验证

- UI 使用相同 contract 的客户端校验提供即时反馈；
- 服务端执行最终领域校验；
- 错误返回稳定 `code`、`field/path`、公开 message 和 retryable；
- 不把 stack、SQL、模型原始错误直接暴露给用户；
- 验证失败保留输入，不清空整个 Stage。

### 7.6 View-model 边界

页面不直接拼接多个数据库概念。每个 Stage 使用专用 view-model：

```ts
type WorkflowStageView = {
  workflow: { id: string; title: string; revision: number };
  stages: StageSummary[];
  current: StageDetail;
  tasks: TaskSummary[];
  tools: ContextToolModel;
  allowedCommands: AllowedCommand[];
};
```

`allowedCommands` 来自服务端领域判断，UI 不自行推断权限和完整前置条件。

### 7.7 可观测性

- 领域事件、Job 事件和用户命令使用 correlation ID 串联；
- Activity Log 只展示公开事件摘要；
- 后台日志保留技术细节但不进入默认 UI；
- 记录流程开始、恢复、放弃、完成、错误、重试和耗时；
- 不记录教材版权原文、密钥或不必要的用户输入。

## 8. 焦点、键盘与通知

- route/stage 成功切换后将焦点放到新 H1；
- Modal 打开时焦点进入，关闭后返回触发按钮；
- Error Summary 出现后接收焦点，错误项可跳转；
- 删除当前 Task 后，焦点移动到下一 Task 或列表标题；
- Stage navigation 是单一导航结构，支持跳过整个导航；
- 状态不能只靠颜色，必须配合文本和图标；
- 异步完成使用 `aria-live=polite`，阻断性错误按需使用 alert；
- 不主动移动焦点，除非用户动作产生了需要注意的新上下文；
- 所有 Sticky/Tools/Popover 在键盘下可操作并有可见 focus ring。

## 9. 领域映射

### 9.1 教材课程：首个样板

```text
接收 Skill 草稿（不识别截图，只验证 Manifest）
  -> 人工确认（Task workbench）
  -> 发布检查（Review Summary）
  -> 后台处理（Manifest/TTS/Study Item Jobs）
  -> 完成摘要与学习入口
```

- 截图识别和结构化在 Codex Skill 内完成，不在此页复制 OCR 或编排流程；
- 页面打开时已有预填充表达；表达校对是例外优先的 Task list，不是 20 页 Wizard；
- 右侧 Tools 显示当前表达 EN/JA/ZH、ruby、来源和校验；
- 发布按钮只在 Review Stage 出现；
- TTS 和物化进度由持久 Job 表示；
- 页面关闭和返回不丢失已校对内容与 Job 状态。

### 9.2 学习计划

- 当前字段规模适合单页配置 + 实时预览 + Review confirmation，不强制多页 Wizard；
- 范围、每日目标、教材 Track 与预计天数分组；
- 缩小范围时显示移出数量和历史保持语义；
- 保存计划和生成今日队列是领域命令，必须幂等。

### 9.3 Cards Factory

- 保持快速输入与入队，不增加 Wizard；
- 队列迁入 App Shell Tools 或统一 Dialog；
- 生成 Job 支持跨页面 Flashbar、Activity 和失败重试；
- 生成结果与原输入、模型、失败规则可追溯。

### 9.4 Review Session

- 保持沉浸式单任务界面；
- 不显示全局 Stage rail；
- 仅保留队列进度、当前项、揭示、评分和退出；
- 评分失败固定当前项，不自动前进；
- 结束后进入 Session Summary。

### 9.5 KG unresolved

- 使用筛选 Task list + Evidence detail + Decision tools；
- case 可独立处理，默认允许非线性顺序；
- 决策显示候选、证据、影响和审计；
- 不提供一键全部接受；
- DeepSeek 只产生 proposal，不直接改变 active graph。

## 10. 测试原则

### 10.1 领域与集成测试

- 每个合法/非法状态转移；
- 幂等重试和同 key 不同 payload 冲突；
- revision 冲突；
- Job restart、局部 retry 和重复 delivery；
- 命令成功但客户端超时后的恢复；
- Review Summary 与最终执行范围一致；
- Activity/audit 与领域事件一致。

### 10.2 浏览器 E2E

- 刷新、后退、前进和深链接恢复；
- 未保存离开保护；
- 返回修改后回到 Review；
- 页面关闭后异步任务继续；
- Error Summary 焦点与字段跳转；
- Modal 焦点进入和返回；
- 键盘完成主流程；
- Compact Shell 与 Comfortable reading context 无溢出；
- 支持的桌面视口视觉基线。

### 10.3 Cloudscape 组件测试边界

若后续 POC 引入 Cloudscape：

- 使用官方 test utilities 或公开 role/name；
- 不断言内部 class 或 DOM 层级；
- 不把 Cloudscape responsive/mobile 行为纳入当前 Three LANS 验收；
- 自定义 Markdown、ruby、Audio、CardModal 继续使用本项目测试契约。

## 11. 分阶段落地

### DS-W0：规范与原型

- [x] 完成 Cloudscape/Foundation 与复杂长流程调研；
- [x] 建立本文 Draft；
- [x] 完成教材课程桌面可视化原型；
- [ ] 用户确认 Shell、Stage、Task、Tools、Review 和 Job 结构；

### DS-W1：共享原语 POC

- 在独立 POC 中实现 `WorkflowShell`、`StageNavigation`、`ReviewSummary`、`AsyncOperationPanel`；
- 不改数据库，不改教材正式状态机；
- 对比自研原语与 Cloudscape 组件包的体积、主题冲突、测试和可维护性；
- 形成“直接使用 / 包装使用 / 保持自研”的组件决策表。

### DS-W2：教材课程迁移

- 拆分 `TextbookCoursesPage.tsx`；
- URL 化 Track/Stage/Task；
- 统一保存、错误、发布检查和后台处理体验；
- 保持「Codex Skill 外部解析，页面人工确认与学习」，不新增教材截图上传或 OCR 流程；
- 保留 TC-D0/TC-D2 的版权、人工确认、媒体和学习接入边界；
- 完成桌面 E2E、visual、API 与回归。

### DS-W3：横向扩展

- Cards Factory 接入统一异步反馈；
- Learning Plan 接入 Review Summary；
- KG unresolved 接入 Task workbench；
- Review Session 只消费焦点、通知和 Session Summary 原语，不套用 Wizard。

## 12. 验收门禁

- [x] 用户确认复杂流程四分类；
- [x] 用户确认教材作为首个样板；
- [x] 用户确认 AppLayoutToolbar 概念结构；
- [x] 用户确认 Compact Shell + Comfortable content；
- [x] 用户确认 Cloudscape 仅 POC 后决定正式依赖；
- [x] 原型覆盖导入、校对、发布检查、处理中、失败重试和完成；
- [x] 原型不含真实教材原文；
- [x] 原型在支持的 1280 和 1440 桌面视口无水平溢出、重叠和不可达操作；
- [x] 本文与 TC/LA/KG Accepted 文档无领域冲突；
- [x] 用户重申教材截图始终由 Codex Skill 解析，页面主要负责人工确认、发布和学习；
- [ ] 实施前建立状态转移表与 API/view-model contract。

## 13. 明确不做

- 不在本阶段开发移动端；
- 不恢复旧 Mission Control、Knowledge Hub、Knowledge OPS 或旧 SRS；
- 不把全站改成 Wizard；
- 不把所有信息放入卡片或嵌套卡片；
- 不让 AI 自动接受关系或发布教材；
- 不在应用内新增教材截图上传、OCR、版面解析或英日自动配对；
- 不要求用户在页面重新录入 Codex Skill 已提取的教材内容；
- 不在原型阶段修改生产数据库、API 或真实 Track；
- 不因采用 Cloudscape 参考就放弃 Three LANS 的品牌、语言和学习卡视觉。

## 14. 参考资料

- Cloudscape App layout：https://cloudscape.design/components/app-layout/
- Cloudscape Layout：https://cloudscape.design/foundation/visual-foundation/layout/
- Cloudscape Content density：https://cloudscape.design/foundation/visual-foundation/content-density/
- Cloudscape Design tokens：https://cloudscape.design/foundation/visual-foundation/design-tokens/
- Cloudscape Visual style：https://cloudscape.design/foundation/visual-foundation/visual-style/
- Cloudscape Create resource：https://cloudscape.design/patterns/resource-management/create/
- Cloudscape Progressive steps：https://cloudscape.design/patterns/genai/progressive-steps/
- Cloudscape Feedback mechanisms：https://cloudscape.design/patterns/general/user-feedback/
- Cloudscape Focus management：https://cloudscape.design/foundation/core-principles/accessibility/focus-management-principles/
- GOV.UK Check answers：https://design-system.service.gov.uk/patterns/check-answers/
- GOV.UK Complete multiple tasks：https://design-system.service.gov.uk/patterns/complete-multiple-tasks/
- GOV.UK Validation：https://design-system.service.gov.uk/patterns/validation/
- W3C Multi-page forms：https://www.w3.org/WAI/tutorials/forms/multi-page/
- W3C Validating input：https://www.w3.org/WAI/tutorials/forms/validation/
