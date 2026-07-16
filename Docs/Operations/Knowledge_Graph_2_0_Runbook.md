# 知识图谱 2.0 运行手册

> 状态：KG-R0 受控回填与启用手册
> 适用范围：本地单用户、Docker Compose 项目 `three_lans_system`、桌面端 `/knowledge`
> 内容边界：回填 Manifest、SQLite 备份与 apply 报告保存在本地业务卷，禁止进入 Git

## 1. 运行边界

知识图谱只组织、解释和受限细排学习单元：它不拥有 FSRS，不直接写 Review Event 或 Schedule State。运行时开关分级如下：

| 开关 | 能力 | 初始值 |
|---|---|---:|
| `KG_ENABLED` | `/api/kg`、显式 lookup 与 `/knowledge` 数据读取 | `0` |
| `KG_PLANNING_ENABLED` | 只读 Graph signalReader 对既有基础队列细排 | `0` |
| `KG_LLM_ENRICHMENT_ENABLED` | 未来异步候选提案，不属于 KG v1 | `0` |

首次回填期间三项都必须保持 `0`。回填不产生 lookup 事件、复习事件或调度状态。

## 2. 回填器安全契约

`scripts/maintenance/applyKnowledgeBackfill.js` 是唯一允许把 KG dry-run 结果写入事实表的维护入口。它在同一命令中执行：

1. 先创建独立 SQLite backup；
2. 重新生成当前 source snapshot 的 Manifest；
3. 要求 `--expected-manifest-hash` 精确匹配；
4. 复核每条 Evidence 的源内容 hash，任何 source drift 都拒绝整次写入；
5. 要求 KG 事实表为空，避免把初始回填和未来增量更新混在一起；
6. 单事务写入确定性 KP、surface、Evidence、link 与可物化 unresolved case；
7. 重建 `kg_point_stats` 和 `kg_planning_signals`，输出不可覆盖的 JSON 报告。

无法提取正文的 `whole_card` 与空文本只留在报告中，不伪造知识点或 unresolved case。纯假名歧义、未知 token 等有明确输入的项目会保留为可人工裁决的 unresolved case。

## 3. KG-R0 标准流程

### 3.1 卷级备份

先停止 viewer，创建整卷归档，再恢复服务。模型缓存不属于业务备份。

```bash
docker compose stop viewer

docker run --rm \
  -v three_lans_system_trilingual_records:/source:ro \
  -v "$BACKUP_DIR:/backup" alpine:3.20 \
  tar -czf /backup/trilingual-records-before-kg-r0.tar.gz -C /source .

docker compose start viewer
tar -tzf "$BACKUP_DIR/trilingual-records-before-kg-r0.tar.gz"
```

### 3.2 生成并审核只读 Manifest

下面命令只读 SQLite，将 Manifest 保存在业务卷的本地运行目录。运行两次时，只要源数据未变，`manifestHash` 必须一致；`createdAtUtc` 不参与 hash。

```bash
docker compose exec -T viewer node scripts/maintenance/kgP1BackfillDryRun.js \
  --db=/data/trilingual_records/trilingual_records.db \
  --output=/data/trilingual_records/kg-r0/kg-backfill-manifest.json
```

审核 Manifest 的 summary、`unresolved` 的 reason 分布和候选样本。尤其检查日语 pure-kana 歧义是否仍为 unresolved。resolved 候选必须同时满足：英语正文不含中日韩文字、日语正文至少含一种日文脚本、正文不含 HTML/ruby 标记。语言错位、残留标记和无法唯一分析的来源必须进入 unresolved。未获得明确批准前不得执行 apply。

### 3.3 受控 apply

将已经审核的 hash 替换到命令中。backup 与 report 都使用一次性新路径；脚本拒绝覆盖已有文件。

```bash
docker compose exec -T viewer node scripts/maintenance/applyKnowledgeBackfill.js --apply \
  --db=/data/trilingual_records/trilingual_records.db \
  --expected-manifest-hash="$MANIFEST_HASH" \
  --backup=/data/trilingual_records/kg-r0/backups/sqlite-before-kg-r0.db \
  --report=/data/trilingual_records/kg-r0/reports/kg-r0-apply-report.json
```

成功报告必须满足：`kg_lookup_events` 的 inserted 数为 `0`；`kg_points`、`kg_evidence` 和 `kg_point_stats` 的数量与 Manifest 的 resolved 候选一致；unresolved 的 materialized 和 skipped 数量可解释。执行后检查：

```bash
docker compose exec -T viewer node -e "const D=require('better-sqlite3');const d=new D('/data/trilingual_records/trilingual_records.db',{readonly:true});console.log(d.pragma('integrity_check',{simple:true}));console.log(d.prepare('SELECT COUNT(*) AS n FROM kg_points').get());"
```

## 4. 分级启用与观察

1. 回填验收后，设 `KG_ENABLED=1`，保持 `KG_PLANNING_ENABLED=0`，重建 viewer；
2. 在 `/knowledge` 完成人工样本：英文、日语词形、纯假名 unresolved、Evidence 追溯和一次确认加入学习；
3. 确认 lookup 是 append-only，加入学习未直接改写 Review Event/Schedule State；
4. 观察稳定后才设 `KG_PLANNING_ENABLED=1`；验证 Graph reader 只在基础集合内细排、reader 失败时队列顺序回退、p95 不超过 10ms；
5. `KG_LLM_ENRICHMENT_ENABLED` 保持 `0`，除非新的 ADR 获得接受。

## 5. 回滚与恢复

关闭 `KG_ENABLED` 和 `KG_PLANNING_ENABLED` 可以立即停止 UI/API 与 planning 读取，保留已经写入的 append-only 事实。不得 DROP KG 表或删除事件。

若 apply 后发现 source 或规则错误：先关闭 `KG_ENABLED` 与 `KG_PLANNING_ENABLED`，停止 viewer 并备份当前卷。使用 SQLite backup 恢复时，必须在 viewer 停止期间清除主库对应的 WAL/SHM，再替换主库；不得只复制 `.db` 后直接启动，否则旧 WAL 可能被重放到备份上。

```bash
docker compose stop viewer

docker run --rm \
  -v three_lans_system_trilingual_records:/data \
  alpine:3.20 rm -f \
  /data/trilingual_records.db-wal \
  /data/trilingual_records.db-shm

docker run --rm \
  -v three_lans_system_trilingual_records:/data \
  alpine:3.20 cp \
  /data/kg-r0/backups/sqlite-before-kg-r0.db \
  /data/trilingual_records.db
```

在 viewer 仍停止时，使用只读 SQLite 连接执行 `PRAGMA integrity_check` 与 `PRAGMA foreign_key_check`；两者通过且 KG 事实表数量符合恢复点后，才允许启动 viewer。启动后再检查 `/api/health`，恢复完成前不得重新开启任一 KG flag。

## 6. 2026-07-16 首次运行记录

首次 v2 Manifest 技术回填成功，但只读 UI 抽样发现历史 `en_translation` 存在目标语言错位，`ja_translation` 的 ruby 展示标记被误当作规范正文。该批次已立即关闭 KG，并从 pre-R0 SQLite backup 恢复到 KG 事实表全空、`integrity_check=ok`、外键违规为 0 的状态。`kg-source-extractor-v2` / Manifest v3 增加 ruby 正文化、目标语言检查和残留 HTML 门禁；v2 Manifest 与 apply 报告只作为失败审计证据，不得再次批准。

经 v2 回滚后，v3 Manifest 与最终 v3c apply 的真实 Compose volume 验收如下：

| 项目 | 结果 |
|---|---:|
| Manifest / extractor | `kg-p1-backfill-manifest-v3` / `kg-source-extractor-v2` |
| approved Manifest hash | `b79afaf97f1a1c1fd445fc150060ffc925ec7de3759a15460857085f77037275` |
| resolved / unresolved candidates | 904 / 306 |
| inserted KP / Surface / Evidence | 855 / 1107 / 1123 |
| materialized / skipped unresolved | 255 / 51 |
| lookup / planning rows created by backfill | 0 / 0 |
| resolved language or markup violations | 0 |
| Study Items before / after | 1141 / 1141 |
| Review Events / Schedule States / Manual Intents after apply | 0 / 0 / 0 |
| SQLite integrity / foreign-key violations | `ok` / 0 |
| v3c report hash | `5e3ea7ed8901a7ba6423cdf8c66ea6e1f432b9595a6098041adfb52fee6aa142` |
| clean baseline archive SHA-256 | `5f18709b0fc933f56cfaddcc4375750f78eb26e8c4c2423811c156606ae02de9` |
| lint / React typecheck | 通过 / 通过 |
| unit / integration | 332/332 / 62/62 通过 |
| architecture / smoke / Playwright | 通过 / 7/7 / 34/34 通过 |
| Docker build/runtime | React production build 通过，npm audit 0 vulnerabilities，viewer/health 正常 |

人工运行验收使用只读结果选择检查英文短语 `continuous integration (ci)` 与日语 `乾杯`：结果选择不写 lookup；只有显式提交英文查找才写入一条 resolved lookup。日语纯假名 `はし` 的显式提交新增一条 unresolved lookup 和一个待确认 case，不创建 KP。英语正文配日语语言、中文正文配英语语言均在事实写入前返回 `KG_INVALID_INPUT`，数据库计数不变。验收结束时 `KG_ENABLED=1`，`KG_PLANNING_ENABLED=0`，`KG_LLM_ENRICHMENT_ENABLED=0`；两条验收 lookup 均为真实 append-only 用户行为记录，不回删。

边界核验：KG-R0 没有调用 DeepSeek 建图，没有写 Review Event、Schedule State、Manual Intent 或 FSRS；规划 reader 仍关闭。Manifest、apply report、SQLite backup 与卷归档全部保留在 Git 外。
