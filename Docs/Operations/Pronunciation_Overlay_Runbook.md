# 日语按需注音浮层运行手册

> 适用范围：Three LANS 桌面端 Cards Factory、教材课程和 Review。
> 当前状态：纯正文新卡与按需注音已可运行；历史 Ruby 仍是受控迁移兼容路径，不能提前删除。

## 1. 运行边界

注音由独立 pronunciation document/token 投影提供：

- 正文仍是可读、可选择、可复制的纯文本；注音服务失败不能阻断正文。
- Tooltip 只展示词语读音；Popover 才提供播放、知识点查询、生成卡片和人工纠音。
- Kuromoji/Kuroshiro、版本化字典和人工 correction 是读音来源；LLM 不直接写入 accepted 读音。
- pronunciation 不拥有学习单元、复习事件、FSRS 或知识图谱调度状态。
- 普通日志不得写入卡片正文、选区原文、surface、reading 或完整 HTML。

## 2. 开关

默认值以 `.env.example` 和 `lib/serverConfig.js` 为准：

| 环境变量 | 默认 | 作用 |
|---|---:|---|
| `PRONUNCIATION_OVERLAY_ENABLED` | `false` | 返回 pronunciation document/token 并显示浮层 |
| `PRONUNCIATION_ACTIONS_ENABLED` | `false` | 开启 Popover 的播放、查询、生成和纠音动作 |
| `PRONUNCIATION_LEGACY_RUBY_READER_ENABLED` | `true` | 读取尚未迁移的历史 Ruby 输入 |
| `PRONUNCIATION_TELEMETRY_ENABLED` | `false` | 开启不含正文的运行观测 |

Compose 验收环境会显式打开前两个和 telemetry；这不等于已经批准历史 Ruby 退役。

## 3. 启动、重建和健康检查

只重建，不删除 volume：

```bash
docker compose -p three_lans_system up -d --build
docker compose -p three_lans_system ps
curl -fsS http://127.0.0.1:3010/api/health
npm run smoke
```

禁止使用 `docker compose down -v`。如果构建遇到基础镜像网络超时，保留 volume，重试
`up -d --build`，不要用删除数据来“修复”构建问题。

## 4. 诊断接口

```bash
# generation 注音
curl -fsS 'http://127.0.0.1:3010/api/pronunciation?targetKind=generation&targetId=ID'

# 教材表达注音
curl -fsS 'http://127.0.0.1:3010/api/pronunciation?targetKind=textbook_expression&targetId=ID'

# 观测摘要（仅在 telemetry 开启时）
curl -fsS http://127.0.0.1:3010/api/pronunciation/telemetry
```

`GET /api/pronunciation` 是严格只读接口。目标没有持久化投影时，接口在内存中返回
`persisted=false`、`revision=0` 的临时投影；普通浏览、刷新和 Review 读取都不得创建
`pronunciation_documents` 或 `pronunciation_tokens`。持久化只能来自新卡生成事务、教材发布流程，
或 PF-P4 人工批准后的迁移工具。

开关关闭时预期是明确的 404/feature-disabled 响应，不应在前端伪造 token。纠音使用
`POST /api/pronunciation/corrections`，且只接受已经持久化的 document。服务端必须先验证 token、
event type、边界和 split/merge 结构，再写 append-only event；无效请求不得推进 revision 或留下事件。
同一 event key + 同一 body 返回幂等结果，同 key + 不同 body 返回冲突。

因此，尚未完成 PF-P4 受控迁移的历史卡目前只能查看临时注音，不能纠音；前端应禁用纠音
输入并显示原因。纠音适用于新生成且已持久化 pronunciation document 的卡片。不得通过访问
GET 接口、刷新页面或打开 Review 来为历史卡补建 document。

Review 不再自行查询完整 generation 并套用全局 offset；学习 item API 直接返回当前单元的
`pronunciation` 引用和局部坐标。教材单元必须使用 `textbook_expression` target，普通卡使用
`generation` target。

## 5. 只读审计和历史迁移

所有输出写到仓库外的临时目录或受控备份目录，不把真实教材、正文或 SQLite 快照加入 Git：

```bash
npm run pronunciation:backup -- --db="$DB_PATH" --output-dir=/tmp/three-lans-pronunciation-backup
npm run pronunciation:ruby-inventory -- --db="$DB_PATH" --output=/tmp/pronunciation-ruby-inventory.json
npm run pronunciation:eligibility -- --db="$DB_PATH" --output=/tmp/pronunciation-eligibility.json
npm run pronunciation:compound-candidates -- --db="$DB_PATH" --output=/tmp/pronunciation-compounds.json
npm run pronunciation:benchmark -- --db="$DB_PATH" --output=/tmp/pronunciation-benchmark.json
npm run pronunciation:migration-manifest -- --db="$DB_PATH" --output=/tmp/pronunciation-manifest.json
npm run pronunciation:shadow-replay -- --db="$DB_PATH" --output=/tmp/pronunciation-shadow.json
```

apply 工具默认 dry-run。只有完成 PF-P4 人工批准，并且 manifest hash、generation content
hash、备份和回滚点全部核对后，才允许显式传 `--apply`：

```bash
npm run pronunciation:migration-apply -- \
  --db="$DB_PATH" \
  --manifest=/tmp/pronunciation-manifest.json \
  --output=/tmp/pronunciation-apply-summary.json

# 真实写入需要额外的 --apply；未批准时禁止执行
npm run pronunciation:migration-apply -- \
  --db="$DB_PATH" \
  --manifest=/tmp/approved-pronunciation-manifest.json \
  --output=/tmp/pronunciation-apply-summary.json \
  --apply
```

历史 generation 不原地改写。stale、unresolved、excluded 或未批准项目必须保持原状态，
不能为了让统计数字变好看而覆盖。

## 6. 降级和回滚

### 6.1 浮层异常

1. 先关闭 `PRONUNCIATION_ACTIONS_ENABLED`，保留正文和选区能力；
2. 若 token 投影本身异常，再关闭 `PRONUNCIATION_OVERLAY_ENABLED`；
3. 重新构建 viewer，不触碰 records、SQLite 或学习数据；
4. 检查 `/api/health`、浏览器 console 和 telemetry 聚合计数。

### 6.2 TTS/KG 异常

注音浮层不负责 TTS/KG 的事实写入。TTS 失败应显示重试/降级，KG 关闭应显示能力不可用；
不要把失败当成读音修正，不要手动改 generation Markdown。

注音词被 annotation 或 Markdown 拆成多个 DOM 片段时，各片段必须共享同一 token key，Popover
锚点使用所有片段的 union rect；双击任一片段应选择完整词语。不得因为
`Range.surroundContents()` 跨节点失败而静默丢失注音。

### 6.3 历史迁移回滚

停止 migration worker，关闭 overlay/actions，保留 legacy reader；依据 apply summary 和
备份校验后恢复 copy-on-write 投影。禁止直接删除 `trilingual_records` volume，禁止用
`down -v` 回滚。

## 7. 观测与隐私检查

telemetry 只接受枚举、耗时、字符数、状态码和错误码。检查日志/响应中不得出现：

```text
text / phrase / surface / reading / exact / prefix / suffix / markdown / content / html
```

重点观察 token source/status、unresolved、correction、TTS/KG 降级、请求 abort、listener
和 controller 是否归零。至少 7 个真实使用日之前，不得把 PF-R1 标记为 PASS。

## 8. 质量门禁

```bash
npm run lint
npm run typecheck:react
npm run test:unit
npm run test:integration
npm run test:architecture
npm run test:e2e -- --workers=1
npm run test:textbooks:acceptance
npm run smoke
```

E2E 使用共享 SQLite fixture 时保持单 worker；不要并行启动多个会写同一 fixture 的测试服务器。
运行结果写入 `Docs/TestReports/`，报告必须区分自动化 PASS 与人工/时间窗口 BLOCKED。
