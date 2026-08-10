# JLM-A0/A1 可靠性修复验收报告

- 日期：2026-08-11（Asia/Tokyo）
- 范围：JLM 后台提取任务、人工裁决、CardModal 反馈、测试环境与运行文档
- 上位文档：[JLM-D0 设计](../Features/LLM_Generated_Japanese_Linguistic_Metadata_Design.md)、
  [JLM-D2 ADR](../Architecture/Language_Metadata_Proposal_ADR.md)
- 状态：**工程修复 PASS；A1 真实使用观察继续，A2 未开始。**

## 0. 一句话结论

**生成学习卡现在只负责把 JLM 工作写入本地任务队列，不再等待 DeepSeek；后台失败会自动重试，
人工更正由服务端重新核对卡片和选区，界面也会明确显示失败。**

这解决的是可靠性和数据可信度，不代表 LLM 候选准确率已经达到产品放量标准。

## 1. 修复了什么

### 1.1 主卡生成不再被第二次 LLM 调用拖住

- 主卡入库后只执行一次本地 SQLite 入队；
- DeepSeek 调用由独立后台 worker 执行；
- 单次调用默认 20 秒超时，失败最多尝试 3 次；
- 进程重启会恢复遗留的 `running` 任务；
- 如果连任务都没能创建，主卡仍成功，并在 `generation_errors` 留下可补偿记录；
- `POST /api/language-metadata/jobs` 可幂等补建任务，接口本身不调用 LLM。

通俗地说：**语言元数据失败，不再把已经生成好的学习卡一起判失败。**

### 1.2 人工更正不能再信任浏览器传来的位置

服务端在写入前重新完成以下核对：

1. 目标卡片或教材表达仍然存在；
2. 正文 hash 仍是当前版本；
3. code-point 范围合法；
4. 该范围截出的原文与提交的片假名完全一致；
5. 外语原词和语言代码符合合同。

同一位置再次更正会建立 `supersedes_proposal_id` 版本链；同级人工结果由最新一条生效，
而不是表面返回成功却继续显示第一次结果。

### 1.3 用户可以看见失败，也能安全重试

- 接受、拒绝和更正失败会在读音浮层内显示中文错误；
- 409 冲突会提示候选已在其他页面处理；
- 切换到另一个 token 或重新打开浮层时，旧输入和旧错误会清空；
- `Escape` 只关闭最上层读音浮层，不会同时关闭整张学习卡。

## 2. 自动化证据

执行：

```bash
npm run test:acceptance
```

结果：

| 门禁 | 结果 |
|---|---:|
| React 类型检查 | PASS |
| ESLint | PASS |
| 单元测试 | **574 / 574** |
| 集成测试 | **118 / 118** |
| 前端资源预算 | PASS |
| 架构完成、注音纯正文、React Root 所有权 | PASS |
| Production smoke | **7 / 7 probes** |
| Playwright 功能与视觉测试 | **91 / 91** |

新增覆盖包括：

- worker 认领、失败重试与启动恢复；
- provider 收到 `thinking=disabled` 与明确 timeout；
- 缺失目标、旧 hash、伪造 range/surface 均拒绝且零写入；
- 人工更正版本链和同级最新结果优先；
- 手动任务补偿幂等且请求路径不调用 provider；
- A1 冲突错误可见、重新打开输入清空、分层 Escape 行为正确；
- 普通集成测试不再继承本机 `.env` 的 JLM Canary 开关。

## 3. Compose 运行态

执行：

```bash
docker compose -p three_lans_system up -d --build
```

结果：

- `viewer`、`ocr`、`tts-en`、`tts-ja` 四个容器均为 Up；
- `GET http://127.0.0.1:3010/api/health` 返回 200，系统总体状态 online；
- DeepSeek、Kokoro、VOICEVOX、OCR、Storage 与 Selection TTS Cache 均 online；
- Docker build 的 `npm audit` 为 **0 vulnerabilities**；
- 使用既有命名 volume，未重置卡片、SQLite 或媒体数据。

## 4. 仍未完成的产品门禁

本报告不授权以下事项：

- 不把 A1 标为产品放量 PASS；仍需真实使用观察准确率、拒绝率和操作负担；
- 不进入 JLM-A2；不删除主卡 Markdown 中现有的外来语标注；
- 不批量补齐历史卡片；
- 不让 pending 候选进入 KG、学习调度或其它 accepted 消费者。

## 5. 回滚

关闭以下开关即可停止展示与后台提取，不影响主卡正文和学习数据：

```env
LANGUAGE_METADATA_ENABLED=0
LANGUAGE_METADATA_EXTRACTION_ENABLED=0
```

后台任务与提案仍保留审计证据；彻底删除两张 JLM 表属于独立 DROP 级回滚，
不得在普通功能回滚中顺手执行。
