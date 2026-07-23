# SaaS App Shell 与复杂长流程最终验收

> 日期：2026-07-23
>
> 状态：Accepted
>
> 范围：Gate 0、DS-W1、DS-W2、DS-W3、Final，共 35 项

## 1. 最终结论

35 项开发任务全部完成。Three LANS 已形成桌面端 SaaS App Shell、可恢复教材长流程、统一反馈与 Activity、单页学习计划 Review、KG unresolved Task workbench 和低干扰 Review Session。

生产实现没有引入 Cloudscape 组件包或 global styles。系统吸收其信息架构和可访问性模式，但继续使用 Three LANS tokens、Lucide 图标、语言/卡型色、Markdown、ruby、音频和学习卡视觉。

## 2. 不可变边界

- 教材截图仍由 Codex `import-textbook-track` Skill 在应用外解析。
- 页面从结构化 draft 的人工确认开始，不提供教材截图 OCR、版面解析或英日自动配对。
- 未经人工确认不得发布、物化 Study Item 或进入学习队列。
- Study Item、Review Event、FSRS 和 Planning provider 的所有权未改变。
- KG proposal 不可自动接受，KG 不写 FSRS。
- 本阶段只验收桌面端，没有移动端设计、开发或基线。

## 3. 数据备份

在容器重建前完成：

- SQLite online backup，并验证 `integrity_check=ok`；
- `three_lans_system_trilingual_records` 完整归档；
- `three_lans_system_textbook_work` 完整归档；
- `three_lans_system_kokoro_cache` 完整归档；
- 所有文件生成 SHA-256 清单并通过复核；
- 三个 tar.gz 均通过目录读取测试。

本地备份位于 `data/backups/saas-workflow-final-20260723/`，该目录受 Git 与 Docker build context 排除，不进入仓库和镜像。教材原始素材是只读宿主机目录，没有复制、打印或写入 Git。

## 4. 自动化验证

| 门禁 | 结果 |
|---|---|
| `npm run lint` | PASS |
| `npm run typecheck:react` | PASS |
| `npm run test:unit` | PASS，347/347 |
| `npm run test:integration` | PASS，63/63 |
| `npm run build:react` | PASS |
| `npm run test:architecture` | PASS |
| `npm run test:textbooks:acceptance` | PASS |
| `npm run test:e2e` | PASS，44/44 |
| `npm run smoke` | PASS，7 probes |
| `npm audit --omit=dev` | PASS，0 vulnerabilities |

视觉快照只更新了经人工对照确认的全局 Activity 入口与其引起的桌面内容宽度变化。动态日期按钮使用最小遮罩，避免自然日期变化制造假回归。

## 5. 容器与运行态

Compose project：`three_lans_system`。

正常 profile 运行四个服务：

- `trilingual-viewer`；
- `trilingual-ocr`；
- `trilingual-tts-en`；
- `trilingual-tts-ja`。

封存的 `tts-ja-sbv2` profile 未启动。重建后 `/api/health` 确认 DeepSeek、Kokoro、VOICEVOX、Tesseract 与 Storage 全部 online，`/`、`/textbooks`、`/learn`、`/learn/plan`、`/learn/history` 和 `/knowledge` 均返回 200。

补充 `.dockerignore` 后，viewer build context 从约 1.25 GB 降至约 8 MB；生产镜像内 `npm ci` 与 prune 后审计均为 0 vulnerabilities。

## 6. 真实数据只读核验

生产卷只读结果：

- SQLite integrity：`ok`；
- Study Item：1169；
- 重复 `(source_generation_id, unit_key)`：0；
- 重复 Review Event key：0；
- 重复 textbook operation idempotency key：0；
- 同 Track/kind 的冲突进行中 operation：0。

真实教材页面仅做只读 smoke，不输出正文：页面成功挂载，官方整轨、EN/JA 单句播放、ruby、标红、学习计划和今日学习入口均存在，无横向溢出，浏览器 error log 为 0。

## 7. Feature Flag 与回滚

当前本地运行值：

- `TEXTBOOK_FEATURE_ENABLED=true`；
- `KG_ENABLED=1`；
- `KG_PLANNING_ENABLED=1`；
- `KG_LLM_ENRICHMENT_ENABLED=0`；
- `KG_INCREMENTAL_SYNC_ENABLED=1`。

Compose 的 KG 默认值仍为关闭，教材开关可单独关闭。自动化测试覆盖教材/KG flag 关闭后的安全降级。

回滚资产已验证但未执行破坏性恢复：Git 提交可逐批 revert；SQLite 与三个 volume 归档有校验和和完整性证据；领域 feature flag 可先行关闭新入口。任何真实恢复都必须在停止写入后按运行手册执行。

## 8. 残余非阻塞事项

- React Router 构建仍提示 v8 future flag，当前 v7.18.1 行为和架构测试均正常；升级应独立立项。
- 既有命名卷由早期 Compose 实例创建，重建时会提示 ownership warning，但挂载、数据和完整性均正常；不应仅为消除警告重建业务卷。

## 9. 提交范围

本次 Final 只新增最终验收文档、更新规范与任务状态、稳定桌面快照、缩小 Docker context，并更新无破坏的间接依赖补丁。未把备份、真实教材、密钥、运行日志或 Playwright 输出加入 Git。
