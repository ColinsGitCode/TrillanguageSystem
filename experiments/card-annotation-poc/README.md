# 卡片注解锚点 POC（CA-P2）

回答三个问题：

1. selector 能否在重复文本、ruby、跨 DOM 节点、内容修订和文件移动后正确恢复选区；
2. 历史标红能否稳定、幂等地迁移为逻辑注解；
3. Recogito 能否直接接管本项目的 ruby-aware 注解渲染。

结论：

- 锚点合同测试 **11/11** 通过；
- 真实数据 51 个 `<mark>` 合并为 26 条逻辑注解，**25/26（96.2%）可重锚**；
- Recogito 可保留正文 ruby 结构，但原生 selector 会把 `<rt>` 注音计入 quote；
- Recogito 核心包实测 gzip **24,520 B**，且会在正文根节点中追加渲染层；
- v1 不引入 Recogito 生产依赖，吸收 W3C selector 模型并使用项目自己的投影和渲染。

正式决策草案见
[`Docs/Architecture/Card_Annotation_Layer_ADR.md`](../../Docs/Architecture/Card_Annotation_Layer_ADR.md)。

## 安装与完整验证

依赖仅安装在本目录，不修改根 `package.json`：

```bash
npm --prefix experiments/card-annotation-poc install
npm --prefix experiments/card-annotation-poc run verify
```

`verify` 会依次：

1. 运行锚点、迁移身份和 Recogito 兼容性 Node 测试；
2. 独立打包 `@recogito/text-annotator` 并记录原始/gzip 体积；
3. 启动隔离 Vite 页面；
4. 用 Chromium 验证 ruby、多 Range selector、DOMPurify 和渲染层行为。

生成的 `node_modules/` 与 `dist/` 已排除，不进入 Git。

## 合同覆盖

| 场景 | 预期 |
|---|---|
| 重复 quote | 用 prefix/suffix 唯一消歧 |
| ruby | selector 不包含 `rt/rp`，恢复的 Range 仍跨越汉字和送假名 |
| 跨 DOM 节点 | 一个逻辑 selector 可恢复为正确 Range |
| 内容修订 | 前方增加无关文本后仍按 quote 重锚 |
| 文件移动/改期 | 不影响基于实体身份的锚点 |
| 目标文字改变 | 进入 `orphaned`，不得就近误贴 |
| 历史 ID | 同一输入重复生成同一 annotation ID |
| UTF-16 偏移 | emoji 等补充字符与 DOM Range 的 offset 口径一致 |
| Recogito 原生 selector | 明确暴露 ruby 读音污染问题 |
| Recogito 排除节点 | 正确拆成多个 selector，并过滤空 selector |
| 浏览器渲染 | 保留正文 markup，识别临时 overlay 边界 |

## 真实 SQLite 只读审计

不要直接复制正在使用的 SQLite 文件。先用 SQLite online backup 生成一致性副本：

```bash
docker compose -p three_lans_system exec -T viewer node -e \
  'const Database=require("better-sqlite3"); const db=new Database(process.env.DB_PATH,{readonly:true}); db.backup("/tmp/ca-p2.db").then(()=>db.close())'
docker compose -p three_lans_system cp viewer:/tmp/ca-p2.db ./tmp/ca-p2.db
node experiments/card-annotation-poc/reanchor-dryrun.js ./tmp/ca-p2.db
```

打印每条合并后的注解原文只用于本地人工核查：

```bash
SHOW_QUOTES=1 node experiments/card-annotation-poc/reanchor-dryrun.js ./tmp/ca-p2.db
```

审计结束后删除副本，不把 SQLite、正文或带正文的报告提交进 Git。

## 判定口径

| 状态 | 含义 |
|---|---|
| `exact-unique` | quote 在投影中唯一出现，可直接重锚 |
| `ctx-resolved` | 多处出现，但 prefix/suffix 能唯一定位 |
| `ambiguous` | 多处出现且上下文无法消歧，需人工 |
| `not-found` | 投影中找不到，降级为 orphaned |

## 两个关键实现点

1. **先合并 ruby 碎片**。`<ruby>` 会把一次连续划选切成多个 `<mark>`；
   必须在可见基文投影上恢复连续 marked 区间后再生成 selector。
2. **空白归一时保留空格的 marked 状态**。否则 `a short burst of`
   等含空格短语会被错误拆成多条注解。

历史 annotation ID 由 legacy highlight ID、逻辑区间序号、quote 和上下文共同生成。
同一快照重复执行会得到同一身份集合，支持迁移 plan 重放和幂等校验。

## 边界

- CA-P2 不写生产数据库、不改 schema；
- POC 依赖只存在于本目录；
- 生产代码不依赖 Recogito；
- 投影逻辑必须与 `app/features/card-modal/selection.ts` 和生产 Markdown 渲染规则保持一致；
- 当前只验证桌面端，不新增移动端范围。
