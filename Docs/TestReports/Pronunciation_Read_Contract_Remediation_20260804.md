# Pronunciation 读取合同与消费者修复报告

> 日期：2026-08-04（Asia/Tokyo）
> 状态：**本轮缺陷修复 PASS；PF-P4 历史迁移、PF-P5 Ruby 删除与 PF-R1 观察继续 BLOCKED**

## 1. 为什么需要修复

评审发现五个合同缺口：普通读取会旁路创建历史 pronunciation 投影；纠音接口能接受不存在的
token 和无效果的边界事件；Review 使用错误 target/全局 offset；跨 annotation/Markdown 节点的词语
会丢失注音；TTS 失败没有可见错误与重试。

这些问题不代表 generation、Ruby 或学习记录已经被改写，但会污染历史 Canary 基线。因此本轮先
修复读写边界和消费者合同，再清理已经产生的 5 条旁路投影。

## 2. 代码修复

- `GET /api/pronunciation` 改为严格只读。无持久化投影时仅返回
  `persisted=false`、`revision=0` 的内存投影；`refresh=1` 同样不写库。
- `ensureGeneration()` / `ensureTextbookExpression()` 保留为显式物化入口，只供新卡生成、教材发布
  和获批迁移流程使用。
- 纠音在写 append-only event 前验证 token、event type、revision、边界和 split/merge 结构；无效请求
  不产生事件、不推进 revision。重复 event key 保持幂等，同 key 异体返回冲突。
- Learning item API 返回当前复习单元的 pronunciation target、source hash 和局部 token offset；教材使用
  `textbook_expression`，普通卡使用 `generation`。Review 不再自行读取完整 generation。
- 注音词跨多个 DOM 节点时按片段渲染，共享 token key，并以 union rect 定位 Popover；双击任一片段
  选择完整词语。
- TTS 失败显示错误和“重试朗读”，不再产生未处理 Promise rejection。

纠音 API 的实际字段为 `eventKey`、`tokenKey`、`eventType` 和事件专属 payload；支持
`reading|resolve|reject|boundary|split|merge`。尚未迁移的历史卡只返回 `persisted=false`
的临时投影，因此当前不可纠音。这是 PF-P4 人工批准前的预期保护边界，而不是读取接口
应当自动补建持久化 document 的理由。

## 3. 真实数据修复

修复前真实卷中有 5 条未获批准的历史 `generation` pronunciation document：

| document id | generation id | token 数 | correction event | 原卡仍含 Ruby |
|---:|---:|---:|---:|---:|
| 1 | 850 | 61 | 0 | 是 |
| 2 | 945 | 48 | 0 | 是 |
| 3 | 951 | 62 | 0 | 是 |
| 4 | 1033 | 64 | 0 | 是 |
| 5 | 1032 | 53 | 0 | 是 |

执行删除前完成 SQLite 在线备份并验证：

- volume 内：`/data/trilingual_records/backups/pronunciation-lazy-write-20260804/`
- 本机 Git 外：`data/backups/pronunciation-lazy-write-20260804/`
- 文件：`trilingual_records-2026-08-04T01-57-25-033Z.db`
- SHA-256：`658333ff70769cd1da0bbed61d35584daa95151779791bc1b19002aea8e1743c`
- `integrity_check=ok`，备份内含 5 条 document。

事务只删除上述 5 条 document；外键级联删除 288 个 token。删除后：document 0、token 0、
`foreign_key_check=[]`、`integrity_check=ok`。未删除或改写 generation、Ruby、annotation、学习记录、
教材和 Docker volume。

## 4. 验证证据

| 门禁 | 结果 |
|---|---|
| lint / TypeScript | PASS |
| unit | 457 / 457 |
| integration | 92 / 92 |
| desktop E2E + visual | 84 / 84 |
| architecture / asset budget | PASS |
| Compose | 4 个容器运行，health overall online |
| smoke | 7 / 7 |
| npm audit | 0 vulnerabilities（生产与完整依赖树） |

真实容器读取 generation 850：返回 55 个 token、`persisted=false`、revision 0；请求前后
`pronunciation_documents` 均为 0，证明旧卡浏览不会再次污染 Canary 基线。

## 5. 仍然禁止的动作

本报告只关闭本轮五个缺陷，不批准历史迁移或 Ruby 退役。以下门禁仍保持：

1. 60 张结构问题卡的人工处理决定；
2. 466 种复合词候选的 accepted 来源；
3. 获批 Canary 子集、回滚和再次前进；
4. 至少 7 个真实使用日的 PF-R1 观察；
5. 上述完成后才可讨论关闭 legacy reader 或删除生产 Ruby。
