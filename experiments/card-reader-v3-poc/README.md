# Card Reader v3 POC

隔离验证 `Markdown -> Unified/Remark AST -> CardDocument -> React nodes`。POC 不修改根依赖、生产路由、SQLite、RECORDS_PATH 或现有 CardModal。

## 完整验证

```bash
npm --prefix experiments/card-reader-v3-poc install
npm --prefix experiments/card-reader-v3-poc run verify
```

验证内容：

- 三语 Markdown 被解析为 EN/JA/ZH 三个结构化 section；
- legacy Ruby 只生成基文 + 读音节点，不生成 `<ruby>` DOM；
- audio 转成受控 React button；
- script 被丢弃并记录诊断；
- annotation mark、桌面选区工具条、键盘读音 Tooltip 与音频状态可用；
- 页面不使用 `dangerouslySetInnerHTML`。

`dist/`、截图和 `node_modules/` 不进入 Git。生产迁移门禁见 [`Docs/Architecture/Card_Reader_v3_Structured_Rendering_ADR.md`](../../Docs/Architecture/Card_Reader_v3_Structured_Rendering_ADR.md)。
