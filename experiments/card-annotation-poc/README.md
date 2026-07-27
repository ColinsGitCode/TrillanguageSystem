# 注解重锚 POC（CA-D0 §7.1）

回答一个问题：**历史标红改用 selector 锚定后，有多少能准确找回原位置？**

结论见 [`Docs/Features/Card_Annotation_and_Selection_UX_Evaluation.md`](../../Docs/Features/Card_Annotation_and_Selection_UX_Evaluation.md) §7.1：
真实数据 51 个 `<mark>` → **26 条逻辑注解**，**可重锚 96.2%**（25/26），1 条因内容漂移降级 orphaned。

## 运行

脚本**只读**，不写任何库。先把生产库复制出来，再对副本运行：

```bash
docker run --rm -v three_lans_system_trilingual_records:/v -v "$PWD/tmp":/out \
  alpine cp /v/trilingual_records.db /out/prod-copy.db
```

```bash
node experiments/card-annotation-poc/reanchor-dryrun.js ./tmp/prod-copy.db
```

打印每条合并后的注解原文（用于人工校验合并是否正确）：

```bash
SHOW_QUOTES=1 node experiments/card-annotation-poc/reanchor-dryrun.js ./tmp/prod-copy.db
```

## 判定口径

| 状态 | 含义 |
|---|---|
| `exact-unique` | quote 在投影中唯一出现，可直接重锚（高置信） |
| `ctx-resolved` | 多处出现，但 prefix/suffix 能唯一定位 |
| `ambiguous` | 多处出现且上下文无法消歧，需人工 |
| `not-found` | 投影中找不到 → orphaned（内容已漂移） |

## 两个关键实现点

1. **必须先合并碎片**。`<ruby>` 注音会把一次连续划选切成多个 `<mark>`
   （`吹き出し口` → 5 个）。不合并就会得到「が」「終」这类无法定位的单字，
   且统计单位错误。合并在**可见基文投影**上按「连续 marked 区间」还原。
2. **空白归一时空格必须保留自身 marked 标记**，否则 `a short burst of`
   这类含空格短语会被切断成多条注解（初版即因此把 1 条误算为 4 条）。

## 边界

- 不写库、不改 schema、不引入生产依赖；
- 复用项目已有的 `marked` / `jsdom` / `better-sqlite3`，不新增包；
- 投影排除规则（`rt`/`rp`、音频按钮、外来语标签）须与 `app/features/card-modal/selection.ts` 保持一致。
