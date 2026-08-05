# Card Reader v3 CR-P2 单卡型可见 Canary 验收报告

> 日期：2026-08-04  
> 结论：CR-P2 PASS；只批准三张人工白名单新三语卡显示 v3

## 1. 这一步解决了什么

CR-P1 只在服务端比较 v2 与 v3，用户仍看不到新内核。CR-P2 把结构化 React renderer 接到真实 CardModal，但把风险限制在人工指定的三张新三语卡：

- `1040`：`primitive`；
- `1039`：`at the frontier`；
- `1038`：`stunt`。

其它卡片继续显示 v2。白名单接口失败、parity 不一致、出现诊断或 React 渲染异常时，当前卡片立即回退 v2。

## 2. 实施范围

- 服务端新增只读 Canary API，并同时校验 feature flag、allowlist、三语卡型、parity 与 diagnostics；
- 前端新增可序列化 CardDocument 类型与受控 React renderer；
- renderer 不使用 `dangerouslySetInnerHTML`，不在浏览器加载 Unified/Remark/Rehype；
- annotation 和 pronunciation 通过隔离兼容桥接器接入同一个 React surface；
- 继续复用现有选区、右键、标红、复制、朗读、中文释义、KG 查询与派生卡 owner；
- 保留 v2 作为按卡片即时降级路径；
- 没有修改 Markdown、content hash、Study Item、FSRS、annotation schema 或 pronunciation schema。

## 3. 真实卷零写入证据

对三张白名单卡逐一调用 Canary API。每张卡均得到：

- `rendererVersion = 3`；
- `document.version = card-document-v1`；
- 3 个语言 section；
- 0 diagnostics。

调用前后业务表计数完全一致：

| 指标 | 调用前 | 调用后 |
|---|---:|---:|
| 业务表 | 63 | 63 |
| 总行数 | 22,806 | 22,806 |
| 计数清单 SHA-256 | `562dde0c8300e14594ec673ca0f892a08bc697531fdee3af40329d878ad61a59` | 相同 |

## 4. 桌面真实页面验证

在 `http://127.0.0.1:3010/` 打开 generation `1040`：

- 页面只有一个 `data-card-renderer-version="3"`，没有 v2 surface；
- 3 个语言区、2 个 pronunciation token、4 个音频按钮；
- 无横向溢出、无 page error；
- 列表项保持原有紧凑排版；
- 视觉截图与既有 v2 基线一致，不需要更新基准图片。

自动化还专门验证了 Canary API 返回 409 时只显示 v2，确保回滚不是文档承诺，而是可执行行为。

## 5. 工程门禁

| 门禁 | 结果 |
|---|---|
| Unit | 469 / 469 PASS |
| Integration | 101 / 101 PASS |
| Desktop E2E | 87 / 87 PASS |
| lint | PASS |
| TypeScript | PASS |
| Architecture | PASS |
| Runtime smoke | 7 / 7 PASS |
| npm audit | 0 vulnerabilities |
| Docker viewer rebuild | PASS |
| `/api/health` | online；DeepSeek、Storage、Kokoro、VOICEVOX、OCR 正常 |

CardModal 最终体积为 119.29 kB raw / 39.70 kB gzip。新增可见 React renderer 后，raw 预算从 119,000 调整为 120,000；gzip 预算仍为 40,000。生产浏览器包中没有 Unified/Remark/Rehype parser。

## 6. 仍未批准

本报告不批准：

- CR-P3 全部三语卡切换；
- 语法卡或场景卡切换；
- 历史 Ruby 迁移；
- pronunciation legacy reader 删除；
- Kuromoji/analyzer proposal 自动接受；
- 修改 Markdown 正文或学习调度数据。

下一阶段必须先观察这三张卡的真实使用反馈，再单独决定是否进入 CR-P3。
