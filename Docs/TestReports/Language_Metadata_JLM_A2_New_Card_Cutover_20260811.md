# JLM-A2 新卡正文切换验收报告

- 日期：2026-08-11（Asia/Tokyo）
- 范围：新生成卡片的外来语来源正文合同、双形态兼容、真实生成与运行回滚
- 上位文档：[JLM-D0 设计](../Features/LLM_Generated_Japanese_Linguistic_Metadata_Design.md)、
  [JLM-D2 ADR](../Architecture/Language_Metadata_Proposal_ADR.md)
- 状态：**A2 新卡切换 PASS；A1 人工准确率观察继续；历史迁移与 Ruby 退役不在本报告范围。**

## 0. 一句话结论

**开启 A2 后，新卡不再把“外来语标注”写进学习正文；来源信息由独立元数据任务提供。
旧卡不修改，旧版和新版卡片可以长期同时打开、选词、标注和学习。**

## 1. 授权与边界

JLM-D0 原本要求 A1 积累足够真实使用样本后再进入 A2。2026-08-11，用户在 A0/A1
可靠性修复、双形态兼容评审和本机观察可用的基础上明确执行 A2。

这是一项有记录的产品决定，不应被改写为“A1 长期准确率、拒绝率和操作体验已经自然达标”。
A1 观察继续，但不再阻塞新卡正文切换。

A2 明确不做以下事项：

- 不改写任何历史 generation、Markdown 或 `content_hash`；
- 不删除历史 `loanword-block` 解析与渲染分支；
- 不把旁路语言元数据写回 Markdown；
- 不批量补齐历史卡片；
- 不推进历史 Ruby 迁移或 Ruby 删除。

## 2. 实现合同

新增 `LANGUAGE_METADATA_A2_ENABLED`，仓库与 Compose 默认值均为 `0`。只有以下三个开关
同时开启时，A2 才生效：

```env
LANGUAGE_METADATA_ENABLED=1
LANGUAGE_METADATA_EXTRACTION_ENABLED=1
LANGUAGE_METADATA_A2_ENABLED=1
```

生效后：

1. prompt 变换器删除 legacy 外来语标注要求；
2. 后处理器清除模型偶尔泄漏的 standalone、inline 或 `loanword-block` 标注；
3. 清理后的 Markdown 正常计算并持久化自己的 SHA-256；
4. 卡片入库后照常创建独立语言元数据任务；
5. 关闭 A2 可恢复旧版新卡合同，但不会反向改写已经生成的 A2 卡片。

## 3. 自动化证据

本次实跑结果：

| 门禁 | 结果 |
|---|---:|
| A2 定向合同与双形态测试 | **59 / 59** |
| 单元测试 | **584 / 584** |
| 集成测试 | **118 / 118** |
| ESLint | PASS |
| React 类型检查 | PASS |
| 架构与前端资源预算 | PASS |
| Production smoke | **7 / 7 probes** |
| Playwright 桌面功能与视觉测试 | **91 / 91** |

覆盖内容包括：

- 三种卡型的 prompt 均不再要求正文外来语标注；
- 后处理器能移除模型泄漏，同时保留正常学习内容；
- 有 legacy block 和无 legacy block 的 Markdown 都不会产生空壳；
- 两种正文形态的可选正文投影、注解锚点与 Card Reader shadow parity 一致；
- A2 生成后的 SHA-256 与实际 Markdown 字节严格相等；
- A2 默认关闭，且不能绕过 A0/A1 总开关独立生效。

## 4. 三类真实生成

在项目 `three_lans_system` 的真实 DeepSeek、Kokoro、VOICEVOX 与 SQLite 链路上生成：

| 卡型 | Job / Generation | 输入 | 结果 |
|---|---|---|---|
| 三语卡 | `436 / 1046` | `streamline the handover checklist` | Markdown、DB 与磁盘一致；无 inline 外来语标注；音频 **4/4**；pronunciation document 已建立；元数据任务一次成功 |
| 日语语法卡 | `437 / 1047` | `～ことになっている（運用ルール）` | Markdown、DB 与磁盘一致；无 inline 外来语标注；音频 **3/3**；pronunciation document 已建立；无适用片假名候选，因此未创建元数据任务，这是预期 no-op |
| 场景表达卡 | `438 / 1048` | 团队在共享办公室临时调整会议室预约并确认投影设备 | **20** 组表达；Markdown、DB 与磁盘一致；无 inline 外来语标注；音频 **40/40**；元数据任务一次成功 |

三张卡均归档到 `20260811`。每张卡的数据库 `content_hash` 都等于实际 Markdown 的 SHA-256，
磁盘 Markdown 与数据库 Markdown 逐字节一致。

## 5. Compose 运行态

执行完整重建后：

- `viewer`、`ocr`、`tts-en`、`tts-ja` 四个服务均为 Up；
- `/api/health` 返回 200；
- DeepSeek、英语 TTS、日语 TTS、OCR 与存储均 online；
- Docker build 的 `npm audit` 为 **0 vulnerabilities**；
- 构建提示既有 volumes 最初不是由 Compose 创建，这是运行环境提示，不影响本次数据保留或验收。

## 6. 结论与回滚

**JLM-A2 新卡切换 PASS。** 当前本机忽略提交的 `.env` 已显式开启 A0/A1/A2，便于继续真实使用；
仓库默认仍全部关闭。

回滚只需把 `LANGUAGE_METADATA_A2_ENABLED=0` 后重建 viewer。回滚会让后续新卡恢复 legacy
正文格式，不删除任务、提案或任何卡片，也不修改已经生成的 A2 卡片。

本结论不授权历史卡迁移、Ruby 删除、方案 B（词性/辞书形）或方案 C（LLM 读音）。
