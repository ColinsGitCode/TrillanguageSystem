# Google Drive 每日核心数据异地备份运行手册

> 适用范围：生产宿主机 **X86-MAC**（`/Users/colin/ThreeLANS/`，Compose 项目 `three_lans_system`）
> 安全底座：复用共享 Google Cloud 项目 `personal-drive-backups`（`personal-drive-backups-515601`），采用“项目专属 Desktop OAuth 客户端 + `drive.file` 最小权限隔离 + 离线公钥混合加密”

---

## 1. 备份范围与体积基线

### 纳入每日备份的核心数据

1. **SQLite 主数据库一致性快照**（`db/trilingual_records.db`）：
   - 通过容器内 `better-sqlite3` 的 SQLite Online Backup API 零停机导出（绝不直接拷贝运行中的 `.db`/WAL 文件）。
   - 导出后校验 `PRAGMA integrity_check == ok`，并记录 `schema_migrations` 版本与核心表行数到 `manifest.json`。
2. **卡片文本产物**（`records/`）：
   - 仅收集 `/data/trilingual_records` 下的活跃卡片文本产物（`.md`、`.html`、`.json` 等），自动排除历史备份目录（`backups/`、`kg-r0/`、`kg-r1/`、`kg-r2/`）与体积庞大的旧 `.db`/`.sqlite`/`.bak` 副本。
   - 卡片音频（`.mp3`/`.wav`，可通过本地 Kokoro/VOICEVOX 再生）默认不纳入每日全量包（`include_card_audio: false`），使单日加密归档保持在 ~35–45 MB；如需包含，可在 `drive-policy.json` 中显式改为 `true`。
3. **教材课程核心资产**（默认开启，`include_textbooks: true`）：
   - `textbook_work/`（`/data/textbooks`，教材正式 EN/JA 单句 TTS）；
   - `textbook_sources/`（宿主机 `/Users/colin/ThreeLANS/textbook_sources`，教材截图、官方音频、Manifest、dry-run summary）。
4. **结构化清单**（`manifest.json`）：逐文件字节数、SHA-256 与 SQLite 表计数。

### 明确排除（不备份）

- `three_lans_system_selection_tts_cache`（选区朗读临时缓存）
- `kokoro_cache`、`sbv2_models`（TTS 模型缓存）
- 公开沙箱临时数据（`/data/sandboxes`）
- 生产 `.env`（含 `DEEPSEEK_API_KEY`，建议离线保管在密码管理器，不与业务备份混放）

---

## 2. 安全与可靠性契约

- **最小权限隔离**：仅申请 `https://www.googleapis.com/auth/drive.file`，专属私有目录 `ThreeLANSBackups`（校验 `shared == false`），与其他项目及个人 Drive 文件完全隔离。
- **离机前加密**：采用流式分块 `AES-256-GCM` + `RSA-OAEP-SHA256` 信封加密（`TLANSPK1\0`，4096-bit RSA）。生产宿主机 **仅存公钥**；恢复私钥由本人离线加密保管，绝不上传至 X86-MAC 或 Google Drive。
- **传输边界**：纯 Node.js 标准库 HTTPS（零外部依赖），白名单锁定 `oauth2.googleapis.com` 与 `www.googleapis.com`，采用分块 Resumable Upload。
- **强制反向验签**：上传完成后回查 `GET /drive/v3/files/{fileId}` 校验 `size`、`sha256Checksum`、`parents`、`trashed == false`、`shared == false` 与 `appProperties`；同名文件校验和不一致时立即 `FAIL`，绝不静默覆盖；验签通过后才原子写入本地回执（`0600` + `fsync`）。
- **只移回收站、绝不硬删**：仅在当轮验签通过后触发清理，仅匹配受管命名与 `appProperties` 的归档，始终保留最新 **≥ 3 代**，超过保留期（默认 30 天）仅调用 `PATCH {"trashed": true}` 移入 Drive 回收站，代码中不实现永久 `DELETE`。

---

## 3. 一次性初始化（控制端本机执行）

### 3.1 在 Google Cloud 创建项目专属 Desktop 客户端

1. 打开 Google Cloud 控制台，切换到 **`personal-drive-backups`**。
2. 进入 **Google Auth Platform → 客户端 → 创建客户端**。
3. 应用类型选 **桌面应用（Desktop app）**，名称建议 `three-lans-x86-mac-backup`。
4. 下载客户端 JSON 到本机私有目录并收紧权限：

```bash
mkdir -p ~/.threelans-core-recovery/drive-oauth
chmod 700 ~/.threelans-core-recovery ~/.threelans-core-recovery/drive-oauth
mv ~/Downloads/client_secret_*.json ~/.threelans-core-recovery/drive-oauth/client-secret.json
chmod 600 ~/.threelans-core-recovery/drive-oauth/client-secret.json
```

### 3.2 生成离线 RSA-4096 恢复密钥对

在你的**个人控制端本机**（不是 X86-MAC）生成密钥并妥善离线保管私钥：

```bash
npm run backup:drive:init-key
```

记录输出的 `recipient_sha256`（64 位十六进制指纹）与 `public_key_file`。
- **`recovery-private.pem`**：仅留在你本机/离线密码管理器中，**绝不复制到 X86-MAC 或 Google Drive**。

### 3.3 完成一次性 PKCE OAuth 授权并创建私有目录

```bash
node scripts/backup/auth.js oauth \
  --client-secret ~/.threelans-core-recovery/drive-oauth/client-secret.json \
  --recipient-sha256 <你的64位recipient_sha256> \
  --folder-name ThreeLANSBackups \
  --retention-days 30 \
  --min-keep 3
```

首次授权若浏览器提示“Google 尚未验证此应用”，点击 **高级 → 继续** 完成确认。完成后本机将生成 `drive-token.json` 与 `drive-policy.json`（均为 `0600`）。

---

## 4. 部署到生产宿主机（X86-MAC）

### 4.1 创建私有目录并同步运行凭据（不含恢复私钥）

```bash
ssh ts_x86_mac 'mkdir -p /Users/colin/ThreeLANS/secrets/drive-backup /Users/colin/ThreeLANS/backups/google-drive/logs && chmod 700 /Users/colin/ThreeLANS/secrets /Users/colin/ThreeLANS/secrets/drive-backup /Users/colin/ThreeLANS/backups /Users/colin/ThreeLANS/backups/google-drive /Users/colin/ThreeLANS/backups/google-drive/logs'

scp ~/.threelans-core-recovery/keys/recovery-public.pem \
  ts_x86_mac:/Users/colin/ThreeLANS/secrets/drive-backup/recovery-public.pem
scp ~/.threelans-core-recovery/drive-oauth/drive-token.json \
  ts_x86_mac:/Users/colin/ThreeLANS/secrets/drive-backup/drive-token.json
scp ~/.threelans-core-recovery/drive-oauth/drive-policy.json \
  ts_x86_mac:/Users/colin/ThreeLANS/backups/google-drive/drive-policy.json

ssh ts_x86_mac 'chmod 600 /Users/colin/ThreeLANS/secrets/drive-backup/recovery-public.pem /Users/colin/ThreeLANS/secrets/drive-backup/drive-token.json /Users/colin/ThreeLANS/backups/google-drive/drive-policy.json'
```

### 4.2 首次手动真机试跑与云端反向验签

确保 X86-MAC 的 `/Users/colin/ThreeLANS/source-repository` 已拉取包含 `scripts/backup/` 的提交，然后执行：

```bash
ssh ts_x86_mac '/usr/local/bin/node /Users/colin/ThreeLANS/source-repository/scripts/backup/upload.js run --origin manual --root /Users/colin/ThreeLANS/backups/google-drive'
```

核对输出 JSON：
- `status: "OK"`
- `uploaded: 1`
- `private_key_accessed: false`
- `off_host_decryption_verified: false`（需经过第 6 节离线恢复演练）

### 4.3 安装每日定时任务（macOS LaunchAgent，每日 04:15 JST）

```bash
ssh ts_x86_mac '/usr/local/bin/node /Users/colin/ThreeLANS/source-repository/scripts/backup/launchd.js \
  --hour 4 --minute 15 --tz Asia/Tokyo \
  --output /Users/colin/Library/LaunchAgents/com.threelans.core-backup.daily.plist'

ssh ts_x86_mac 'plutil -lint /Users/colin/Library/LaunchAgents/com.threelans.core-backup.daily.plist && launchctl bootstrap gui/$(id -u) /Users/colin/Library/LaunchAgents/com.threelans.core-backup.daily.plist'
```

> 说明：plist 中固定 `RunAtLoad = false`、`Umask = 0o077`，加载任务不会立即伪造计划运行；请等待次日 `04:15` 后查看状态确认首次 `scheduled` 运行成功。

查看运行状态：

```bash
ssh ts_x86_mac '/usr/local/bin/node /Users/colin/ThreeLANS/source-repository/scripts/backup/upload.js status --root /Users/colin/ThreeLANS/backups/google-drive'
```

---

## 5. 两步式独立离线恢复演练（假设 X86-MAC 已损毁）

在**控制端本机**（不连接 X86-MAC）执行：

### Step 1：联网下载并校验密文（不碰私钥）

```bash
node scripts/backup/restore.js download \
  --token-file ~/.threelans-core-recovery/drive-oauth/drive-token.json \
  --folder-id <drive-policy中的folder_id> \
  --recipient-sha256 <64位recipient_sha256>
```

记录输出中的 `archive_path` 与 `plan_path`。

### Step 2：纯离线解密与数据库重载验证（零网络请求）

```bash
node scripts/backup/restore.js verify <archive_path> \
  --plan <plan_path> \
  --private-key ~/.threelans-core-recovery/keys/recovery-private.pem
```

按提示隐藏输入私钥口令。通过标准：
- `status: "DRIVE_OFFLINE_RESTORE_VERIFIED"`
- `manifest_verified: true`
- `sqlite.integrity: "ok"` 且核心表行数与清单一致
- `network_accessed: false`、`plaintext_retained: false`（临时明文目录自动清理）

### 真实灾难恢复

如需落盘恢复，传入一个**空目录** `--extract-to /path/to/empty-restore-dir`，随后按 [Textbook_Courses_Runbook.md](Textbook_Courses_Runbook.md#8-%E6%81%A2%E5%A4%8D) 流程停止 `viewer`、移除旧 `.db-wal`/`.db-shm`、将 `db/trilingual_records.db`、`records/`、`textbook_work/`、`textbook_sources/` 分别还原到对应卷和路径，再启动 `viewer` 并核验 `/api/health`。

---

## 6. 凭据轮换与分级验收清单

- **OAuth 密钥轮换 / 吊销**：在 Google Cloud 控制台为 `three-lans-x86-mac-backup` 新建密钥并重新执行 `auth.js oauth --folder-id <原folder_id>`；确认新 token 上传验签通过后，立即停用并删除旧密钥。
- **验收证据严格分级**（不得互相替代）：
  1. 代码与单元测试通过（`npm test`、`npm run lint`、`npm run backup:drive:selftest`）；
  2. 首次真机手动上传并完成云端反向验签（`off_host_decryption_verified=false`）；
  3. 首次 LaunchAgent 无人值守 `scheduled` 定时运行成功；
  4. 用户持离线私钥完成独立两步离线恢复演练。
