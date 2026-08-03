# 日语按需注音浮层 PF Gate 0 基线

> 日期：2026-08-03
> 范围：只读基线，不代表历史迁移已经执行。

## 1. Git 与运行快照

| 项目 | 结果 |
|---|---|
| 分支 | `SaaS_Modify` |
| 基线提交 | `44e11b4` |
| 远端 | `origin/SaaS_Modify` 与基线一致 |
| 运行 Compose 项目 | `three_lans_system` |
| Viewer | `trilingual-viewer`，`127.0.0.1:3010` |
| OCR | `trilingual-ocr` |
| 英语 TTS | `trilingual-tts-en`，Kokoro 服务 |
| 日语 TTS | `trilingual-tts-ja`，VOICEVOX 服务 |
| 健康检查 | `GET /api/health` 返回 HTTP 200 |

本次基线前工作区已有本功能的文档和实现变更；这些变更没有被当作基线代码提交，也没有覆盖任何用户文件。

## 2. SQLite 与 volume

- SQLite：`PRAGMA integrity_check` 返回 `ok`。
- 只读备份：`/tmp/pronunciation-gate0.db`，用于本地审计脚本，不回写业务数据库。
- 业务 volume：`three_lans_system_trilingual_records`。
- 教材工作 volume：`three_lans_system_textbook_work`。
- 选区 TTS 缓存 volume：`three_lans_system_selection_tts_cache`。
- Kokoro 缓存 volume：`three_lans_system_kokoro_cache`。
- 本次没有执行 `docker compose down -v`，没有删除或重建业务 volume。

基线数据库记录数：

| 表/对象 | 数量 |
|---|---:|
| `generations` | 675 |
| `card_annotations` | 28 |
| `study_items` | 1,216 |
| review events | 0 |
| textbook tracks | 1 |

## 3. Ruby 规模审计

使用只读脚本：

```bash
node scripts/maintenance/auditPronunciationRubyInventory.js \
  --db /tmp/pronunciation-gate0.db \
  --output /tmp/pronunciation-ruby-inventory.json
```

结果：

| 指标 | 实测 |
|---|---:|
| generation 总数 | 675 |
| 含 Ruby generation | 672 |
| Ruby 标签 | 13,528 |
| 不同 Ruby 基文 | 2,829 |
| 严格相邻 Ruby 组 | 598 |
| 相邻组涉及标签 | 1,321 |
| 不同相邻组合 | 466 |

“严格相邻”只接受两个 Ruby 标签在原始内容中零字符相隔；空格、Markdown 标记或其它 HTML 均会断组。旧设计文档中的 465 是过期数字，不能作为迁移门禁，后续候选清单以脚本输出为准。

脚本连续执行时对同一备份产生相同的 manifest hash；脚本只执行 `SELECT`，不包含 `INSERT`、`UPDATE` 或 `DELETE`。

## 4. Gate 0 结论

**PASS（只读基线）**。数据、容器和 Ruby 规模均有可重复证据。PF-P4/PF-P5 的真实迁移仍未执行；在获得人工批准前不得修改历史 generation、教材原文、annotation、学习记录或 Docker volume。
