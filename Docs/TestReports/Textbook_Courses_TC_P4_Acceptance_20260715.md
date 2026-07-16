# 教材课程 TC-P4 验收报告

> 日期：2026-07-15
> 分支：`SaaS_Modify`
> 结论：**通过**
> 约束：桌面端；真实教材原文、截图、音频与 Manifest 不进入 Git、测试 fixture、日志或截图基线

## 1. 验收范围

- TC-D2 数据与媒体 contract；
- `/textbooks` 空态、导入、人工校对、发布预览、标红、派生卡和媒体互斥；
- `textbook_en/ja` 学习单元与逐方向内容版本；
- 官方音频受控 Range、Kokoro 与 VOICEVOX 真实 sidecar；
- Git 外 source mount、缺失 source root 降级；
- SQLite、记录卷、教材工作卷与教材源备份；
- lint、unit、integration、typecheck、production build、API smoke、desktop E2E/visual、Compose contract。

## 2. 自动化结果

| 门禁 | 结果 |
|---|---:|
| ESLint | 通过，0 error |
| Unit | 294/294 |
| Integration | 57/57 |
| React typecheck | 通过 |
| Production build | 通过，client 1881 modules，SSR 35 modules |
| API smoke | 7/7 |
| Desktop E2E + visual | 32/32 |
| 教材专属 E2E | 4/4，已计入 32 |
| Compose config | 通过 |
| Docker build audit | 0 vulnerabilities |

桌面教材 E2E 使用不含教材内容的合成 Manifest，只覆盖 `1280x720` 与 `1440x900`。两个 snapshot 可安全进入 Git。

## 3. 验收中发现并修复

1. **标红操作丢失选区**：详情容器的 `mouseup` 会在按钮 click 前清空 Range。选区捕获改为只归正文区域所有。
2. **新修订不可见**：Track 同时存在 current/pending revision 时，查询错误优先 current。现优先 pending，确认发布后再切 current。
3. **内容更新噪声**：expression revision locator 变化会让所有方向 content revision 增加。现 locator 保持最新，但只有方向 unit hash 或 unit kind 变化才增加内容版本。

新增集成断言：只修改第一组表达的英文目标时，4 个学习单元中只更新 `expr:01:en`；其余三个保持 content revision 1。

## 4. 真实 Track 01 本地 smoke

Git 外 Manifest 只读校验通过：

- schema：`textbook-track-manifest/v1`；
- 20 组表达，40 个候选学习单元；
- 2 张来源图，1 个官方音频；
- 7 个重点短语，20 个语法说明，37 个汉字 ruby segment；
- 唯一低置信度项：`expr:20` 的 pairing；
- Manifest SHA-256：`4b3782c87ee99435a2969ecc8dae0075c586f164b281219233f15d11d0a7cf0b`；
- source fingerprint：`1f9574a05ea5232212ba19cd7fc8d3d04cf86c45ca67f08022bec02a98e68b6f`；
- content hash：`8908a25d6442388c1b20f379dd0fb6ff1e4791614258786907b27c5f57a078eb`。

生产 API dry-run 通过，随后只导入为 draft。数据库状态：1 course、1 track、1 revision、20 expressions、0 `textbook_track` generation、0 教材 Study Item。未自动执行人工确认、发布或正式教材单句 TTS。

官方音频：`HEAD 200`、`Accept-Ranges: bytes`、Range `206`、内容类型 `audio/mpeg`。页面真实浏览结果：两个支持视口均无横向溢出，控制台 0 error/0 warning，汉字 ruby 正常，低置信度表达显示 LOW。未保存含教材内容的验收截图。

## 5. 运行时与降级

Compose 项目 `three_lans_system` 已全量 rebuild/recreate。运行服务：viewer、ocr、tts-en、tts-ja。健康接口显示 DeepSeek、Storage、Kokoro、VOICEVOX、Tesseract 均 online；本地 LLM 为非关键 offline。

真实 sidecar 使用通用短句 smoke：Kokoro `200 audio/mpeg`，VOICEVOX query `200 application/json`、synthesis `200 audio/wav`。

隔离实例在不存在的 `TEXTBOOK_SOURCE_ROOT` 下仍能启动：课程列表 `200` 空集合，导入返回受控 `400 TEXTBOOK_MANIFEST_PATH_REJECTED`，随后 SIGINT graceful shutdown 完成。应用没有崩溃、未泄露绝对路径。

## 6. 备份

备份目录：`/Users/xueguodong/Backups/Three_LANS/TC-P4-20260715-104431`

| 文件 | SHA-256 |
|---|---|
| `trilingual_records.db` | `680d740118d99ad798f706dcdf556bb536528f955657379790d95dad292ed6a4` |
| `trilingual_records.tar.gz` | `ee8fd60414787af0c4fbd2e0b9ce07f44b8ecaa776fd4cad862d6d9cd7410680` |
| `textbook_work.tar.gz` | `ce5706bd955057845ab8a0fd5a36961e6b32ba28c88c886e959e79ec7c0c8b69` |
| `textbook_sources.tar.gz` | `95ce9c2f621802d3475e9b7965010ea514f72d78a3c25c75bf4613c5ba8cf984` |

SQLite `PRAGMA integrity_check` 返回 `ok`；三个 tar 均通过目录读取校验；`checksums.sha256` 已写入备份目录。模型缓存属于可再生成资产，未纳入业务备份。

## 7. 保留边界

- Track 01 仍停在 draft，必须由用户逐条人工确认后再发布；
- 官方音频句级时间轴、强制对齐、口语评分和知识图谱信号不属于 TC-P4；
- 移动端不在当前产品范围内；
- 真实教材内容只保留在 Git 外 source root、生产 SQLite 和本地业务备份。
