# 教材课程运行手册

> 状态：TC-P4 正式运行手册
> 适用范围：本地单用户、Docker Compose 项目 `three_lans_system`、桌面端 `/textbooks`
> 内容边界：教材截图、官方音频、实际 Manifest 与教材原文均留在 Git 外

## 1. 运行边界

教材课程由四个边界清晰的部分组成：

1. `skills/import-textbook-track/`：识别用户提供的截图，产出 Git 外 Manifest，不访问 SQLite；
2. `TEXTBOOK_SOURCE_ROOT`：只读教材源，保存截图、官方音频、Manifest 与 dry-run summary；
3. `TEXTBOOK_WORK_PATH`：系统生成的教材单句 TTS 工作卷；
4. SQLite 与 React `/textbooks`：草稿导入、人工校对、发布、标红、派生卡和学习辅助接入。

应用 OCR API 不参与教材识别。中文提示、ruby 和分析属于派生内容；英日教材原文必须保持官方来源文本，不得静默改写。

## 2. Compose 运行面

默认服务：

| 服务 | 作用 | 必需性 |
|---|---|---|
| `viewer` | React SSR、API、SQLite、教材导入与学习系统 | 必需 |
| `tts-en` | Kokoro 英文单句 TTS | 发布后生成语音时需要 |
| `tts-ja` | VOICEVOX 日文单句 TTS | 发布后生成语音时需要 |
| `ocr` | Cards Factory 图片 OCR | 教材导入不依赖 |

关键挂载：

- `${TEXTBOOK_SOURCE_PATH:-./data/textbook_sources}:/media/textbooks:ro`；
- `three_lans_system_textbook_work:/data/textbooks`；
- `three_lans_system_trilingual_records:/data/trilingual_records`。

模型缓存卷可重新下载，不属于业务备份。SBV2 继续封存在显式 profile 中，不应随默认 Compose 启动。

启动与检查：

```bash
docker compose up -d --build --remove-orphans
docker compose ps
curl -fsS http://127.0.0.1:3010/api/health
```

## 3. 新 Track 标准流程

### 3.1 Skill dry-run

使用 `skills/import-textbook-track/SKILL.md`，输入稳定的课程 key、Track 编号、按页排序的截图绝对路径、可选官方音频和 Git 外 source root。

最终必须连续运行两次验证器；第一次允许 `--write-hashes`，第二次只校验。两次的 source fingerprint、content hash、表达数和学习单元数必须一致。

```bash
node skills/import-textbook-track/scripts/validate-manifest.mjs \
  --manifest "$TEXTBOOK_MANIFEST_PATH" \
  --source-root "$TEXTBOOK_SOURCE_ROOT" \
  --write-hashes \
  --summary "$TEXTBOOK_DRY_RUN_SUMMARY"

node skills/import-textbook-track/scripts/validate-manifest.mjs \
  --manifest "$TEXTBOOK_MANIFEST_PATH" \
  --source-root "$TEXTBOOK_SOURCE_ROOT" \
  --summary "$TEXTBOOK_DRY_RUN_SUMMARY"
```

出现以下任一情况必须停止：英日配对无法确定、官方字段不可读、ruby 无法重建原文、路径越界或穿越符号链接、任一 hash 漂移、表达身份或 ordinal 重复。

### 3.2 人工校对与发布

1. 打开 `http://127.0.0.1:3010/textbooks`；
2. 输入相对 Manifest 路径和预期 Manifest SHA-256；
3. 先执行 `Dry-run`，核对表达数、40 单元等规模预览和低置信度项；
4. 执行 `Import draft`；
5. 逐条核对英日原文、只注汉字的 ruby、中文提示、重点短语、语法点和非直译说明；
6. 点击“确认校对”；
7. 核对发布预览后点击“发布到学习计划”；
8. 发布后按需生成 EN/JA 单句语音。

发布前不会建立 `study_items`。发布后每组表达物化 `textbook_en` 与 `textbook_ja` 两个单元，由学习计划 `dailyNewLimit` 控制每日引入量。

## 4. 音频检查

官方整轨与系统单句 TTS 独立登记、独立播放，并在页面内互斥。中文不生成语音。

媒体接口必须满足：

- `HEAD` 返回 `Accept-Ranges: bytes`、内容长度和基于 SHA-256 的 ETag；
- 合法 Range 返回 `206`；
- 越界 Range 返回 `416`；
- 源文件 hash 漂移返回 `409 TEXTBOOK_AUDIO_HASH_MISMATCH`，并把 availability 标记为 `hash-mismatch`；
- 不通过 `express.static` 暴露教材源或 TTS 工作卷。

官方音频缺失时，页面继续可浏览和校对，但显示不可用状态。单句 TTS 某一方向失败时，保留另一个方向的成功结果和明确错误，不伪造成功。

## 5. 修订与内容更新

新修订必须使用递增的 `revision.number` 和新的 Manifest 文件；`pending_revision_id` 在人工确认前优先展示，发布后成为 `current_revision_id`。

学习单元内容版本只由逐方向 unit hash 和 unit kind 驱动：

- 只修改某一表达的英文目标，只有对应 `textbook_en` 单元增加 content revision；
- expression revision locator 会刷新到最新记录，但 locator 变化本身不算学习内容变化；
- 删除表达会归档对应方向单元，不删除历史复习事实。

## 6. 标红与派生卡

标红 HTML 只允许系统定义的教材结构和 `mark.study-highlight-red`；保存时验证正文重建结果，任何正文改写返回冲突。

选区派生卡使用规范化关系和唯一键去重。队列失败可从队列管理重试；成功后关系同步到 `completed` 并记录目标 generation。教材派生文件夹使用扁平名称 `Textbook-<course>-Track-<NN>`，不得传入含 `/` 的路径。

## 7. 备份

业务备份范围：

- `three_lans_system_trilingual_records`；
- `three_lans_system_textbook_work`；
- Git 外 `TEXTBOOK_SOURCE_ROOT`；
- 独立 SQLite 快照；
- SHA-256 校验文件。

为获得卷级一致性，短暂停止 `viewer`，保持 TTS sidecar 运行即可。归档后立即恢复 viewer。

```bash
docker compose stop viewer

docker run --rm \
  -v three_lans_system_trilingual_records:/source:ro \
  -v "$BACKUP_DIR:/backup" alpine:3.20 \
  tar -czf /backup/trilingual_records.tar.gz -C /source .

docker run --rm \
  -v three_lans_system_textbook_work:/source:ro \
  -v "$BACKUP_DIR:/backup" alpine:3.20 \
  tar -czf /backup/textbook_work.tar.gz -C /source .

tar -czf "$BACKUP_DIR/textbook_sources.tar.gz" -C "$TEXTBOOK_SOURCE_ROOT" .
docker compose start viewer
```

备份后必须验证：`tar -tzf` 三个归档均成功、SQLite `PRAGMA integrity_check` 返回 `ok`、`shasum -a 256` 生成校验文件。

## 8. 恢复

1. 停止 `viewer`；
2. 先对当前卷做一次应急备份；
3. 清空目标业务卷后从对应 tar 恢复；
4. 将教材源恢复到 Git 外 source root；
5. 对 SQLite 执行 `PRAGMA integrity_check`；
6. 启动 viewer，检查 `/api/health`、`/api/textbooks/courses`、`/textbooks` 和一条官方音频 Range 请求；
7. 不恢复 Kokoro/VOICEVOX/SBV2 模型缓存，缺失时让服务重新准备。

不得在 viewer 运行时覆盖 SQLite 文件。

## 9. 降级与故障处理

| 现象 | 检查 | 处理 |
|---|---|---|
| 教材功能显示未开启 | `TEXTBOOK_FEATURE_ENABLED` | 设为 `true` 后重启 viewer |
| Manifest 不可读 | source mount、相对路径、权限 | 保持只读挂载，修正宿主机 source path |
| `TEXTBOOK_MANIFEST_INVALID` | dry-run summary 的错误码 | 回到 Skill 修订，不绕过 validator |
| 官方音频 missing/hash-mismatch | 源文件、size、SHA-256 | 恢复原文件或产出新 revision，不直接改 DB |
| EN/JA TTS 失败 | sidecar health、endpoint、磁盘 | 修复服务后重跑；已生成方向保持幂等跳过 |
| 派生任务失败 | 队列详情与目标文件夹 | 修复原因后重试；重复请求复用同一派生键 |
| source mount 未挂载 | `/api/textbooks` 导入错误 | 已导入 DB 内容仍可读；媒体明确降级，不崩溃、不泄露路径 |

## 10. TC-P4 验收

全量代码门禁：

```bash
npm run test:textbooks:acceptance
```

带真实 Git 外 Manifest 的本地校验：

```bash
TEXTBOOK_MANIFEST_PATH="$TEXTBOOK_MANIFEST_PATH" \
TEXTBOOK_SOURCE_ROOT="$TEXTBOOK_SOURCE_ROOT" \
npm run test:textbooks:acceptance
```

桌面 UI 只验收 `1280x720` 与 `1440x900`。不新增或维护移动端教材页面和移动端截图。真实教材内容只做本机 smoke，不进入测试 fixture、Playwright snapshot、日志或 Git。
