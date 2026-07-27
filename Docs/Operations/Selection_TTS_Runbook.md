# 朗读选区 TTS 运行手册

> 适用范围：桌面端 CardModal 英文/日文选区朗读
>
> 运行项目：`three_lans_system`

## 1. 正常启停

本地 Compose 默认开启：

```bash
docker compose up -d --build
curl -fsS http://127.0.0.1:3010/api/health
curl -fsS http://127.0.0.1:3010/api/tts/selection
```

代码与 `.env.example` 的安全默认值仍为关闭。Compose 本地部署通过
`SELECTION_TTS_ENABLED=true` 开启。

关闭功能：

```bash
SELECTION_TTS_ENABLED=false docker compose up -d --build viewer
```

关闭后 `GET /api/tts/selection` 会报告 `enabled: false`，POST 返回 404，CardModal
不显示朗读按钮。标记、复制、知识点查询、生成卡片和已有音频保持可用。

## 2. 关键配置

| 环境变量 | 默认值 | 含义 |
|---|---:|---|
| `SELECTION_TTS_ENABLED` | `false` | 总开关 |
| `SELECTION_TTS_CACHE_PATH` | `/data/selection_tts_cache` | 独立缓存目录 |
| `SELECTION_TTS_MAX_CHARS` | `300` | 服务端 code point 上限 |
| `SELECTION_TTS_TIMEOUT_MS` | `15000` | provider timeout |
| `SELECTION_TTS_MAX_CONCURRENCY` | `2` | 共享 provider 并发 |
| `SELECTION_TTS_CACHE_TTL_HOURS` | `168` | 缓存 TTL |
| `SELECTION_TTS_CACHE_MAX_BYTES` | `268435456` | 缓存上限 256 MiB |

不要把缓存路径改到 `RECORDS_PATH`、教材媒体目录或 SQLite volume。

## 3. 快速诊断

### 3.1 页面没有朗读按钮

1. 请求 `GET /api/tts/selection`；
2. 确认返回 `enabled: true`；
3. 检查 viewer 的 `SELECTION_TTS_ENABLED`；
4. 修改环境变量后必须重建 viewer。

### 3.2 英文或日文失败

```bash
docker compose ps
curl -fsS http://127.0.0.1:3010/api/health
docker compose logs --tail=200 viewer tts-en tts-ja
```

英文依赖 Kokoro，日文依赖 VOICEVOX。SBV2 仍是封存 profile，不是默认链路。

常见错误码：

| code | 含义 |
|---|---|
| `SELECTION_TTS_INVALID_INPUT` | 文本、语言或速度不合法 |
| `SELECTION_TTS_TEXT_TOO_LONG` | 选区超过上限 |
| `SELECTION_TTS_BUSY` | 交互请求过多 |
| `SELECTION_TTS_PROVIDER_FAILED` | Kokoro 或 VOICEVOX 失败 |
| `SELECTION_TTS_TIMEOUT` | provider 超时 |

### 3.3 缓存诊断

响应头含义：

- `X-TTS-Cache: MISS`：首次生成并写入缓存；
- `X-TTS-Cache: HIT`：直接读取缓存；
- `X-TTS-Cache: BYPASS`：缓存写入失败，但 provider 音频仍成功返回。

`/api/health` 的 `Selection TTS Cache` 只报告可写性和剩余空间，不暴露宿主机绝对
路径。

## 4. 争用行为

选区朗读和场景卡批量语音共用 Kokoro/VOICEVOX：

- 已开始的 provider 请求不会被中断；
- 等待中的交互朗读优先进入下一执行位；
- 批量任务等待 5 秒后获得一次机会，避免永远排不到；
- 页面等待超过 600 ms 会显示“发音服务正忙”；
- 15 秒仍未完成时返回 timeout，用户可以重试。

不要通过增加前端并发绕开协调器。只有真实 POC 再次证明当前容量不足，才评估独立
TTS 容量。

## 5. 缓存清理与恢复

缓存是可丢弃的计算结果，不需要随 SQLite 备份：

```bash
docker volume ls | grep selection_tts_cache
docker compose stop viewer
docker compose rm -f viewer
docker volume rm three_lans_system_selection_tts_cache
docker compose up -d viewer
```

删除缓存 volume 后，下一次朗读会重新生成。该操作不得删除数据库、records、
教材源文件或教材工作目录。

服务运行时会自动执行 TTL 和空间上限清理；不要手工修改 hash 文件或 metadata。

## 6. 回滚

最小回滚：

1. 设置 `SELECTION_TTS_ENABLED=false`；
2. 重建 viewer；
3. 验证朗读按钮消失；
4. 验证标记、复制、知识点查询、生成卡片和既有音频仍正常。

不需要：

- 数据库 migration 或 downgrade；
- 重放 annotation、KG、learning 或 Review Event；
- 恢复 `audio_files`；
- 恢复 records。

如需删除缓存，按 §5 单独处理。不要把缓存问题扩大成业务数据恢复。

## 7. 发布后检查

```bash
npm run lint
npm run typecheck:react
npm run test:unit
npm run test:integration
npm run test:architecture
npm run test:e2e
npm run smoke
npm audit --audit-level=high
```

运行态还必须确认：

- 四个容器在线；
- `/api/health` 为 200；
- 英语 `MISS → HIT`；
- 日语 `MISS → HIT`；
- 卡片例句、教材官方 Track、教材单句 TTS、复习音频和选区朗读保持独占播放；
- SQLite 与 records 的只读审计 hash 不变化。
