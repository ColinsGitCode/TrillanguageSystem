# Three LANS SaaS App Shell 与复杂长流程现代化实施计划

> 状态：**In Progress · Gate 0、DS-W1 与 DS-W2 已完成，DS-W3 执行中**
>
> 日期：2026-07-23
>
> 任务规模：35 个可独立验证任务
>
> 执行方式：严格按 Gate 0 -> DS-W1 -> DS-W2 -> DS-W3 -> Final 顺序推进；每个任务独立检查、独立提交，阶段门禁失败时不得进入下一阶段

## 0. 目标、权威边界与当前主线

本计划负责把 [`SaaS_App_Shell_and_Complex_Workflow_Design_Guidelines.md`](../../Features/SaaS_App_Shell_and_Complex_Workflow_Design_Guidelines.md) 转换为可执行开发任务。它是实施方法文档，不重新定义教材课程、学习辅助 2.0 或知识图谱 2.0 的领域语义。

权威顺序：

1. 根目录 `CLAUDE.md`、实际代码、`database/schema.sql` 和现有 API；
2. TC-D0、TC-D2、LA-D0、LA-D2、KG-D0、KG-D2 Accepted 文档；
3. SaaS App Shell 与复杂长流程设计规范；
4. 本执行计划；
5. 历史静态页面和旧 UI 实施文档只作背景。

当前主线：

1. 先建立状态、URL、API 和 view-model contract；
2. 在隔离 POC 中评估 Cloudscape，不直接污染生产依赖和全局样式；
3. 以教材课程作为第一个生产迁移样板；
4. 教材验收后再横向接入 Cards Factory、Learning Plan、KG unresolved 和 Review Session；
5. 全程只做桌面端，不启动移动端设计、开发或验收。

## 1. 不可改变的产品边界

### 1.1 教材解析所有权

```text
用户提供本地教材截图与可选官方音频
  -> Codex 执行 import-textbook-track Skill
  -> Skill 在应用外完成图像理解、英日配对、中文提示、ruby、重点与置信度
  -> Skill 生成 Git 外 draft Manifest
  -> 用户明确批准后，通过正式 API 导入 draft
  -> SaaS 页面从人工确认开始
  -> 发布检查、后台处理、完成摘要与学习
```

硬约束：

- 应用页面不增加教材截图上传、OCR、版面解析或英日自动配对；
- 页面不要求用户重新录入 Skill 已提取的内容；
- 页面默认展示已预填内容，优先处理低置信度、非直译、错配风险和人工修改项；
- Skill 不直接写 SQLite，只能调用正式 use case/API；
- 未经人工确认不得 verify、publish、生成 Study Item 或进入学习队列；
- 官方整轨音频与单句 TTS 保持独立来源和独立播放所有权。

### 1.2 学习与知识图谱边界

- Study Item 仍是唯一正式调度单位；
- 不修改 FSRS 算法、评分语义或 Review Event 事实；
- KG 只提供可降级信号和人工裁决工作台，不拥有调度状态；
- 不恢复旧 Mission Control、Knowledge Hub、Knowledge OPS 或旧 SRS；
- 不因 UI 便利新增未经过 ADR 接受的领域状态。

### 1.3 Cloudscape 边界

- Cloudscape 是信息架构、密度、反馈、可访问性和组件实现的候选来源；
- DS-W1 完成前，不在根 `package.json` 引入正式生产依赖；
- 不加载 `@cloudscape-design/global-styles` 覆盖现有 Three LANS tokens；
- 不依赖 Cloudscape 私有 DOM、内部 class 或移动端响应行为；
- POC 结论必须明确为“直接使用 / 包装使用 / 保持自研”，不得默认全量迁移。

## 2. 当前实现核实

| 接缝 | 当前事实 | 本计划处理 |
|---|---|---|
| App Shell | `app/components/ProductShell.tsx` 162 行，拥有导航、主题、健康状态和侧栏折叠 | DS-W1 抽出横向反馈、Tools 和 Activity 协调能力 |
| 教材页面 | `TextbookCoursesPage.tsx` 620 行，导入、查询、发布、TTS、标红和派生卡集中在一个组件 | DS-W2 拆分为协调器和流程组件 |
| 教材样式 | `app/styles/textbooks.css` 749 行 | 按 workflow、review、media、learning context 分区 |
| 草稿修改 | TC-D2 定义 PATCH/structure，但当前 `routes/textbooks.js` 未实现 | Gate 0 增补 contract，DS-W2 实现 copy-on-write |
| 逐表达确认 | 当前只有 Track revision 级 verify，没有持久化 expression review projection | Gate 0 先通过 TC-D2 amendment |
| 后台发布/TTS | 当前 publish 与 Track TTS 是直接 mutation，没有可恢复 operation 资源 | Gate 0 先定义 operation；DS-W2 才实现 |
| 前端状态 | Track、Expression、搜索和消息主要在组件 state | DS-W2 URL 化 Track、Stage、Task 和 operation |
| 测试 | `tests/e2e/textbooks.spec.js` 已覆盖导入、verify、publish、音频、标红和派生卡 | 先冻结现状，再迁移测试 |
| 视口 | 当前正式范围是 1280/1440 桌面 | 所有门禁只验收桌面 |
| Cloudscape | 根依赖中不存在 Cloudscape | DS-W1 隔离 POC 后再决定 |

当前三个承重缺口：

1. 原型中的“6/8 已确认”目前没有真实持久化来源；
2. 原型中的字段修改目前没有 copy-on-write API；
3. 原型中的“页面关闭后后台继续、局部失败重试”目前没有教材 operation 资源。

这三项未解决前，不得把原型状态直接硬编码进生产页面。

## 3. 阶段总览与依赖

| 阶段 | 任务 | 退出条件 |
|---|---:|---|
| Gate 0 | 1-5 | 基线、Skill 边界、状态/URL/API contract 和 TC-D2 amendment 均确认 |
| DS-W1 | 6-14 | 共享原语 POC 完成，Cloudscape 采用表形成，生产依赖决策明确 |
| DS-W2 | 15-28 | 教材长流程迁移完成，Skill 外部解析边界、人工确认、发布、Job 和学习闭环全绿 |
| DS-W3 | 29-34 | 横向能力按领域差异接入，不把全站改成同一种 Wizard |
| Final | 35 | 全容器、桌面 E2E/visual、API、回滚和文档封板通过 |

依赖关系：

```text
Task 1-3
  -> Task 4 TC-D2 amendment
  -> Task 5 Gate 0
  -> Task 6-14 DS-W1 POC
  -> Task 15-28 教材迁移
  -> Task 29-34 横向扩展
  -> Task 35 最终验收
```

## 4. 通用执行约定

- 每个任务开始前执行 `git status --short`；
- 不覆盖或夹带用户未提交变更；
- 手工编辑使用 `apply_patch`；
- 每个任务先固定失败测试或 contract，再修改实现；
- 提交时显式列出文件，不使用 `git add -A`；
- 每个任务必须包含目标、文件、步骤、测试、验收与建议提交；
- schema 变更必须同时更新 `database/schema.sql` 和顺延 migration；
- CommonJS 后端与 TypeScript/ESM 前端边界不得隐式混写；
- 前端只通过公开 API 和 view-model 读取状态，不查询 SQLite；
- 页面不保存宿主机绝对路径、教材原文日志或密钥；
- visual 只更新已批准变化，不批量接受未知差异；
- 不运行、不新增移动端视觉基线；
- 阶段结束必须提交独立验收记录，再进入下一阶段。

---

## Gate 0：现状基线与领域 contract

### Task 1：冻结当前桌面行为与视觉基线

**目标**：在改动 Shell 和教材页面前，记录真实可回归行为。

**文件**：

- Modify: `tests/e2e/textbooks.spec.js`
- Modify: `tests/e2e/app-shell.spec.js`
- Modify: `tests/e2e/ui-quality-regression.spec.js`
- Modify: `tests/e2e/ui-visual-regression.spec.js`
- Update: 对应 Playwright desktop snapshots
- Create: `Docs/TestReports/SaaS_Workflow_Gate0_Baseline_20260723.md`

**步骤**：

- [ ] 记录 1280x800 与 1440x900 教材空态、draft、verified、published 状态；
- [ ] 固定现有导入、verify、publish、TTS、标红、派生卡和互斥播放行为；
- [ ] 固定 ProductShell 展开/折叠、主题、健康轮询和键盘焦点；
- [ ] 记录当前 `TextbookCoursesPage.tsx`、`ProductShell.tsx` 和 CSS 行数；
- [ ] 对动态时间、job id 和 hash 使用最小 mask；
- [ ] 不新增移动端截图。

**测试**：

```bash
npx playwright test tests/e2e/textbooks.spec.js tests/e2e/app-shell.spec.js
npx playwright test tests/e2e/ui-quality-regression.spec.js tests/e2e/ui-visual-regression.spec.js
```

**验收**：

- 两次连续运行视觉结果一致；
- 报告区分“当前行为”“设计目标”和“已知缺口”；
- 不把当前缺失的逐表达确认或后台 operation 误报为已实现。

**建议提交**：`test(ui): freeze SaaS workflow desktop baselines`

### Task 2：建立 Skill 外部解析回归守卫

**目标**：用自动化测试防止未来把教材解析迁入页面。

**文件**：

- Modify: `tests/e2e/textbooks.spec.js`
- Modify: `tests/e2e/fixtures/textbookFixture.js`
- Create: `tests/unit/textbookSkillBoundary.test.js`
- Reuse: `skills/import-textbook-track/SKILL.md`
- Reuse: `Docs/Features/Textbook_Courses_Product_Definition.md`

**步骤**：

- [ ] 断言教材页面不存在截图文件输入、OCR 按钮或自动配对入口；
- [ ] 断言空态引导用户通过 Codex Skill 创建 Track；
- [ ] 断言 intake 只接受或展示 Git 外 Manifest 身份/hash；
- [ ] 断言 fixture 的 `import.skillName` 为 `import-textbook-track`；
- [ ] 断言 imported draft 已包含 EN/JA/ZH/ruby/confidence；
- [ ] 断言未经 verify 不创建 generation、Study Item 或 Review Event。

**测试**：

```bash
node --test tests/unit/textbookSkillBoundary.test.js
npx playwright test tests/e2e/textbooks.spec.js
```

**验收**：

- 页面责任固定为“接收、确认、发布、学习”；
- Skill 责任固定为“截图理解与结构化”；
- 测试不得依赖真实教材原文或真实本地绝对路径。

**建议提交**：`test(textbooks): guard Skill-owned textbook extraction`

### Task 3：建立状态转移、URL 与 view-model contract

**目标**：在写组件前确定页面状态来源，避免 UI 自己发明业务状态。

**文件**：

- Create: `Docs/Architecture/SaaS_Workflow_State_URL_and_View_Model_Contract.md`
- Modify: `Docs/Features/SaaS_App_Shell_and_Complex_Workflow_Design_Guidelines.md`
- Reference: `Docs/Architecture/Textbook_Courses_Domain_Data_and_Media_ADR.md`
- Reference: `app/features/textbooks/types.ts`

**步骤**：

- [ ] 定义 Stage：`intake / review / release / processing / complete`；
- [ ] 定义 URL：`/textbooks?track=<id>&stage=<stage>&task=<expressionRevisionId>&operation=<id>`；
- [ ] 只把 ID、Stage、筛选和选中项放 URL，不放教材原文；
- [ ] 定义非法或过期参数的归一化和回退规则；
- [ ] 定义 Track/revision/review/operation 到 Stage 的映射；
- [ ] 明确 intake 对已导入 Track 默认完成，页面首次进入 review；
- [ ] 定义浏览器后退、刷新、深链接和离开保护；
- [ ] 定义 `TextbookWorkflowViewModel` 的字段、来源和可执行命令；
- [ ] 把原型中的演示状态与真实 contract 对照。

**测试/审查**：

- 文档逐项对照实际路由、TC-D2 和 prototype；
- 所有 Stage 状态必须可由数据库/API 派生；
- 不允许 `6 / 8` 这类数字来自前端常量。

**验收**：

- 每个 UI 状态有唯一服务端或 URL 来源；
- 每个主按钮对应一个明确 API 命令；
- URL 不泄露教材文本或宿主机路径。

**建议提交**：`docs(ui): define workflow state URL and view-model contract`

### Task 4：接受 TC-D2 的 SaaS workflow amendment

**目标**：补齐逐表达确认、copy-on-write 修改和可恢复 operation 的领域依据。

**文件**：

- Modify: `Docs/Architecture/Textbook_Courses_Domain_Data_and_Media_ADR.md`
- Modify: `Docs/Features/Textbook_Courses_Product_Definition.md`
- Modify: `Docs/README.md`

**必须决策**：

- [ ] 是否新增 `textbook_expression_review_states` 作为可重建/可更新确认投影；
- [ ] review 状态是否固定为 `pending / needs_attention / confirmed`；
- [ ] 如何记录 reviewer、confirmed time、revision 和原因，但不复制正文；
- [ ] copy-on-write PATCH 如何生成新的 Track revision；
- [ ] 旧 review state 如何在新 revision 中继承或失效；
- [ ] 是否新增 `textbook_operations` 与 `textbook_operation_events`；
- [ ] operation kind、状态、幂等键、payload hash、step 和结果 contract；
- [ ] publish 成功、TTS 局部失败时如何保持已提交事实；
- [ ] restart recovery、局部 retry 和取消边界；
- [ ] operation 日志不得包含教材原文。

**门禁**：

- amendment 必须经用户明确确认；
- 未确认前不得创建 migration 006；
- 不得复用 `generation_jobs` 冒充教材发布/TTS operation；
- 不得让 UI localStorage 成为正式确认状态。

**验收**：

- 原型中的逐表达确认和后台 Job 均有真实领域来源；
- 仍保持 Track revision 与 expression revision 不可变；
- verify/publish/Study Item 事务边界不被削弱。

**建议提交**：`docs(textbooks): accept SaaS workflow domain amendment`

### Task 5：通过 Gate 0 contract 与测试门禁

**目标**：确认进入组件 POC 时不会携带领域歧义。

**文件**：

- Modify: `Docs/superpowers/plans/2026-07-23-saas-workflow-modernization.md`
- Update: `Docs/TestReports/SaaS_Workflow_Gate0_Baseline_20260723.md`

**检查**：

- [ ] Task 1 基线重复通过；
- [ ] Task 2 Skill 边界测试通过；
- [ ] Task 3 状态/URL/view-model contract 已确认；
- [ ] Task 4 TC-D2 amendment 已 Accepted；
- [ ] 生产页面、schema 和 API 尚未因 POC 改动；
- [ ] 工作树只含 Gate 0 范围变更。

**测试**：

```bash
npm run lint
npm run test:unit
npm run test:integration
npm run typecheck:react
npx playwright test tests/e2e/app-shell.spec.js tests/e2e/textbooks.spec.js
```

**验收**：上述命令全绿后，才进入 DS-W1。

**建议提交**：`docs(ui): close SaaS workflow Gate 0`

---

## DS-W1：共享 Workflow 原语与 Cloudscape POC

### Task 6：建立隔离的 Cloudscape POC Harness

**目标**：评估 Cloudscape 而不直接污染生产依赖和全局样式。

**文件**：

- Create: `experiments/cloudscape-workflow/package.json`
- Create: `experiments/cloudscape-workflow/src/*`
- Create: `experiments/cloudscape-workflow/README.md`
- Create: `scripts/tests/cloudscapeWorkflowPoc.mjs`
- Modify: `.gitignore`（仅忽略 POC build/node_modules）

**步骤**：

- [ ] 独立安装并锁定待评估 Cloudscape 版本；
- [ ] 不修改根 `package.json`；
- [ ] 创建包含 AppLayout、Wizard、SideNavigation、Flashbar、Progressive Steps 的最小场景；
- [ ] 创建同场景的 Three LANS 自研原语版本；
- [ ] 禁止加载 Cloudscape global styles 到主应用；
- [ ] 输出构建体积、CSS 数量、运行时依赖和 license 清单。

**测试**：

```bash
npm --prefix experiments/cloudscape-workflow install
npm --prefix experiments/cloudscape-workflow run build
node scripts/tests/cloudscapeWorkflowPoc.mjs
```

**验收**：

- POC 能独立删除，不影响主应用；
- 不产生生产路由；
- 不访问真实数据库或教材。

**建议提交**：`chore(ui): add isolated Cloudscape workflow POC`

### Task 7：完成 Foundation、token 与视觉兼容评估

**目标**：确定哪些 Cloudscape 视觉规则可吸收，哪些会破坏 Three LANS。

**文件**：

- Create: `Docs/TestReports/Cloudscape_Workflow_POC_Assessment_20260723.md`
- Modify: `experiments/cloudscape-workflow/src/*`
- Reference: `app/styles/tokens.css`
- Reference: `app/styles/factory.css`

**步骤**：

- [ ] 对比布局密度、surface、border、focus、status、spacing 和 typography；
- [ ] 验证 Open Sans/global styles 是否覆盖现有字体与 tokens；
- [ ] 测量 1280/1440 桌面布局；
- [ ] 验证 dark theme 与 reduced motion；
- [ ] 记录 Cloudscape responsive 行为，但不纳入移动端验收；
- [ ] 建立 token 映射表和禁止映射清单；
- [ ] 记录组件包、CSS 和 gzip 体积差异。

**验收**：

- 报告给出每个候选组件的收益、代价和主题冲突；
- 不以“看起来像 AWS Console”作为采用理由；
- Three LANS 品牌、语言色、卡型色和阅读区保持独立。

**建议提交**：`docs(ui): assess Cloudscape foundation compatibility`

### Task 8：建立 Workflow 类型与状态原语

**目标**：先统一契约，再实现视觉组件。

**文件**：

- Create: `app/components/workflow/workflow-types.ts`
- Create: `app/components/workflow/workflow-state.ts`
- Create: `app/components/workflow/index.ts`
- Create: `app/routes/workflow-poc.tsx`
- Modify: `app/routes.ts`
- Modify: `lib/httpRuntime.js`
- Modify: `scripts/tests/startE2EServer.sh`
- Create: `tests/e2e/workflow-primitives.spec.js`

**步骤**：

- [ ] 定义 `WorkflowStage`、`WorkflowTask`、`WorkflowCommand`；
- [ ] 定义 save 状态、operation 状态和 error summary；
- [ ] 定义 Stage 可达性与跳转原因；
- [ ] 定义领域数据与 UI 派生数据边界；
- [ ] 禁止 reducer 直接调用 API；
- [ ] 禁止组件根据文案猜状态。
- [ ] 仅在 `WORKFLOW_POC_ENABLED=1` 时把 `/workflow-poc` 交给 React Router；
- [ ] 非 POC 环境访问 `/workflow-poc` 必须保持 404；
- [ ] POC route 只消费合成数据，不访问业务 API。

**测试**：

- `npm run typecheck:react`；
- POC 页面用合成数据覆盖所有 union 分支；
- 深链接恢复后状态一致。

**验收**：新增领域可通过 adapter 接入，不修改共享 union 的业务语义。

**建议提交**：`feat(ui): add typed workflow state primitives`

### Task 9：实现 WorkflowShell 与 StageNavigation

**目标**：实现复杂流程的稳定外壳和阶段定位。

**文件**：

- Create: `app/components/workflow/WorkflowShell.tsx`
- Create: `app/components/workflow/StageNavigation.tsx`
- Create: `app/styles/workflow.css`
- Modify: `app/root.tsx`
- Modify: `tests/e2e/workflow-primitives.spec.js`

**步骤**：

- [ ] 支持 breadcrumb、对象身份、save 状态和退出动作；
- [ ] 支持 compact Stage 导航、完成/当前/锁定/失败；
- [ ] Stage 点击只触发外部 callback，不拥有领域命令；
- [ ] 切换 Stage 后 H1 接收焦点；
- [ ] 保证 1280 和 1440 无水平溢出；
- [ ] 不实现移动抽屉。

**测试**：

```bash
npm run typecheck:react
npx playwright test tests/e2e/workflow-primitives.spec.js
```

**验收**：键盘可完整操作，状态不只靠颜色表达。

**建议提交**：`feat(ui): add workflow shell and stage navigation`

### Task 10：实现 TaskWorkbench 与 ContextTools

**目标**：支持异常优先的任务列表、详情和上下文工具。

**文件**：

- Create: `app/components/workflow/TaskWorkbench.tsx`
- Create: `app/components/workflow/TaskRail.tsx`
- Create: `app/components/workflow/ContextTools.tsx`
- Modify: `app/styles/workflow.css`
- Modify: `tests/e2e/workflow-primitives.spec.js`

**步骤**：

- [ ] 支持全部、待确认、低置信度、已确认筛选；
- [ ] 支持当前 Task 深链接和焦点恢复；
- [ ] 支持 Task 删除/确认后移动到下一项；
- [ ] Tools 显示来源、确定性检查、活动和技术详情；
- [ ] 默认密度适合桌面扫描，详情区保持舒适阅读；
- [ ] 不使用卡片嵌套卡片。

**验收**：

- 任务列表可独立滚动；
- 详情区和 Tools 不相互遮挡；
- 任务内容来自 adapter，不写死教材字段。

**建议提交**：`feat(ui): add task workbench and context tools`

### Task 11：实现 SaveStatus、ErrorSummary 与离开保护

**目标**：统一草稿保存、错误定位和恢复体验。

**文件**：

- Create: `app/components/workflow/SaveStatus.tsx`
- Create: `app/components/workflow/ErrorSummary.tsx`
- Create: `app/components/workflow/useLeaveGuard.ts`
- Modify: `app/styles/workflow.css`
- Modify: `tests/e2e/workflow-primitives.spec.js`

**步骤**：

- [ ] 支持 `clean / dirty / saving / saved / failed / conflict`；
- [ ] 保存失败保留用户输入；
- [ ] Error Summary 聚焦并跳转字段；
- [ ] revision conflict 提供刷新和比较入口；
- [ ] route、关闭标签页和浏览器返回均有未保存保护；
- [ ] 成功保存后不抢夺当前输入焦点。

**验收**：

- 修改、保存、失败、重试、冲突和离开均有 E2E；
- 不依赖 `window.alert` 实现正式交互。

**建议提交**：`feat(ui): add workflow save and error recovery`

### Task 12：实现 ReviewSummary

**目标**：为不可忽略的领域命令提供统一确认结构。

**文件**：

- Create: `app/components/workflow/ReviewSummary.tsx`
- Modify: `app/styles/workflow.css`
- Modify: `tests/e2e/workflow-primitives.spec.js`

**步骤**：

- [ ] 显示范围、数量、diff、警告、来源和不可逆影响；
- [ ] 支持 Change link 返回对应 Stage/Task；
- [ ] 主按钮文案包含具体动作和数量；
- [ ] Review 只展示服务端 preview，不自行重算；
- [ ] preview revision 变化时阻止执行。

**验收**：合成教材发布和学习计划缩小范围两种场景均通过。

**建议提交**：`feat(ui): add reusable review summary`

### Task 13：实现 AsyncOperationPanel 与 ActivityLog

**目标**：统一后台执行、局部失败、重试与审计反馈。

**文件**：

- Create: `app/components/workflow/AsyncOperationPanel.tsx`
- Create: `app/components/workflow/ActivityLog.tsx`
- Modify: `app/styles/workflow.css`
- Modify: `tests/e2e/workflow-primitives.spec.js`

**步骤**：

- [ ] 支持 queued/running/succeeded/partially_failed/failed/cancelled；
- [ ] 显示 step 状态、公开错误码和可重试性；
- [ ] 只重试失败 step，不重复成功写入；
- [ ] 页面重载后通过 operation id 恢复；
- [ ] Activity 只展示公开摘要；
- [ ] `aria-live=polite` 宣告完成，不主动抢焦点。

**验收**：重试和刷新不会创建重复 operation 或重复领域事实。

**建议提交**：`feat(ui): add async operation and activity primitives`

### Task 14：完成 DS-W1 采用决策与清理

**目标**：形成明确组件采用表，禁止 POC 无限留存。

**文件**：

- Update: `Docs/TestReports/Cloudscape_Workflow_POC_Assessment_20260723.md`
- Modify: 根 `package.json` / `package-lock.json`（仅当决定正式采用）
- Delete or Archive: `experiments/cloudscape-workflow/`
- Delete: `app/routes/workflow-poc.tsx`
- Modify: `app/routes.ts`
- Modify: `lib/httpRuntime.js`
- Modify: `scripts/tests/startE2EServer.sh`
- Modify: `Docs/Features/SaaS_App_Shell_and_Complex_Workflow_Design_Guidelines.md`
- Modify: `Docs/superpowers/plans/2026-07-23-saas-workflow-modernization.md`

**步骤**：

- [ ] 对 AppLayout、SideNavigation、Flashbar、Wizard、Progressive Steps 逐项裁决；
- [ ] 标注“直接使用 / 包装使用 / 保持自研”；
- [ ] 若采用，固定版本、license、单组件 import 和测试工具；
- [ ] 若拒绝，从根依赖和构建中彻底移除；
- [ ] 删除临时 `/workflow-poc` route，并增加生产 404 回归；
- [ ] 运行 bundle 前后对比；
- [ ] 用户确认采用表。

**门禁**：未完成采用表，不进入 DS-W2。

**验收**：

- 采用表由用户确认；
- 主应用最终依赖与采用表一致；
- 临时 POC route 在生产保持 404；
- DS-W1 共享原语通过 typecheck 和桌面 E2E。

**建议提交**：`docs(ui): close workflow primitives POC`

---

## DS-W2：教材课程生产迁移

> 完成状态：Task 15-28 已于 2026-07-23 实施并通过 [`SaaS_Textbook_Workflow_DS_W2_Acceptance_20260723.md`](../../TestReports/SaaS_Textbook_Workflow_DS_W2_Acceptance_20260723.md)。以下清单保留为实施规格；最终证据为 unit 347/347、integration 63/63、smoke 7/7、desktop E2E/visual 38/38。

| Task | 状态 |
|---|---|
| 15 workflow schema 与 migration 006 | [x] |
| 16 copy-on-write 与 review projection | [x] |
| 17 可恢复 TextbookOperationService | [x] |
| 18 workflow/review/operation API | [x] |
| 19 前端 types/API/adapter | [x] |
| 20 URL 工作上下文 | [x] |
| 21 页面协调器与组件拆分 | [x] |
| 22 Skill 正式 handoff | [x] |
| 23 异常优先人工确认 | [x] |
| 24 草稿保存与冲突恢复 | [x] |
| 25 发布 Review Summary | [x] |
| 26 后台处理、重试与完成摘要 | [x] |
| 27 媒体、标红、派生卡与学习入口 | [x] |
| 28 DS-W2 门禁 | [x] |

### Task 15：新增 workflow schema 与 migration 006

**依赖**：Task 4 Accepted。

**文件**：

- Create: `database/migrations/006_textbook_workflow.sql`
- Modify: `database/schema.sql`
- Modify: `services/storage/db/migrationRunner.js`
- Modify: `services/storage/db/testReset.js`
- Modify: `tests/unit/migrationRunner.test.js`
- Modify: `tests/unit/databaseService.test.js`

**步骤**：

- [ ] 按 Accepted amendment 创建 review projection；
- [ ] 创建 textbook operation 与 append-only event 表；
- [ ] 增加 status、revision、idempotency 和 FK/CHECK；
- [ ] 建立运行中唯一约束和查询索引；
- [ ] 新安装与存量迁移结果一致；
- [ ] test reset 正确清理测试数据；
- [ ] 不修改既有 expression revision 不可变 trigger。

**测试**：

```bash
node --test tests/unit/migrationRunner.test.js tests/unit/databaseService.test.js
```

**验收**：schema 与 migration 无漂移，重复执行幂等。

**建议提交**：`feat(textbooks): add workflow persistence schema`

### Task 16：实现 copy-on-write 草稿与 review projection

**文件**：

- Create: `services/storage/db/textbookWorkflow.js`
- Modify: `services/storage/db/textbooks.js`
- Modify: `services/storage/databaseService.js`
- Create: `tests/unit/textbookWorkflowStorage.test.js`

**步骤**：

- [ ] 读取 revision、expression、review state 和 completion；
- [ ] PATCH 单表达时复制未变内容并创建新 Track revision；
- [ ] 重算 per-direction hash 和 Track content hash；
- [ ] 继承未变 expression 的确认状态；
- [ ] 修改过的 expression 回到 pending/needs_attention；
- [ ] expected revision 不匹配返回稳定冲突；
- [ ] 全部写入在单事务中完成；
- [ ] 禁止原地 UPDATE expression revision。

**验收**：

- 修改一条 ruby 只影响对应 JA unit hash；
- 修改中文 cue 只影响同表达 EN/JA；
- 失败事务不留下孤立 current/pending 指针。

**建议提交**：`feat(textbooks): add copy-on-write review storage`

### Task 17：实现可恢复 TextbookOperationService

**文件**：

- Create: `services/textbooks/textbookOperationService.js`
- Create: `services/textbooks/textbookOperationExecutor.js`
- Modify: `lib/httpRuntime.js`
- Modify: `lib/gracefulShutdown.js`（如接口需要）
- Create: `tests/unit/textbookOperationService.test.js`

**步骤**：

- [ ] enqueue、claim、append event、finish 和 retry；
- [ ] operation payload 使用 hash 和 ID，不复制教材正文；
- [ ] publish/TTS/sync step 保持幂等；
- [ ] 服务启动时恢复 stale running；
- [ ] shutdown 等待当前 step 或安全释放；
- [ ] 局部失败只重试失败 step；
- [ ] 已成功 publish 不因 TTS 失败回滚。

**验收**：

- restart 后可恢复；
- 相同 idempotency key + 相同 payload 返回同一 operation；
- 相同 key + 不同 payload 返回 409。

**建议提交**：`feat(textbooks): add resumable textbook operations`

### Task 18：实现 workflow、draft、review 与 operation API

**文件**：

- Modify: `routes/textbooks.js`
- Create: `services/textbooks/textbookWorkflowService.js`
- Modify: `lib/httpRuntime.js`（仅挂载/worker lifecycle）
- Modify: `tests/integration/textbooks.test.js`

**端点**：

```text
GET   /api/textbooks/tracks/:id/workflow
GET   /api/textbooks/revisions/:id
PATCH /api/textbooks/revisions/:id
PUT   /api/textbooks/revisions/:id/expressions/:expressionId/review
POST  /api/textbooks/tracks/:id/operations
GET   /api/textbooks/operations/:id
GET   /api/textbooks/operations/:id/events
POST  /api/textbooks/operations/:id/retry
```

**步骤**：

- [ ] workflow endpoint 返回服务端 view-model；
- [ ] PATCH 必须携带 expected revision；
- [ ] review 命令必须携带 expression revision；
- [ ] operation 创建必须携带 idempotency key 和 preview revision；
- [ ] 统一 stable error codes；
- [ ] 日志只记录 ID、计数、hash 前缀和 error code；
- [ ] API-only harness 全覆盖。

**验收**：

- 未确认表达时 verify/release 被阻止；
- retry 不重复 publish、Study Item 或音频事实；
- 无任何教材 OCR 端点。

**建议提交**：`feat(textbooks): expose workflow and operation APIs`

### Task 19：扩展前端 types、API 与 adapter

**文件**：

- Modify: `app/features/textbooks/types.ts`
- Modify: `app/features/textbooks/textbook-api.ts`
- Create: `app/features/textbooks/textbook-workflow-adapter.ts`
- Modify: `tests/e2e/textbooks.spec.js`

**步骤**：

- [ ] 定义 workflow/review/operation API 类型；
- [ ] adapter 把服务端 view-model 转成共享 Workflow 类型；
- [ ] 不在组件内解析 raw JSON；
- [ ] ApiError 映射 revision conflict、operation failure 和 review incomplete；
- [ ] query key 包含 Track/revision/operation；
- [ ] mutation 后只失效必要 query。

**验收**：`TextbookCoursesPage` 不再自行推断 Stage、确认数量或 operation 状态。

**建议提交**：`refactor(textbooks): add typed workflow API adapter`

### Task 20：实现 Track、Stage、Task 与 operation URL 状态

**文件**：

- Create: `app/features/textbooks/useTextbookWorkflowRoute.ts`
- Modify: `app/features/textbooks/TextbookCoursesPage.tsx`
- Modify: `app/routes/textbooks.tsx`
- Modify: `tests/e2e/textbooks.spec.js`

**步骤**：

- [ ] 解析并规范化 track/stage/task/operation；
- [ ] 选择 Track/Task 时 replace 或 push 符合 contract；
- [ ] 刷新恢复当前上下文；
- [ ] 后退/前进恢复 Stage 与 Task；
- [ ] 过期 Task 回退到首个待确认项；
- [ ] URL 不包含原文、路径或 hash。

**验收**：复制 URL 到新标签页能恢复相同工作上下文。

**建议提交**：`feat(textbooks): persist workflow context in URL`

### Task 21：拆分 TextbookCoursesPage 协调器

**文件**：

- Modify: `app/features/textbooks/TextbookCoursesPage.tsx`
- Create: `app/features/textbooks/components/TextbookWorkflowHeader.tsx`
- Create: `app/features/textbooks/components/TextbookTrackRail.tsx`
- Create: `app/features/textbooks/components/TextbookReviewWorkbench.tsx`
- Create: `app/features/textbooks/components/TextbookContextTools.tsx`
- Create: `app/features/textbooks/components/TextbookReleaseReview.tsx`
- Create: `app/features/textbooks/components/TextbookProcessingView.tsx`
- Create: `app/features/textbooks/components/TextbookCompletionSummary.tsx`
- Modify: `app/styles/textbooks.css`

**步骤**：

- [ ] 页面只协调 query/mutation/route，不渲染所有细节；
- [ ] 复用 DS-W1 共享原语；
- [ ] 各组件通过显式 props 接收领域命令；
- [ ] 现有 OfficialAudio、highlight 和 selection 行为不丢失；
- [ ] 去除重复消息、重复标题和不必要 surface；
- [ ] 保持 desktop-only。

**验收**：

- `TextbookCoursesPage.tsx` 目标不超过约 250 行；
- 不通过 Context 隐藏领域写入；
- typecheck 和原有教材 E2E 通过。

**建议提交**：`refactor(textbooks): split workflow page components`

### Task 22：建立 Codex Skill 到页面的正式 handoff

**目标**：让用户主要从人工确认开始，而不是手工重复录入 Manifest 技术字段。

**文件**：

- Modify: `skills/import-textbook-track/SKILL.md`
- Modify: `skills/import-textbook-track/agents/openai.yaml`（如存在且需更新）
- Modify: `app/features/textbooks/TextbookCoursesPage.tsx`
- Modify: `app/features/textbooks/components/TextbookWorkflowHeader.tsx`
- Modify: `tests/unit/textbookSkillBoundary.test.js`
- Modify: `tests/e2e/textbooks.spec.js`

**步骤**：

- [ ] Skill 保持 dry-run 后停下并请求用户确认；
- [ ] 用户确认后，Skill 通过正式 import API 创建 draft；
- [ ] Skill 返回 Track ID 和 `/textbooks?track=<id>&stage=review`；
- [ ] 页面正常入口不要求用户粘贴截图、绝对路径或 OCR 结果；
- [ ] 技术 Manifest intake 仅保留为受控高级入口或操作详情；
- [ ] 无 Track 空态明确提示在 Codex 中运行 Skill；
- [ ] 页面首屏显示“Skill 已完成解析，本页负责人审与学习”。

**验收**：

- 新 Track 主流程不需要在页面重做解析；
- Skill 仍不直接访问 SQLite；
- 导入前仍有明确用户确认。

**建议提交**：`feat(textbooks): connect Skill draft handoff to review`

### Task 23：实现异常优先的人工确认工作台

**文件**：

- Modify: `app/features/textbooks/components/TextbookReviewWorkbench.tsx`
- Modify: `app/features/textbooks/components/TextbookContextTools.tsx`
- Modify: `app/styles/textbooks.css`
- Modify: `tests/e2e/textbooks.spec.js`

**步骤**：

- [ ] 默认优先显示 low-confidence、non-literal、missing ruby、pairing warning；
- [ ] 支持全部、待确认、需注意、已确认筛选；
- [ ] 列表显示序号、EN/JA 摘要和状态；
- [ ] 详情预填 EN/JA/ZH/ruby/phrases/grammar；
- [ ] official-source 与 AI-derived/user-edited 有明显来源标识；
- [ ] Context Tools 显示 source span、hash、provenance 和确定性检查；
- [ ] 不把每条表达做成独立 Wizard。

**验收**：

- 用户可只处理异常项再检查全部；
- 任务状态来自 API，不来自本地常量；
- 1280/1440 无溢出。

**建议提交**：`feat(textbooks): add exception-first human review workbench`

### Task 24：实现草稿保存、冲突恢复与逐表达确认

**文件**：

- Modify: `app/features/textbooks/components/TextbookReviewWorkbench.tsx`
- Modify: `app/features/textbooks/TextbookCoursesPage.tsx`
- Modify: `app/features/textbooks/textbook-api.ts`
- Modify: `tests/e2e/textbooks.spec.js`
- Modify: `tests/integration/textbooks.test.js`

**步骤**：

- [ ] 用户修改产生 dirty 状态；
- [ ] 保存调用 copy-on-write PATCH 并接收新 revision；
- [ ] 保存成功更新 URL/query，不丢当前 Task；
- [ ] 409 conflict 显示 Error Summary 和重新载入；
- [ ] 确认操作绑定准确 expression revision；
- [ ] 修改已确认表达后自动回到 needs_attention；
- [ ] 离开保护覆盖路由和标签关闭。

**验收**：

- 不原地修改 immutable expression revision；
- 保存失败不丢输入；
- `confirmed / total` 从服务端 projection 读取。

**建议提交**：`feat(textbooks): add durable draft review and conflict recovery`

### Task 25：实现发布 Review Summary 与精确命令

**文件**：

- Modify: `app/features/textbooks/components/TextbookReleaseReview.tsx`
- Modify: `app/features/textbooks/TextbookCoursesPage.tsx`
- Modify: `app/features/textbooks/textbook-api.ts`
- Modify: `tests/e2e/textbooks.spec.js`

**步骤**：

- [ ] 使用服务端 publish preview；
- [ ] 展示表达数、Study Item 数、官方音频、缺失 TTS 和计划影响；
- [ ] 未确认表达阻止发布并链接回对应 Task；
- [ ] 主动作写“发布 N 条表达”；
- [ ] 携带 expected track/plan/review revision；
- [ ] preview 过期时阻止提交并刷新。

**验收**：Review Summary 与最终 operation 执行范围逐项一致。

**建议提交**：`feat(textbooks): add release review summary`

### Task 26：实现后台处理、局部重试和完成摘要

**文件**：

- Modify: `app/features/textbooks/components/TextbookProcessingView.tsx`
- Modify: `app/features/textbooks/components/TextbookCompletionSummary.tsx`
- Modify: `app/features/textbooks/TextbookCoursesPage.tsx`
- Modify: `tests/e2e/textbooks.spec.js`
- Modify: `tests/integration/textbooks.test.js`

**步骤**：

- [ ] 发布命令返回 operation ID；
- [ ] 轮询 operation，页面关闭后服务端继续；
- [ ] 显示 publish/materialize/TTS/sync step；
- [ ] TTS 局部失败只重试失败 step；
- [ ] 成功 step 不重复执行；
- [ ] 完成摘要显示 published expressions、Study Items、TTS 和 official Track；
- [ ] 失败后仍可返回教材浏览和已成功内容。

**验收**：

- 刷新 processing URL 可恢复；
- retry 不产生重复 Study Item、Review Event 或 generation；
- 控制台无错误。

**建议提交**：`feat(textbooks): add resumable release processing`

### Task 27：恢复媒体、标红、派生卡和学习入口

**文件**：

- Modify: `app/features/textbooks/components/TextbookContextTools.tsx`
- Modify: `app/features/textbooks/components/TextbookCompletionSummary.tsx`
- Modify: `app/features/textbooks/TextbookCoursesPage.tsx`
- Modify: `app/features/learning/LearningPlanPage.tsx`
- Modify: `tests/e2e/textbooks.spec.js`
- Modify: `tests/e2e/learning-assistance.spec.js`

**步骤**：

- [ ] 官方 Track 播放器在 review/learning context 可用；
- [ ] 单句 EN/JA TTS 与官方 Track 互斥；
- [ ] 已发布内容保留选区标红；
- [ ] 派生三语卡/语法卡继续使用规范化去重关系；
- [ ] 完成页链接到教材浏览和学习计划；
- [ ] `/learn/plan?textbookTrack=<id>` 可预选该 Track，但不自动保存；
- [ ] daily new limit 仍由学习计划控制。

**验收**：

- TC-P4 既有媒体、标红和派生卡回归通过；
- 页面没有第二套学习调度逻辑。

**建议提交**：`feat(textbooks): reconnect learning and study tools`

### Task 28：通过 DS-W2 教材迁移门禁

**文件**：

- Update: `tests/e2e/textbooks.spec.js`
- Update: `tests/e2e/ui-visual-regression.spec.js`
- Update: desktop snapshots
- Create: `Docs/TestReports/SaaS_Textbook_Workflow_DS_W2_Acceptance_20260723.md`
- Modify: `Docs/Features/Textbook_Courses_Product_Definition.md`
- Modify: `Docs/Architecture/Textbook_Courses_Domain_Data_and_Media_ADR.md`
- Modify: `Docs/README.md`

**测试**：

```bash
npm run lint
npm run typecheck:react
npm run test:unit
npm run test:integration
npm run build:react
npx playwright test tests/e2e/app-shell.spec.js tests/e2e/textbooks.spec.js tests/e2e/learning-assistance.spec.js
npx playwright test tests/e2e/ui-quality-regression.spec.js tests/e2e/ui-visual-regression.spec.js
npm run test:textbooks:acceptance
```

**验收**：

- Skill 外部解析边界有自动化守卫；
- 1280/1440 桌面主流程全绿；
- review/release/processing/complete 可深链接恢复；
- 真实 Track 不进入截图、fixture 或日志；
- 旧 `/textbooks` 功能无行为回归；
- 通过后才进入 DS-W3。

**建议提交**：`docs(textbooks): accept SaaS workflow migration`

---

## DS-W3：横向扩展

### Task 29：扩展 ProductShell 的横向反馈与 Activity

**文件**：

- Modify: `app/components/ProductShell.tsx`
- Create: `app/components/shell/GlobalFeedback.tsx`
- Create: `app/components/shell/ActivityDrawer.tsx`
- Create: `app/components/shell/ShellTools.tsx`
- Modify: `app/styles/factory.css`
- Modify: `tests/e2e/app-shell.spec.js`

**步骤**：

- [ ] Shell 统一承载 Flash、Activity 和右侧 Tools；
- [ ] 页面通过 typed command 发布反馈，不直接操纵 DOM；
- [ ] 全局反馈不重复领域审计；
- [ ] Activity 可恢复 Card generation 和 textbook operation；
- [ ] 关闭后焦点返回触发按钮；
- [ ] health 仍保持单一 query owner。

**验收**：Shell 不拥有教材发布、Learning 或 KG 领域状态。

**建议提交**：`feat(shell): add global feedback and activity tools`

### Task 30：Cards Factory 接入统一异步反馈

**文件**：

- Modify: `app/features/factory/CardsFactory.tsx`
- Modify: `app/features/factory/QueuePanel.tsx`
- Modify: `app/features/factory/factory-api.ts`
- Modify: `tests/e2e/react-cards-factory.spec.js`

**步骤**：

- [ ] 创建生成任务后向 Shell Activity 登记；
- [ ] 失败、重试、取消和成功使用统一 feedback；
- [ ] 队列详情可复用 AsyncOperationPanel 的展示层；
- [ ] 仍使用 generation_jobs 领域，不迁入 textbook operation；
- [ ] centered dialog 的既有关闭行为保持。

**验收**：卡片生成不增加 Wizard，既有队列 API 不变。

**建议提交**：`refactor(factory): unify asynchronous job feedback`

### Task 31：Learning Plan 接入 ReviewSummary

**文件**：

- Modify: `app/features/learning/LearningPlanPage.tsx`
- Modify: `app/features/learning/learning-api.ts`
- Modify: `tests/e2e/learning-assistance.spec.js`

**步骤**：

- [ ] 保持单页配置，不改造成多页 Wizard；
- [ ] 保存前展示范围、Study Item 数、预计天数和移出数量；
- [ ] Change link 返回对应 fieldset；
- [ ] preview revision 变化阻止保存；
- [ ] 暂停/恢复继续使用独立确认；
- [ ] FSRS 和 queue 逻辑不变。

**验收**：计划缩小范围和教材 Track 预选场景全绿。

**建议提交**：`feat(learning): add plan review summary`

### Task 32：KG unresolved 接入 TaskWorkbench

**文件**：

- Modify: `app/features/knowledge/KnowledgePointsPage.tsx`
- Modify: `app/features/knowledge/knowledge-api.ts`
- Modify: `app/styles/knowledge.css`
- Create: `tests/e2e/knowledge-points.spec.js`

**步骤**：

- [ ] unresolved 列表使用 TaskRail；
- [ ] 候选、证据、词形和审计进入 ContextTools；
- [ ] 接受/拆分/合并使用 ReviewSummary；
- [ ] AI enrichment 只显示 proposal，不自动接受；
- [ ] KG feature flag 关闭时保持降级；
- [ ] 不写 FSRS。

**验收**：现有 lookup、加入本次学习和 planning 边界不变。

**建议提交**：`feat(kg): adopt unresolved task workbench`

### Task 33：Review Session 只接入必要横向原语

**文件**：

- Modify: `app/features/learning/ReviewSessionPage.tsx`
- Modify: `app/features/learning/TodayLearningPage.tsx`
- Modify: `app/styles/learning.css`
- Modify: `tests/e2e/learning-assistance.spec.js`

**步骤**：

- [ ] 不显示 Stage rail、Task workbench 或复杂 Tools；
- [ ] 只复用错误反馈、保存/提交状态和 Session Summary；
- [ ] reveal 门禁和四档评分不变；
- [ ] 评分失败固定当前项；
- [ ] session 结束后显示摘要和返回入口；
- [ ] 键盘流程保持。

**验收**：连续专注会话仍然低干扰，不被 SaaS Shell 过度包装。

**建议提交**：`refactor(learning): align review session feedback`

### Task 34：通过 DS-W3 横向一致性门禁

**文件**：

- Modify: `tests/e2e/app-shell.spec.js`
- Modify: `tests/e2e/react-cards-factory.spec.js`
- Modify: `tests/e2e/learning-assistance.spec.js`
- Modify: `tests/e2e/knowledge-points.spec.js`
- Update: `tests/e2e/ui-visual-regression.spec.js`
- Create: `Docs/TestReports/SaaS_Workflow_DS_W3_Acceptance_20260723.md`

**检查**：

- [ ] 同类 feedback、review、activity 和 retry 行为一致；
- [ ] 不同流程模型保持差异；
- [ ] Cards Factory 不是 Wizard；
- [ ] Learning Plan 是单页 + Review；
- [ ] KG unresolved 是 Task workbench；
- [ ] Review Session 是 Focused session；
- [ ] 所有领域所有权边界保持。

**验收**：

- Cards Factory、Learning、KG 和 Review Session 的定向 E2E 全绿；
- 横向组件统一交互，但没有统一掉不同领域的业务语义；
- 1280/1440 桌面视觉基线无未知差异；
- 验收报告列出每个领域的保留边界。

**建议提交**：`docs(ui): accept cross-domain workflow integration`

---

## Final：完整验收与发布

### Task 35：全容器重建、真实运行验收与文档封板

**文件**：

- Modify: `Docs/Features/SaaS_App_Shell_and_Complex_Workflow_Design_Guidelines.md`
- Modify: `Docs/superpowers/plans/2026-07-23-saas-workflow-modernization.md`
- Modify: `Docs/README.md`
- Create: `Docs/TestReports/SaaS_Workflow_Final_Acceptance_20260723.md`
- Modify: `CLAUDE.md`（仅当运行架构或测试入口变化）

**步骤**：

- [ ] 备份 Docker volume 和 SQLite；
- [ ] 重建 `three_lans_system` 全部必要容器；
- [ ] 确认 `/api/health` 和 `http://127.0.0.1:3010`；
- [ ] 使用合成 fixture 完成全流程；
- [ ] 使用真实本地教材只做人工 smoke，不进入截图或日志；
- [ ] 验证官方整轨、EN/JA TTS、标红、派生卡和学习计划；
- [ ] 验证失败重试、刷新恢复、后退/前进和离开保护；
- [ ] 验证数据库无重复 Study Item、Review Event 或 operation；
- [ ] 验证 rollback 和 feature flag；
- [ ] 更新文档状态为 Implemented/Accepted；
- [ ] 确认工作树和本地/远端提交一致。

**完整测试**：

```bash
npm run lint
npm run typecheck:react
npm run test:unit
npm run test:integration
npm run build:react
npm run test:architecture
npm run test:textbooks:acceptance
npm run test:e2e
npm run smoke
docker compose -p three_lans_system up -d --build
docker compose -p three_lans_system ps
```

**验收**：

- 设计规范、原型、contract、实现与测试没有漂移；
- 教材解析仍由 Codex Skill 完成；
- 页面主要任务是人工确认、发布与学习；
- 复杂流程可恢复、可解释、可测试；
- Cloudscape 采用范围有明确记录；
- 不包含移动端工作；
- 无未确认 schema、API 或领域状态；
- 无真实教材内容进入 Git。

**建议提交**：`docs(ui): complete SaaS workflow modernization`

## 5. 提交批次建议

每个 Task 默认一个提交。以下任务允许在同一阶段内合并，但不得跨阶段：

- Task 3 + Task 4 仅在同一次架构评审中合并；
- Task 6 + Task 7 可作为纯 POC 批次；
- Task 8-13 每个共享原语独立提交；
- Task 15-18 按 schema -> storage -> service -> route 顺序提交；
- Task 19-27 按 adapter -> URL -> layout -> review -> release -> operation -> learning 顺序提交；
- Task 29-33 按领域独立提交；
- Task 5、14、28、34、35 必须是独立门禁提交。

## 6. 停止条件

出现以下任一情况必须停止，不得自行绕过：

- TC-D2 amendment 未确认却需要新增表或状态；
- Cloudscape POC 需要覆盖全局样式才能工作；
- 任务要求应用内 OCR 或让用户重做 Skill 解析；
- draft 修改无法保持 copy-on-write；
- operation 无法做到幂等和 restart recovery；
- 发布会绕过人工确认或 daily new limit；
- 测试需要真实教材原文进入 Git；
- 发现用户未提交改动与当前任务冲突；
- 1280 桌面出现不可达操作或水平溢出；
- 任何任务开始要求移动端设计或开发。

## 7. 当前门禁状态

- [x] SaaS App Shell 与复杂长流程设计规范已建立；
- [x] 教材桌面原型已建立；
- [x] 用户重申 Skill 外部解析、页面人工确认与学习边界；
- [x] 任务已拆解到文件、依赖、测试、验收和提交；
- [x] 用户确认本执行计划；
- [x] Gate 0 开始执行；
- [x] TC-D2 workflow amendment Accepted；
- [x] Cloudscape POC 采用表确认；
- [x] DS-W2 教材迁移验收；
- [ ] DS-W3 横向扩展验收；
- [ ] Final 完整验收。
