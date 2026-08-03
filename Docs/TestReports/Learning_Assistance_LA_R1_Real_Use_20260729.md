# Learning Assistance LA-R1 真实使用记录

**日期：** 2026-07-29

**学习时区：** `Asia/Tokyo`

**阶段：** LA-R1-1 首日验收

**状态：** 进行中，等待用户完成真实评分

## 1. 本次做了什么

用户明确要求按既定路线进入 LA-R1-1。本次通过 `/learn/plan` 的真实页面建立第一份学习计划，没有使用维护脚本直接写 SQLite。

计划范围：

```json
{
  "version": 2,
  "languages": ["en", "ja"],
  "cardTypes": ["grammar_ja", "textbook_track"],
  "dateRange": null,
  "tags": [],
  "textbookTrackIds": [1]
}
```

参数：

- 每日行动目标：`20`；
- 每日新单元上限：`5`；
- Profile revision：`1`；
- Plan revision：`1`；
- Scheduler：`fsrs` / `ts-fsrs@5.4.1`；
- Parameters hash：`3bf1abc5d1ba6c37033feb41eea28fbf3cae4487012ec5fa3592713af7f31f65`。

## 2. 范围变化

2026-07-23 的只读预览是 225 个学习单元。创建计划前重新预览时，日语语法数据已自然增加 3 个，因此本次真实范围为：

| 单元类型 | 数量 |
|---|---:|
| `grammar_ja` | 188 |
| `textbook_en` | 20 |
| `textbook_ja` | 20 |
| 合计 | 228 |

范围语义没有改变，仍是“日语语法 + Track 01”。按每日 5 个新单元估算，首次引入全部内容约需 46 个学习日。

## 3. 首日队列

首份 Daily Queue：

- Queue ID：`1`；
- Learning day：`2026-07-29`；
- Time zone：`Asia/Tokyo`；
- 状态：创建后为 `ready`，启动会话后为 `active`；
- 总条目：`5`；
- fresh：`5`；
- due：`0`；
- overdue：`0`；
- manual：`0`。

五个新单元均为日语语法：

1. `わけでもなく`
2. `終わらせない`
3. `安っぽい`
4. `使い分けます`
5. `要するに`

所有条目的 `reason=new`、`bucket=6`、`dueAtUtc=null`、`scheduleState=null`，没有伪造到期或逾期状态。

## 4. 内容与 UI 验证

已验证：

- reveal 前四个评分按钮全部禁用；
- reveal 后答案面正常显示；
- 第一项包含中文语法说明、日语例句、仅汉字 ruby 注音和三个日语音频入口；
- 页面实际触发第一条例句音频时没有浏览器错误；
- 今日五个语法单元均有中文提示、ruby 和三条已登记日语音频；
- Track 01 的 `textbook_en` 与 `textbook_ja` 代表单元均可读取中文提示、目标语答案、ruby 数据和对应 EN/JA 音频登记；
- 浏览器 console error 为 `0`。

教材单元尚未自然进入今日五项队列，因此教材在真实复习页中的最终视觉和播放验收仍保持待办，不以只读 API 检查代替真实队列样本。

## 5. 会话恢复验证

建立 Session ID `1` 后：

- current entry：`1`；
- study item：`442`；
- revealed entry：`1`；
- Review Event：`0`；
- Schedule State：`0`。

从 `/learn/session` 返回 `/learn` 后，页面显示“继续上次的会话”；再次进入会话后，current entry 和 revealed entry 仍为 `1`，答案面保持揭示状态。没有创建第二个 active session，也没有产生评分记录。

## 6. KG planning 与运行状态

首份持久化队列包含 planning diagnostics：

- `heuristic-v1`：applied `5`、failed `0`、timedOut `0`；
- `graph-contract`：applied `0`、empty `5`、failed `0`、timedOut `0`。

这表示首日五项没有自然命中 Graph planning signal。按既定规则记录为“自然样本未覆盖”，不扩大范围或伪造 lookup。

检查期间：

- `/api/health` overall online；
- SQLite `integrity_check=ok`；
- 外键违规 `0`；
- 最近 worker 日志未发现 generation/KG worker error、failed 或 exception；
- 四个 Compose 服务均保持运行。

## 7. 数据保护

创建计划前生成了新的 SQLite online backup：

`data/backups/la-r1-1-20260729T081532/trilingual_records.db`

该目录受 Git 排除。备份验证：

- SHA-256：`f17061a4861e377b3a6d98063954eaa8395c68724b4a79439dd2ec0fba3b1c0b`；
- `integrity_check=ok`；
- 外键违规 `0`。

## 8. 当前数据状态

| 数据 | 数量 |
|---|---:|
| Learning Profiles | 1 |
| Learning Plans | 1 |
| Daily Queues | 1 |
| Queue Entries | 5 |
| Learning Sessions | 1 active |
| Review Events | 0 |
| Schedule States | 0 |
| Manual Intents | 0 |

## 9. 尚未完成

以下事项必须由用户的真实回忆与评分完成，不能由自动化脚本代替：

- 对五个项目作出 Again / Hard / Good / Easy 评分；
- 验证提交中锁定、真实失败重试与 event key 幂等；
- 完成一次完整会话并检查 queue/session 闭合；
- 确认 Review Event 与 Schedule State 成对增长；
- 在教材 EN/JA 自然进入真实队列时完成页面级验收；
- 从本学习日起累计七个真实学习日观察。

当前浏览器保留在第一项 `わけでもなく` 的已揭示答案面，等待用户根据真实回忆结果评分。
