# 本地词典运行手册

状态：2026-08-09 当前基线。

## 1. 边界

- `/dictionary` 只编辑人工覆盖词条 `local_glossary_entries`。
- 开放词典写入 `local_dictionary_entries`，页面只读展示来源、版本和数量。
- 普通查词必须保持只读、无网络、无 DeepSeek 调用。
- 外部 CSV/JSON/JSONL 不进入 Git、Docker 镜像或 `RECORDS_PATH`。
- 词典升级只把同来源旧版本标为 `retired`，不删除审计行，不覆盖人工词条。

## 2. 当前来源顺序

1. 当前卡片或教材已有中文；
2. 人工确认词条；
3. Three LANS 精选启动词典；
4. 中文维基词典日语导出（直接日中，默认需核对）；
5. ECDICT（直接英中，默认需核对）；
6. JMdict → ECDICT（英中桥接，固定低可信）；
7. 最近卡片中的完全一致表达。

## 3. 直接日中来源

- 目录页：<https://kaikki.org/zhwiktionary/日語/index.html>
- 原始数据说明：<https://kaikki.org/zhwiktionary/rawdata.html>
- 许可：中文维基词典文本使用 CC BY-SA 4.0 / GFDL。
- 中文格式：导入器使用 `opencc-js` 的 `t -> cn` 规则把繁体释义转换为简体，`source_ref_json.chineseNormalization` 记录规则版本；该转换只改变字形，不负责义项消歧。
- 本机建议路径：`~/Library/Application Support/ThreeLANS/Dictionaries/`。

下载后先核对 SHA-256：

```bash
shasum -a 256 "/path/kaikki.org-dictionary-日本語.jsonl"
npm run dictionary:import:open -- \
  --source=zhwiktionary \
  --file="/path/kaikki.org-dictionary-日本語.jsonl"
```

dry-run 输出正常后，备份 SQLite，再显式应用：

```bash
npm run dictionary:import:open -- \
  --source=zhwiktionary \
  --file="/path/kaikki.org-dictionary-日本語.jsonl" \
  --db="/path/trilingual_records.db" \
  --apply
```

## 4. DIC-R1 质量观察

容器更新并导入词典后执行：

```bash
npm run dictionary:r1 -- --base-url=http://127.0.0.1:3010
```

固定样本为 40 个英语词和 40 个日语词。报告至少记录命中率、期望关键词匹配率、直接日中/桥接占比、延迟和失败样例。样本匹配只代表简明释义可用性，不等于完整词典学术质量。

2026-08-09 基线见 `Docs/TestReports/Local_Dictionary_DIC_R1_Acceptance_20260809.md`。当前定位是“毫秒级候选释义”：高命中率不等于上下文义项正确；遇到多义词或低可信桥接时，页面必须保留来源和候选，不得把首义冒充最终答案。

## 5. 回滚

导入前必须保留 SQLite 备份。单一来源出现质量问题时，优先把该来源当前版本标为 `retired`，恢复上一版本为 `active`；不要删除人工词条或学习数据。数据库级恢复必须先停 viewer，并连同匹配的 WAL/SHM 状态一起处理。
