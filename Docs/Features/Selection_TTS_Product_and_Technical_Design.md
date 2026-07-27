# 朗读选区 TTS 产品与技术设计（ST-D0）

> 状态：**Accepted · ST-01–ST-37 已实施并验收**
>
> 日期：2026-07-27；技术复审、用户确认与完整实施：2026-07-27
>
> 产品范围：桌面端学习卡片中的英文 / 日文选区按需朗读
>
> 上位约束：
> [Card Annotation Layer ADR](../Architecture/Card_Annotation_Layer_ADR.md)、
> [学习卡片选区交互与注解层 UX 评估](Card_Annotation_and_Selection_UX_Evaluation.md)、
> 根 `CLAUDE.md` 的 Markdown-first、桌面端和受控媒体边界

## 0. 一句话结论

“朗读选区”是一个独立的、按需生成的 TTS 工具。它读取 CardModal 已经确认的
ruby-free 可见选区，使用 Kokoro 生成英语、VOICEVOX 生成日语，并立即播放。

它不创建或修改 annotation、知识点、学习单元、Review Event、FSRS、卡片
Markdown 或教材官方原文。

## 1. 用户问题与目标

### 1.1 用户问题

当前学习卡已经有预生成的例句音频，但用户遇到下列情况时仍不能直接核对发音：

- 只想听一句话中的某个单词或短语；
- 想反复听刚刚标记的日语表达；
- 卡片没有为当前选区预生成音频；
- 需要较慢语速进行跟读；
- 不希望为了听发音而生成一张新卡。

### 1.2 v1 目标

用户选中英文或日文后，可以在现有选区工具条点击“朗读”：

1. 系统识别或要求确认语言；
2. 页面显示“生成中”；
3. TTS 返回后立即播放；
4. 用户可以停止、重播或切换语速；
5. 新播放自动停止当前卡片正在播放的其它音频。

### 1.3 成功指标

- 用户不离开当前卡片即可听到选区发音；
- 自动语言判断错误不能导致静默读错；
- 重复朗读相同内容时优先命中缓存；
- TTS 失败不能破坏标记、复制、KG 查询和生成卡片；
- CardModal 关闭后没有残留播放、Blob URL 或未结束请求；
- 不产生 annotation、KG、学习或 FSRS 写入。

## 2. 不在范围

v1 明确不做：

- 中文 TTS；
- 麦克风录音、ASR、发音评分；
- 自动判断纯汉字到底是中文还是日语；
- 自动把朗读内容保存为标记、知识点或学习单元；
- 用户自定义任意音色；
- 批量离线生成整张卡的所有选区；
- 移动端页面、移动端手势或移动端验收；
- 替换已有卡片例句音频、教材官方 Track 或教材单句 TTS。

这些能力如需开发，必须另立产品范围。

## 3. 当前实现事实

### 3.1 已有能力

- `services/generation/ttsService.js` 已支持：
  - 英语 Kokoro；
  - 日语 VOICEVOX；
  - 按任务指定英语速度与音色；
  - 返回 provider / model / voice / content type；
- CardModal 已有 ruby-aware 选区合同：
  - `rt/rp` 注音不进入选区短语；
  - 音频按钮和外来语标签不进入选区短语；
  - 显示、生成卡片与 annotation selector 共用可见基文投影；
- CardModal 已有单个 `audioRef`，能停止上一段卡片音频；
- 教材课程已经验证官方 Track 与生成 TTS 互斥；
- 当前运行模型是英语 Kokoro、日语 VOICEVOX；SBV2 仅保留为 archived profile。

### 3.2 实施前缺口（现已关闭）

- 没有通用的“文本 → 即时音频”HTTP 接口；
- `generateAudioBatch()` 强制要求输出目录和文件名，不适合即时二进制响应；
- `audio_files` 绑定永久 generation，不适合临时选区缓存；
- CardModal 没有生成中、停止、重播、失败重试状态；
- 各页面各自持有 audio ref，尚无可复用的独占播放 hook；
- VOICEVOX 当前 wrapper 尚未把产品语速映射到 `speedScale`；
- generation worker 与 HTTP viewer 在同一进程中，选区朗读和后台卡片生成会请求
  同一组 Kokoro / VOICEVOX 容器；
- `generateAudioBatch()` 严格串行；场景卡 20 个表达最多产生 40 个连续 TTS
  请求。`SELECTION_TTS_MAX_CONCURRENCY` 只能限制选区请求自身，不能解决它和
  generation worker 的跨业务争用。

## 4. 产品交互设计

### 4.1 工具条入口

在 CA-I1 选区工具条加入熟悉的扬声器图标按钮：

```text
已选 subject matter | 标记 | 朗读 | 复制 | 查知识点 | 生成卡片
```

图标必须有 `aria-label="朗读选区"` 和 tooltip。按钮尺寸沿用现有紧凑图标动作，
不扩大工具条高度。

### 4.2 语言判断

| 选区特征 | 默认行为 |
|---|---|
| 只有拉丁字母、数字和英文标点 | 默认 English |
| 包含平假名或片假名 | 默认日本語 |
| 只有汉字 | 不猜；要求确认“按日语朗读”或取消 |
| 英日混合且无法可靠判断 | 要求选择 English / 日本語 |
| 明确是中文解释 | 提示“当前不提供中文朗读” |

语言判断只决定 UI 默认值，服务器仍必须校验显式 `language`。

### 4.3 语速

v1 使用三个固定档位：

- `0.8×`：跟读；
- `1.0×`：默认；
- `1.2×`：快速核对。

不允许用户输入任意浮点数。英语直接传给 Kokoro；日语把档位映射到 VOICEVOX
`audio_query` 的 `speedScale`。

### 4.4 状态机

```text
idle
  └─ click play
       ├─ needs-language-confirmation
       └─ loading
            ├─ playing
            │    ├─ stop -> idle
            │    └─ ended -> ready
            ├─ ready -> replay -> playing
            └─ error -> retry / change-language / idle
```

页面状态文案：

| 状态 | 表现 |
|---|---|
| idle | 扬声器图标 |
| needs-language-confirmation | 小型语言确认浮层 |
| loading | spinner + “正在生成发音” |
| playing | 停止图标 + 播放强调色 |
| ready | 重播图标 |
| error | “发音生成失败” + 重试 |

### 4.5 键盘与焦点

- 选区工具条现有 Left/Right/Home/End 导航必须包含朗读按钮；
- Enter / Space 触发朗读；
- Escape 先关闭语言确认浮层，再关闭工具条；
- 请求失败后焦点回到朗读按钮；
- CardModal 关闭时停止音频、abort 请求并 revoke Blob URL；
- 不新增全局快捷键，避免与浏览器和文本选择冲突。

## 5. 语言与文本合同

### 5.1 输入文本

CardModal 必须发送 `toolbar.phrase`，即与用户看到的“已选”预览完全一致的
normalized ruby-free 可见文字。不得使用包含 `<rt>` 注音或 HTML 的字符串。

### 5.2 服务端规范化

服务端仅执行：

- Unicode 字符串校验；
- trim；
- 合并连续空白；
- 移除不可见控制字符；
- 长度检查。

服务端不得：

- 翻译或改写文本；
- 自动补全标点；
- 调用 LLM；
- 把日语汉字转换成假名后再存为事实；
- 对英语做大小写折叠后改变朗读文本。

### 5.3 长度

- 当前 CardModal 使用 JavaScript `normalized.length`，即最大 200 个 UTF-16
  code units；
- ST-P2 推荐将客户端改成 `Array.from(normalized).length`，统一为最大 200 个
  Unicode code points；迁移前不得把这两个口径描述成完全相同；
- API 防御性上限为 300 个 Unicode code point；
- 空文本返回 400；
- 超限返回 413；
- v1 不自动截断，避免只朗读半句。

## 6. HTTP 接口

### 6.1 Route

新增独立 route：

```text
GET /api/tts/selection
POST /api/tts/selection
```

挂载到 `lib/httpRuntime.createApp()`。不得挂进 annotations、files、textbooks 或
learning route。GET 只返回是否启用、支持语言、速度和最大长度；POST 才执行合成。

### 6.2 Request

```json
{
  "text": "subject matter",
  "language": "en",
  "speed": 1.0
}
```

字段合同：

| 字段 | 必填 | 规则 |
|---|---|---|
| `text` | 是 | 1–300 code points，纯文本 |
| `language` | 是 | `en` 或 `ja` |
| `speed` | 是 | `0.8`、`1.0`、`1.2` |

v1 不接受前端传任意 provider、model、voice、speaker 或输出路径。模型和音色继续
由服务端配置统一控制。

### 6.3 Binary Response

成功直接返回音频二进制：

```http
200 OK
Content-Type: audio/mpeg
X-TTS-Provider: kokoro
X-TTS-Model: hexgrad/Kokoro-82M
X-TTS-Voice: af_bella
X-TTS-Cache: HIT
```

以上 model、voice 和 content type 是**当前本地配置的示例**，不是协议常量。
实际 header 必须来自服务端配置和 provider 响应；修改 `TTS_EN_MODEL`、
`TTS_EN_VOICE` 或 provider 输出格式后，响应应随之变化。

当前日语 provider 返回 `audio/wav`。浏览器使用
`fetch → Blob → URL.createObjectURL → Audio` 播放，并在结束、替换或卸载时
revoke URL。

### 6.4 Error Contract

| 状态 | code | 含义 |
|---|---|---|
| 400 | `SELECTION_TTS_INVALID_INPUT` | 文本、语言或速度非法 |
| 404 | `SELECTION_TTS_DISABLED` | feature flag 未开启 |
| 413 | `SELECTION_TTS_TEXT_TOO_LONG` | 文字超过限制 |
| 429 | `SELECTION_TTS_BUSY` | 并发超过限制 |
| 502 | `SELECTION_TTS_PROVIDER_FAILED` | Kokoro / VOICEVOX 失败 |
| 504 | `SELECTION_TTS_TIMEOUT` | TTS 超时 |

错误响应使用现有 JSON envelope；不得返回 provider 原始堆栈、绝对路径或输入文本。

## 7. 服务拆分

### 7.1 Provider 层

从 `ttsService.js` 抽出不写文件的公开能力：

```js
synthesizeSpeech({
  text,
  language,
  speed,
  signal
}) -> {
  buffer,
  contentType,
  ttsProvider,
  ttsModel,
  ttsVoice,
  status
}
```

现有 `generateAudioBatch()` 改为调用它后再写文件。这样卡片生成、教材 TTS 与
选区朗读共享同一 provider 行为，不复制 Kokoro / VOICEVOX 请求代码。

### 7.2 Application Service

新增：

```text
services/selectionTts/selectionTtsService.js
```

职责：

- 校验和规范化请求；
- 生成缓存 key；
- 限制并发；
- 合并同 key 的并发请求；
- 读取 / 写入缓存；
- 调用 `synthesizeSpeech()`；
- 返回安全 metadata；
- 记录耗时、cache hit / miss 和失败类型。

它不得依赖 AnnotationService、KG、LearningService 或 DatabaseService。

### 7.3 Route

新增：

```text
routes/selectionTts.js
```

route 只负责 HTTP 映射、headers 和 error envelope，不直接请求 TTS provider。

### 7.4 跨业务 TTS 争用门禁

选区朗读的本地并发限制不能约束 generation worker。ST-P0 必须在以下两种状态
分别测量英语和日语延迟：

1. TTS 容器空闲；
2. 一张 20 表达场景卡正在生成最多 40 条语音。

记录至少包括首包时间、总时间、timeout、失败率、viewer CPU / memory 与 TTS
容器 CPU / memory。测量完成后才能在下列策略中做正式决定：

- **直接并发 + 忙碌提示**：实现简单，但最坏延迟可能不可控；
- **进程内共享协调器**：交互请求优先排在 batch 的下一条任务之前，不中断已经
  开始的 provider 请求，并设置防止 batch 饥饿的上限；
- **独立 TTS 容量**：只在前两种方案仍无法满足交互延迟时评估。

ST-P0 必须写明选择哪种策略以及可接受延迟。完成该门禁前，15 秒 timeout 和
最大并发 2 都只是待验证建议值，不是 Accepted 参数。

ST-P0 实测后采用**进程内共享协调器**：交互请求优先进入下一执行位，已经开始的
provider 请求不中断，批量任务等待 5 秒后获得一次执行机会。真实 Compose 争用
测试中，6/6 个交互请求成功，p50 为 1,891 ms、p95/max 为 2,923 ms；40 个批量
任务 40/40 成功。因此接受 15 秒 timeout、共享最大并发 2 和 600 ms 忙碌提示，
不增加第二套 TTS 容量。

## 8. 独立缓存

### 8.1 为什么不使用数据库

选区音频是临时计算结果，不是卡片正式媒体：

- 没有稳定 generation id；
- 不应进入 `audio_files`；
- 不应进入 `card_annotations`；
- 删除 annotation 不应删除或改变 TTS 缓存；
- 重建缓存不能影响任何业务事实。

### 8.2 路径与 Compose

新增独立配置：

```text
SELECTION_TTS_CACHE_PATH=/data/selection_tts_cache
```

Compose 使用独立 named volume：

```yaml
selection_tts_cache:/data/selection_tts_cache
```

缓存不放进 `RECORDS_PATH`，避免出现在 Cards Factory 文件夹浏览范围；也不放进
教材工作目录。

### 8.3 Cache Key

SHA-256 输入：

```json
{
  "version": 1,
  "language": "en",
  "text": "subject matter",
  "speed": 1.0,
  "provider": "kokoro",
  "model": "hexgrad/Kokoro-82M",
  "voice": "af_bella"
}
```

用户输入不得成为文件名。磁盘只出现 opaque hash + 受控扩展名。

### 8.4 生命周期

推荐默认值：

- TTL：7 天；
- 最大空间：256 MiB；
- 最大并发 provider 请求：2；
- 单请求 timeout：15 秒；
- 同 key 并发请求合并为一个 Promise；
- 写入使用临时文件 + atomic rename；
- 启动时和写入后做有界清理；
- 缓存损坏时删除并重新生成，不影响业务数据；
- 缓存目录只读、磁盘写满或 atomic rename 失败时，降级为
  `X-TTS-Cache: BYPASS` 并直接返回已生成音频；缓存故障不得把成功的 provider
  响应变成用户可见失败。

这些值必须可通过环境变量覆盖，并在 §7.4 争用测试后才能定稿。

## 9. 播放所有权

### 9.1 CardModal v1

CardModal 中“预生成例句音频”和“朗读选区”必须共享一个独占播放 owner：

- 播放选区前停止例句音频；
- 播放例句前停止选区音频；
- 新选区、换卡、切 tab、关闭弹窗时停止选区音频，并 abort 尚未完成的选区 TTS
  HTTP 请求；
- 失败不清除用户文字选区。

已抽出：

```text
app/lib/audio/exclusive-audio.ts
```

CardModal 首先完成验收，随后 Textbook Courses 与 Review Session 迁移复用。

### 9.2 后续横向接入

CardModal 验收稳定后，Textbook Courses 与 Review Session 可以迁移到同一 hook，
统一官方 Track、教材单句 TTS、卡片音频与选区朗读的互斥行为。

此迁移不能改变教材“官方 Track 与系统 TTS 来源独立”的产品含义。

## 10. Feature Flag 与配置

新增：

```text
SELECTION_TTS_ENABLED=0
SELECTION_TTS_CACHE_PATH=/data/selection_tts_cache
SELECTION_TTS_MAX_CHARS=300
SELECTION_TTS_TIMEOUT_MS=15000
SELECTION_TTS_MAX_CONCURRENCY=2
SELECTION_TTS_CACHE_TTL_HOURS=168
SELECTION_TTS_CACHE_MAX_BYTES=268435456
```

阶段规则：

1. 代码和 `.env.example` 的安全默认值保持关闭；
2. 本地 Compose 在 ST-P4 完整验收后默认开启；
3. 真实 Kokoro / VOICEVOX smoke、桌面 E2E、缓存清理和零业务写入均已通过；
4. 关闭 flag 后工具条隐藏朗读按钮，其它 CA-I1 功能保持不变。

实现额外提供只读 `GET /api/tts/selection` 配置发现接口，让前端在 flag 关闭时
稳定隐藏入口；`POST /api/tts/selection` 仍是二进制合成接口。

## 11. 安全、隐私与可观测性

### 11.1 安全

- 只接受 JSON 纯文本；
- 不接受 HTML、SSML、文件路径、URL 或 provider 参数；
- 不将用户文本拼进命令、路径或日志；
- 缓存文件只能通过服务内部 hash 访问，不暴露通用静态目录；
- provider 响应大小设置上限；
- 客户端断开时 abort provider 请求；
- 不使用 `express.static` 暴露缓存。

### 11.2 日志

记录：

- request id；
- language；
- 字符数；
- speed；
- provider / model / voice；
- cache hit / miss；
- 总耗时；
- 失败 code。

不记录：

- 完整选区文本；
- annotation id；
- 卡片 Markdown；
- 教材官方原文；
- 绝对缓存路径。

### 11.3 健康检查

不新增第三套 TTS 健康源。选区 TTS 复用现有 Kokoro / VOICEVOX health 状态，
另增加缓存目录可写和剩余空间诊断。

## 12. 测试设计

### 12.1 Unit

- 语言判断：英文、假名、纯汉字、英日混合；
- ruby-free selection 继续成立；
- speed whitelist；
- code point 长度；
- cache key 稳定且模型 / 音色 / 速度变化会换 key；
- 缓存 hit / miss / bypass / corruption / TTL / size cleanup；
- 缓存写满或只读时仍返回已生成音频；
- 同 key 请求合并；
- Kokoro 与 VOICEVOX 路由；
- VOICEVOX speedScale 映射；
- abort、timeout、provider failure。

### 12.2 Integration

- feature flag 关闭返回 404；
- 英语返回 `audio/mpeg`；
- 日语返回 `audio/wav`；
- 第二次请求返回 cache HIT；
- 非法语言 / 速度 / 空文本 / 超长文本；
- provider 错误不暴露堆栈或路径；
- 请求前后 annotation、KG、learning 表哈希一致；
- API-only `server.js` harness 显式挂载 route。

### 12.3 Desktop E2E

- 英文选区一键朗读；
- 假名选区一键朗读；
- 纯汉字必须确认语言；
- 三档语速；
- loading / playing / ready / error / retry；
- 播放选区会停止卡片例句音频；
- 播放例句会停止选区音频；
- 新选区、换卡、切 tab、关闭弹窗时 abort 请求、停止并清理；
- 键盘访问和焦点恢复；
- feature flag 关闭后按钮消失；
- 1280×720 与 1440×900 无溢出；
- `readOnly` 卡片允许朗读，但仍禁止修改 annotation。

### 12.4 Runtime

- 真实 Kokoro 英语 smoke；
- 真实 VOICEVOX 日语 smoke；
- 场景卡 40 条批量 TTS 进行中重复英日选区 smoke，记录争用延迟和失败率；
- cache MISS → HIT；
- 缓存卷重建不影响 SQLite 与 records；
- 四容器 health online；
- npm audit、lint、typecheck、unit、integration、architecture、E2E、smoke 全绿。

不做移动端测试。

## 13. 分阶段开发任务

### Gate 0：基线与防回归（4 项）

- [x] ST-01 记录当前 CardModal 例句播放、教材音频与 Review 播放测试基线；
- [x] ST-02 固化 annotation / KG / learning 表只读哈希检查；
- [x] ST-03 为英语 Kokoro、日语 VOICEVOX 建立隔离 provider fixture；
- [x] ST-04 记录 Compose volume、健康状态和回滚步骤。

### ST-P0：无文件合成与争用 POC（6 项）

- [x] ST-05 从 `ttsService.js` 抽出 `synthesizeSpeech()`；
- [x] ST-06 让 `generateAudioBatch()` 复用新函数并保持原测试全绿；
- [x] ST-07 补 Kokoro buffer / metadata 合同测试；
- [x] ST-08 补 VOICEVOX buffer / speedScale / metadata 合同测试；
- [x] ST-09 真实英日短句 POC，确认空闲状态首包耗时与音频格式；
- [x] ST-10 在场景卡最多 40 条批量 TTS 生成期间测量选区朗读，并确认共享争用
      策略、timeout、并发和用户忙碌提示。

### ST-P1：独立 API 与缓存（8 项）

- [x] ST-11 新增 server config 与默认关闭的 feature flag；
- [x] ST-12 新增 `SelectionTtsService` 输入校验和 provider 调用；
- [x] ST-13 实现 cache key、原子写、TTL、空间清理与写失败 BYPASS；
- [x] ST-14 实现最大并发、同 key Promise 合并和 ST-P0 确认的共享争用策略；
- [x] ST-15 实现 timeout、abort 与响应大小限制；
- [x] ST-16 新增 `routes/selectionTts.js` 与 binary headers；
- [x] ST-17 挂载 `httpRuntime` 并补 API-only integration harness；
- [x] ST-18 新增 Compose 独立 cache volume 与 `.env.example`。

### ST-P2：CardModal UI（8 项）

- [x] ST-19 增加工具条朗读图标和 tooltip；
- [x] ST-20 实现语言推断与纯汉字确认浮层；
- [x] ST-21 实现 0.8× / 1.0× / 1.2× 语速控件；
- [x] ST-22 实现 loading / playing / ready / error / retry 状态；
- [x] ST-23 实现 fetch Blob、abort 与 Blob URL 清理；
- [x] ST-24 抽出 CardModal 独占播放 hook；
- [x] ST-25 纳入工具条键盘导航、Escape 与焦点恢复；
- [x] ST-26 覆盖 editable / readOnly、亮色 / 暗色桌面状态。

### ST-P3：播放互斥与横向复用（5 项）

- [x] ST-27 验证选区朗读与卡片例句音频互斥；
- [x] ST-28 评估 Textbook Courses 迁移到共享 audio hook；
- [x] ST-29 评估 Review Session 迁移到共享 audio hook；
- [x] ST-30 保证教材官方 Track 与系统 TTS 来源标识不混淆；
- [x] ST-31 补跨页面切换、卸载和后台活动回归。

### ST-P4：验收与发布（6 项）

- [x] ST-32 跑 lint、typecheck、unit、integration、architecture；
- [x] ST-33 跑全量 desktop E2E、visual 与 smoke；
- [x] ST-34 重建 `three_lans_system` 并做真实英日 TTS smoke；
- [x] ST-35 验证批量场景卡生成中的选区延迟、MISS → HIT、BYPASS、缓存清理和
      独立 volume；
- [x] ST-36 验证真实 SQLite / records / annotation / KG / learning 零写入；
- [x] ST-37 写验收报告、运行手册并更新 Docs 索引。

## 14. 回滚

### UI 回滚

设置：

```text
SELECTION_TTS_ENABLED=0
```

并重建 viewer。朗读按钮消失，CA-I1 的标记、复制、KG 查询和生成卡片继续工作。

### 服务回滚

- route 和 service 可整体停止使用；
- 缓存 volume 可删除或保留；
- 不需要数据库 downgrade；
- 不需要重放 annotation 或学习事件；
- 现有预生成卡片音频和教材 TTS 不受影响。

## 15. 评审门禁

进入实施前必须确认：

- [x] v1 仅支持英文和日文，不支持中文；
- [x] 纯汉字不自动判断语言；
- [x] 使用 0.8× / 1.0× / 1.2× 三档语速；
- [x] v1 使用服务端固定音色，不开放任意音色；
- [x] API 返回即时二进制，不创建 `audio_files`；
- [x] 缓存使用独立 volume，不使用 SQLite；
- [x] 不记录完整选区文本；
- [x] annotation、KG、learning 与 FSRS 零写入；
- [x] CardModal 是第一个正式消费者；
- [x] Textbook / Review 只在 CardModal 验收后迁移播放 hook；
- [x] 正式范围仅为桌面端；
- [x] ST-P0 已测量场景卡批量生成期间的 TTS 争用，并确认共享争用策略与最终参数；
- [x] 本文经用户确认后，状态才可翻为 Accepted。

## 16. 最终结论

ST-01–ST-37 已按本文全部实施，真实英日 TTS、40 条批量争用、缓存
MISS/HIT/BYPASS/清理、桌面交互、播放互斥、容器重建和零业务写入均已验收。

权威运行记录：

- [ST-P4 验收报告](../TestReports/Selection_TTS_ST_P4_Acceptance_20260727.md)；
- [朗读选区 TTS 运行手册](../Operations/Selection_TTS_Runbook.md)。

后续中文 TTS、ASR、发音评分或移动端能力不得隐式扩入本基线，必须重新立项。

## 17. 实施记录

### 17.1 Gate 0

- 实施前基线：unit 372/372、integration 62/62、lint/typecheck 通过；
- 已有 CardModal、Textbook Courses 与 Review Session 播放路径已记录；
- `selectionTtsDataIntegrity.js` 固化 SQLite 业务表与 records 内容级只读 hash；
- 回滚不需要数据库 downgrade，仅关闭 feature flag 和重建 viewer。

### 17.2 ST-P0 / P1

- provider 层保留内存 buffer 与元数据，文件写入仍只属于 batch 层；
- VOICEVOX 三档速度已映射为 `speedScale`；
- 新增共享优先级协调器、独立 Selection TTS service、route 与缓存；
- 缓存写失败使用 `BYPASS`，不会把成功音频变成失败；
- 独立 volume 为 `three_lans_system_selection_tts_cache`。

### 17.3 ST-P2 / P3

- CardModal 完成保守语言推断、纯汉字确认、速度、播放状态与错误重试；
- 语言确认框支持首焦点、`Escape` 关闭和焦点恢复；
- CardModal、Textbook Courses 和 Review Session 迁移到共享独占播放 owner；
- 教材官方 Track 与系统 TTS 的来源标识保持独立。

### 17.4 ST-P4

- 最终 unit 391/391、integration 65/65、desktop E2E/visual 53/53；
- lint、typecheck、architecture/build、smoke 7/7、npm audit high 全部通过；
- `three_lans_system` 已用最终源码重建，真实 health 与英日 API smoke 通过；
- 真实 SQLite 与 records 在全部运行测试前后保持内容 hash 一致。
