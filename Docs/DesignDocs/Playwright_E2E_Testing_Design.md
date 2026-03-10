# Playwright E2E 测试引入方案

## 1. 目标

为当前项目补充一层稳定的浏览器自动化回归能力，覆盖以下高风险 UI 链路：

- 主输入生成
- 日期目录与 Phrase List 刷新
- 卡片弹窗 tab 切换
- `TRAIN` 页展示
- `TRAIN` 页选区生成
- 标红持久化恢复
- 删除链路

## 2. 引入原则

本项目的 Playwright 采用两层策略：

1. `smoke 回归`：默认走 `E2E_TEST_MODE`
   - 不依赖真实 Gemini / OCR / TTS
   - 目标是稳定验证 UI 主链路
2. `真实链路验收`：保留给手工或低频专项测试
   - 不纳入高频 smoke
   - 避免把外部依赖波动引入日常回归

## 3. 本次已落地内容

### 3.1 Playwright 基础设施

- 配置文件：
  - `playwright.config.js`
- 启动脚本：
- `scripts/startE2EServer.sh`
- NPM scripts：
  - `npm run e2e:server`
  - `npm run test:e2e`
  - `npm run test:e2e:headed`
  - `npm run test:e2e:ui`
  - `npm run test:e2e:smoke`
  - `npm run test:e2e:pages`
  - `npm run test:e2e:real`

### 3.2 E2E_TEST_MODE

新增 `E2E_TEST_MODE=1` 的测试模式：

- 关闭生成节流
- `/api/generate` 走固定 fixture，不调用真实 LLM
- 生成结果仍会：
  - 写入日期目录
  - 写入数据库
  - 生成可展示的卡片内容
  - 写入可用的 `TRAIN` 资产
- 跳过真实 TTS 调用

目标是保证 Playwright smoke 用例：

- 可重复
- 可清理
- 不消耗外部模型配额

### 3.3 稳定选择器

新增一批 `data-testid`，覆盖：

- 首页输入与队列状态
- 模型与卡片类型切换
- folder / file 容器
- 卡片弹窗
- 弹窗 tab
- `TRAIN` 头部与重算按钮
- 选区浮动工具条

## 4. 首批 smoke 用例

文件：

- `tests/e2e/smoke.spec.js`

当前覆盖 6 条主链路：

1. 首页加载与空闲状态
2. 主输入生成三语卡并进入当天目录
3. 打开卡片并切换 `CONTENT / TRAIN / INTEL`
4. `TRAIN` 显示答案与标红刷新恢复
5. `TRAIN` 选区生成三语卡与语法卡
6. 删除卡片并确认列表移除

新增页面级 / OCR 用例：

1. `Mission Control` 页面可加载
2. `Knowledge OPS` 页面可加载
3. `Knowledge OPS` 任务启动与取消
4. `Knowledge Hub` 页面可加载
5. OCR fixture 上传、清洗与输入框回填

低频真实验收用例：

- `tests/e2e/real-gemini.spec.js`
- 仅在设置 `RUN_REAL_GEMINI_E2E=1` 时执行
- 默认目标地址：`http://127.0.0.1:3010`
- 用于验证真实 Gemini CLI Proxy 主链路，不纳入高频 smoke
- 当前已覆盖：
  - 文本输入生成真实 Gemini 卡片
  - `TRAIN regenerate` 完成并更新 `updatedAt`
  - `synonym_boundary` 真实 Knowledge Job 启动、执行、落库与详情读取
  - 该用例默认使用 `PLAYWRIGHT_REAL_KNOWLEDGE_MODEL=gemini-2.5-flash` 以控制时延与配额消耗

新增后端清洗回归：

- `tests/e2e/gemini-sanitize.spec.js`
- 覆盖 2 条回归断言：
  1. `geminiProxyService` 可清洗 MCP 诊断前缀，并保留有效 markdown
  2. `knowledgeAnalysisEngine` 的 `synonym_boundary` 链路可清洗 MCP 诊断前缀，并解析有效 JSON
- 对应脚本：

```bash
npm run test:e2e:gemini-sanitize
```

已验证：

- `2026-03-09`
- 命令：`npm run test:e2e:smoke`
- 结果：`6 passed`
- 命令：`npm run test:e2e`
- 结果：`11 passed, 1 skipped`
- `2026-03-10`
- 命令：`npm run test:e2e:gemini-sanitize`
- 结果：`2 passed`
- `2026-03-10`
- 命令：`RUN_REAL_GEMINI_E2E=1 PLAYWRIGHT_REAL_KNOWLEDGE_MODEL=gemini-2.5-flash npx playwright test tests/e2e/real-gemini.spec.js --grep "Knowledge synonym_boundary"`
- 结果：`1 passed`

## 5. 运行方式

首次安装浏览器：

```bash
npx playwright install chromium
```

执行 smoke：

```bash
npm run test:e2e:smoke
```

执行全部 E2E：

```bash
npm run test:e2e
```

带界面执行：

```bash
npm run test:e2e:headed
```

打开 Playwright UI：

```bash
npm run test:e2e:ui
```

## 6. 当前限制

当前 smoke 重点验证的是“UI 行为正确”，不是“模型输出质量正确”。

因此暂不覆盖：

- 真实 Gemini 输出质量
- OCR 准确率
- TTS 音频内容质量
- few-shot 提升效果

这些仍应由：

- 数据验收
- 专项 UI 验证
- 实验报告链路

分别承担。

## 7. 下一步建议

1. 把 `TRAIN` 标红统计拆分为 `content/train` 两个维度
2. 增加 `Knowledge OPS / Knowledge Hub` 的 smoke 用例
3. 为真实 Gemini 链路补一组低频验收用例，与 smoke 分离
