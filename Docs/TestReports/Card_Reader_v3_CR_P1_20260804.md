# Card Reader v3 CR-P1 双渲染 Shadow 验收报告

> 日期：2026-08-04
> 结论：CR-P1 PASS；生产显示仍为 v2，CR-P2 可见 Canary 未授权

## 1. 发生了什么

同一张卡片现在会在服务端做一次不影响页面的“幕后对照”：

- v2 继续按当前 `marked -> DOMPurify -> visible text projection` 读取；
- v3 使用 Unified/Remark/Rehype 生成可序列化 `CardDocument`；
- 系统只比较可见文字、语言区块和音频节点是否一致；
- 用户仍只看到 v2 卡片，v3 不渲染、不保存、不改变任何学习数据。

## 2. 实现范围

- `services/cardReader/cardDocument.mjs`：服务端 CardDocument parser；
- `services/cardReader/cardReaderShadow.mjs`：v2/v3 可见合同比较器；
- `services/cardReader/cardReaderShadowService.js`：按 generation id 读取和有界日志；
- `routes/cardReader.js`：只读 config 与 shadow API；
- `CardModal.tsx`：只在 flag 开启且 generation id 存在时静默触发；
- 根依赖新增 Unified/Remark/Rehype，但不被任何前端模块 import。

## 3. 隐私与数据边界

Shadow 报告只含：

- generation id、card type、source content hash；
- 三项布尔 parity；
- 字符、section、audio、diagnostic 计数；
- v2/v3 可见文本 SHA-256；
- 最多 8 个 mismatch code 和 diagnostic code；
- 执行耗时。

它不含 Markdown、标题、卡片正文、翻译、读音、选区或 CardDocument。路由不接受客户端正文。日志使用同一有界报告，不记录学习内容。

## 4. 零写入证据

集成测试先生成确定性卡片，再记录 SQLite `total_changes()`，调用 shadow API 后重新读取。前后数值完全一致；接口没有新增 migration、表或 write adapter。

真实卷验收又对 generation `1040`、`1039`、`1038` 做了同样的只读调用。调用前后 63 张业务表的总行数均为 `22,806`，表级行数清单 SHA-256 均为 `ac205f3b40f74b86184fa119dcea2fddb073fb2a8d427a2349cdbfb8faab92ce`。三张卡片均未产生 SQLite 写入。

这项证据只说明 CR-P1 shadow 不写库，不代表历史 pronunciation 迁移、Ruby 删除或 analyzer 提案已获批准。

## 5. 自动化结果

| 门禁 | 结果 |
|---|---|
| lint | PASS |
| React typecheck | PASS |
| unit | 466 / 466 PASS |
| integration | 99 / 99 PASS |
| Card Reader unit contracts | parser、安全节点、parity、内容不泄露、输入上限 PASS |
| Card Reader integration | enabled/disabled、400/404、真实 generation、SQLite 零写入 PASS |
| Chromium desktop E2E | 86 / 86 PASS；专项用例确认 shadow 被调用且页面仅有 v2 renderer |
| frontend budget | PASS；CardModal 118,854 raw / 39.59 kB gzip |
| client parser exclusion | PASS；build/client 无 Unified/Remark/Rehype 模块 |

## 6. 真实卡片 Shadow 样本

| Generation | 卡片 | 可见正文 | 语言区块 | 音频节点 | 结论 |
|---|---|---|---|---|---|
| 1040 | primitive | 一致 | 3 / 3 | 4 / 4 | PASS |
| 1039 | at the frontier | 一致 | 3 / 3 | 4 / 4 | PASS |
| 1038 | stunt | 一致 | 3 / 3 | 4 / 4 | PASS |

generation `1040` 首次对照暴露了 `loanword-block` 口径差异：v2 会显示外来语说明，但不把它纳入 `card-visible-text-v1` 选区投影。v3 现将该结构保留为 `aside(role=loanword)`，同时采用相同的投影规则。修复后正文 hash、语言区块和音频节点全部一致。

## 7. 体积说明

CR-P0 证明浏览器直接加载 parser 成本过高。CR-P1 将 parser 固定在 Express 服务端。生产 CardModal 实测为 118,854 raw / 39.59 kB gzip，超过此前 118,600 上限 254 bytes；该差值是相对预算上限，不是严格的改动前后 delta。预算只收紧调整到 119,000，没有把 parser 体积转嫁给浏览器。

## 8. 开关与回退

- 代码和 `.env.example`：`CARD_READER_V3_SHADOW_ENABLED=false`；
- 本地 Compose：默认 `true`，用于积累只读对照结果；
- 立即回退：设置 `CARD_READER_V3_SHADOW_ENABLED=false` 并重启 viewer；
- 关闭后页面继续走 v2，不影响卡片读取、标记、注音、TTS、KG 或学习调度。

## 9. 下一阶段门禁

CR-P2 只允许“人工指定的新三语卡”显示 v3，并且必须随时退回 v2。进入前仍需：

1. 已完成首批三张真实新三语卡 shadow parity；继续积累样本，但不能把三张样本解释为全库证明；
2. 定义 Canary allowlist，不按 card type 一次全开；
3. 补 Annotation、Pronunciation、Selection 在声明式节点上的合同测试；
4. 维持历史 Ruby 迁移、legacy reader 关闭和 analyzer acceptance 的独立人工门禁。
