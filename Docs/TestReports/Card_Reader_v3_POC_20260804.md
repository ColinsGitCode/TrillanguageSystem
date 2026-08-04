# Card Reader v3 结构化渲染 POC 验证报告

> 日期：2026-08-04
> 结论：POC PASS；生产迁移仍未授权

## 1. 验证对象

隔离目录：`experiments/card-reader-v3-poc/`

验证链路：

```text
synthetic trilingual Markdown
  -> Unified / Remark / Rehype
  -> serializable CardDocument v1
  -> declarative React renderer
```

根 `package.json`、生产路由、CardModal、SQLite、RECORDS_PATH、annotation、pronunciation、KG、learning 与 FSRS 均未修改。

## 2. 自动化结果

运行：

```bash
npm --prefix experiments/card-reader-v3-poc run verify
```

结果：

- Node 合同测试：4/4 PASS；
- Vite production build：PASS；
- Chromium 1440×1000 桌面验证：PASS；
- npm audit：0 vulnerabilities。

合同覆盖：

1. 三语 Markdown 稳定生成 EN / JA / ZH section；
2. legacy Ruby 转为 `pronunciation(surface, reading, source)`，不生成 `<ruby>/<rt>` DOM；
3. audio 转为受控 React button；
4. script 被丢弃并记录 `UNSAFE_NODE_DROPPED`；
5. 英文和日文使用同一选区工具条；
6. 读音 Tooltip 支持 hover 与键盘 focus；
7. annotation mark 由 React 节点渲染；
8. renderer 不使用 `dangerouslySetInnerHTML`。

## 3. 体积发现

第一版把 AST parser 放进浏览器：

- JavaScript：523.80 KB raw / 161.36 KB gzip；
- 判定：不适合直接合入当前 CardModal。

第二版由 Node 预生成 CardDocument，浏览器只加载 renderer：

- JavaScript：203.62 KB raw / 64.45 KB gzip；
- CSS：6.31 KB raw / 2.03 KB gzip；
- 判定：方向可行；独立页面包含自己的 React runtime，生产增量必须在 CR-P1 的共享 bundle 中重新测量。

## 4. 视觉与交互结论

- 语言地图、正文和 Document Inspector 在 1440px 桌面视口内无溢出；
- 正文采用完整文档面而不是嵌套卡片；
- EN / JA / ZH 使用同一结构，但语言色只用于导航和语义提示；
- 选区命令保持紧凑，不遮挡主要正文；
- 日语正文不被常驻注音撑高，读音按需出现。

## 5. 未授权事项

本报告不批准：

- 替换生产 CardModal；
- 修改 Markdown 或 content hash；
- 历史 pronunciation `--apply`；
- 接受 analyzer/复合词候选；
- 关闭 legacy reader 或删除 Ruby；
- 同时迁移全部卡型。

下一步必须是 CR-P1 双渲染 shadow：同一 Markdown 同时生成 v2 可见文本和 v3 CardDocument，只比较、不显示、不写库，并测量生产共享 bundle 的真实增量。
