# Pronunciation Overlay POC

这是一个与生产应用隔离的可重复实验目录。它只保存合成日语，不保存教材原文，也不读取或
写入运行中的 SQLite。

## 运行

从仓库根目录执行：

```bash
npm run lint -- --quiet
node experiments/pronunciation-overlay/check-fixture.js
node scripts/maintenance/auditPronunciationRubyInventory.js --db /path/to/read-only.db
node scripts/maintenance/buildPronunciationCompoundCandidates.js --db /path/to/read-only.db
node scripts/maintenance/buildPronunciationMigrationManifest.js --db /path/to/read-only.db
```

所有审计脚本默认只读；输出建议写到 `/tmp` 或受控的本地数据目录，不提交包含教材正文的
manifest。真实迁移必须另行获得批准，并通过 hash-gated apply 工具执行。

## POC 边界

- 解析器：共享 `services/pronunciation/rubyParser.js`；
- 读音：复用 Kuroshiro/Kuromoji，只产生候选；
- 整词：只有版本化词典或人工确认才能变成 accepted；
- 前端：生产页面只消费结构化 token，不在 POC 中加载生产 React；
- 失败：纯正文仍可阅读、选择和复制。
