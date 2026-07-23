# Learning Assistance LA-R1 运行前检查

**日期：** 2026-07-23

**阶段：** LA-R1-0

**结论：** 通过，可以由用户在 `/learn/plan` 创建首个真实学习计划

## 1. 本次范围

本次只完成首份真实队列之前的时区决策、备份、只读基线和运行环境验证。没有创建 Learning Profile、Learning Plan、Daily Queue、Session、Review Event、Schedule State 或 Manual Intent。

学习时区已确认为 `Asia/Tokyo`。文件归档仍独立使用 `RECORDS_TIMEZONE=Asia/Shanghai`，本次没有修改历史文件日期或目录。

## 2. 时区落实

- 学习领域产品默认值：`Asia/Tokyo`；
- Compose 运行变量：`LEARNING_TIMEZONE=Asia/Tokyo`；
- `GET /api/learning/plan` 返回未持久化 profile，`timeZone=Asia/Tokyo`、`revision=0`；
- 学习计划页和 Knowledge lookup 的未持久化兜底值同步为 `Asia/Tokyo`；
- Temporal 回归确认东京自然日从前一 UTC 日 `15:00Z` 开始；
- 首份队列创建后不得静默切换时区。

## 3. 数据基线

基线采集时间：`2026-07-23T06:58:20.550Z`

| 数据 | 数量 |
|---|---:|
| Learning Profiles | 0 |
| Learning Plans | 0 |
| Daily Queues / Queue Entries | 0 / 0 |
| Sessions | 0 |
| Review Events / Schedule States | 0 / 0 |
| Manual Intents | 0 |
| Study Items | 1169 |
| KG Lookup Events | 2 |
| KG Resolution Cases | 253 |
| KG Planning Signals | 1 |
| KG Source Sync Jobs | 114 succeeded，其他状态 0 |

SQLite `integrity_check=ok`，外键违规为 `0`。

## 4. 首个计划只读预览

预览范围：

```json
{
  "version": 2,
  "languages": ["en", "ja"],
  "cardTypes": ["grammar_ja", "textbook_track"],
  "dateRange": null,
  "tags": [],
  "textbookTrackIds": [1]
}
```

| 单元类型 | 数量 |
|---|---:|
| `grammar_ja` | 185 |
| `textbook_en` | 20 |
| `textbook_ja` | 20 |
| 合计 | 225 |

推荐参数保持为每日行动目标 `20`、每日新单元上限 `5`。预览请求没有写入数据库。

## 5. Git 外备份

备份目录：

`data/backups/la-r1-preflight-20260723T155819/`

该目录受 `.gitignore` 排除，包含：

- SQLite online backup：`trilingual_records.db`；
- 记录业务卷：`trilingual_records_volume.tar.gz`；
- 教材工作卷：`textbook_work_volume.tar.gz`；
- 只读基线：`baseline.json`；
- SHA-256：`checksums.sha256`。

三个备份文件的 SHA-256 复核通过，两个 tar 归档可读取；SQLite 备份的 `integrity_check=ok`、外键违规为 `0`。

## 6. 工程与运行验证

| 检查 | 结果 |
|---|---|
| 时区单元测试 | 4 / 4 |
| 完整 unit | 347 / 347 |
| integration | 63 / 63 |
| React typecheck | 通过 |
| ESLint | 通过 |
| Compose 配置解析 | 通过 |
| Docker production build | 通过，npm audit 0 vulnerabilities |
| `/api/health` | overall online |
| KG incremental worker | recovered 0 / planned 0 / queued 0 |
| 业务容器 | viewer、ocr、tts-en、tts-ja 运行中 |

完整 unit 首次与其它门禁并行执行时，KG canary 的实时性能门禁出现一次瞬时超时；该测试随后连续独立通过两次，完整 unit 在正常负载下重跑为 347 / 347。功能断言和数据均未变化。

## 7. 下一步

由用户在 `/learn/plan` 明确确认并保存上述 225 单元范围以及 `20 / 5` 参数。保存动作会首次持久化 `Asia/Tokyo` profile 并生成 Daily Queue；该动作不由维护脚本代替。
