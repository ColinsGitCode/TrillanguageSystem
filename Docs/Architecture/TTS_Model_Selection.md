# TTS 模型选型调研与决策（英文 / 日文语音 · 本地 CPU）

> 状态：**当前决策 + 历史实验归档** · 2026-07
> 约束：Mac · CPU 本地部署 · 零成本 / 隐私 · **教学发音准确性优先** · 自用（非对外服务）
> 关联：[Trilingual Card Generation System](Trilingual_Card_Generation_System.md)
> 影响文件：`services/generation/ttsService.js` · `lib/generationHelpers.js` · `services/observability/healthCheckService.js` · `services/storage/databaseHelpers.js` · `docker-compose.yml` · `.env.example` · TTS 相关测试

本文是三语学习系统 TTS 选型的真源。当前正式边界是：**中文只作为文本解释 / 翻译展示，不生成、不保存、不播放中文语音**。TTS 主线只覆盖英文和日文。

结论先行：

- **英文**：保持现有 Kokoro-82M，不升级。
- **日文**：正式默认回到 VOICEVOX；Style-Bert-VITS2 因系统开销大、效果提升有限，已封存为历史实验项。
- **中文**：明确不做 TTS。现有 `audio_tasks` 只生成 `en` / `ja` 是正确方向，不是缺口。

---

## 1. 当前正式边界

### 做什么

- 为英文例句生成英文语音。
- 为日文例句 / 日文场景表达生成日文语音。
- 日文优先提升自然度、汉字混排朗读、教学可懂度。
- 所有语音继续保存在本地 records 目录，并进入数据库 `audio_files` 记录。

### 不做什么

- 不生成中文语音。
- 不要求 prompt 产出 `zh` audio task。
- 不为中文文案注入播放按钮。
- 不在数据库中保存中文音频文件。
- 不为中文 TTS 增加容器、模型、健康检查或回归测试。

---

## 2. 现状与关键发现

| 语言 | 当前 TTS | 容器 | 输出 | 结论 |
|------|---------|------|------|------|
| 英语 | Kokoro-82M（`hexgrad/Kokoro-82M`，OpenAI `/v1/audio/speech` 接口，voice `af_bella`） | `dlaszlo/speech-service` (CPU int8) | mp3 | 保持 |
| 日语 | VOICEVOX（speaker 2） | `voicevox/voicevox_engine:cpu-latest` | wav | 保持默认 |
| 中文 | 无 | 无 | 无 | **保持无 TTS** |

关键发现：

- 当前生成链路只把英文 / 日文写入 `audio_tasks`，符合产品边界。
- 当前 `ttsService.js` 只支持 `en` / `ja`，也符合产品边界。
- 真正需要关注的是**日语语音质量 / 系统开销比**，不是补中文语音。
- 高质量多语 TTS 大多依赖 GPU；本项目仍以 Mac CPU 本地可用、低常驻内存为硬约束。

---

## 3. 候选模型对比（含许可维度）

| 模型 | 适用角色 | CPU·Mac | 质量 | 许可 | 自用可行 | 结论 |
|------|---------|---------|------|------|---------|------|
| **Kokoro-82M**（现英语） | 英文 TTS | 优秀 | 中上 | Apache-2.0 | 可行 | 英文保持 |
| **VOICEVOX**（现日语） | 日文默认 | 优秀 | 中（角色音） | 免费可商用；生成语音需按音声库规则署名 | 可行 | 保持默认 |
| **Style-Bert-VITS2** | 历史实验项 | CPU 可推理但常驻开销高 | 中上 | AGPL-3.0 + 部分 LGPL；具体 voice/model 另有条款 | 仅本地自用可接受 | **封存** |
| MeloTTS | 备选轻量 TTS | 良好 | 中上 | MIT | 可行 | 当前不优先 |
| Piper | 轻量 CPU-first | 优秀 | 中 | MIT | 可行 | 当前不优先 |
| CosyVoice2-0.5B | 未来统一升级 | 需 GPU 更现实 | 高 | Apache-2.0 | 本地 CPU 不优先 | 未来扩展位 |
| Fish-Speech S2 / IndexTTS-2 | 高质量 / zero-shot | GPU 门槛高 | 高 | 需逐项确认 | 当前不现实 | 不选 |

质量天花板仍受硬件约束影响。Mac CPU 本地优先时，Style-Bert-VITS2 的常驻内存和模型加载成本对当前学习卡工作流不划算；日语默认继续使用 VOICEVOX。

---

## 4. 许可维度（自用 vs 对外服务）

许可对选型有实质影响，且强依赖“是否对外提供服务”：

- **Kokoro-82M**：Apache-2.0，适合继续作为英文 TTS。
- **VOICEVOX**：软件可商用；使用生成语音时需要让人知道使用了 VOICEVOX，并遵守具体音声库条款。自用学习场景负担低。
- **Style-Bert-VITS2**：AGPL-3.0；本项目若只在 localhost / 本机自用，不对第三方开放网络访问，风险可接受。
- **SBV2 voice/model 资产**：预训练模型、社区音色、用户下载模型可能另有非商用、署名或再分发限制，接入前必须登记具体模型来源和条款。

边界要求：

- 如果未来把系统对外开放、部署到公网、给第三方账号使用，必须重新评估 SBV2 的 AGPL 和模型资产条款。
- 如果构建并分发包含 SBV2 的镜像，也必须重新评估源码和模型资产分发义务。

---

## 5. 选型决策

| 语言 | 决策 | 理由 |
|------|------|------|
| 英语 | **保持 Kokoro** | 已集成、CPU 友好、质量足够、Apache |
| 日语 | **VOICEVOX 作为默认；Style-Bert-VITS2 已封存** | VOICEVOX 稳定轻量，常驻开销低；SBV2 系统开销大，当前听感收益有限 |
| 中文 | **不做 TTS** | 中文在本系统中是解释 / 翻译文本，不需要朗读 |
| 未来（若有 GPU/上云） | CosyVoice2-0.5B | 多语言统一能力强，Apache；当前不符合本地 CPU 优先 |

> 用户决策（2026-07）：中文不需要语音；日语默认使用 VOICEVOX；Style-Bert-VITS2 因系统开销大、效果提升有限而封存，不从仓库中直接删除。

---

## 6. 当前落地架构：VOICEVOX 默认，SBV2 封存

当前正式运行链路是 **VOICEVOX-only**。Style-Bert-VITS2 代码和容器定义仅作为历史实验保留，不参与默认运行，不在 `.env.example` 中作为升级建议出现。中文不进入 TTS 链路。

### 6.1 `ttsService.js`

- 保持英文分支：`TTS_EN_TYPE=kokoro` → `requestOpenAiSpeechAudio`。
- 保持不支持 `zh`：如果未来遇到 `zh` audio task，应继续视为生成链路异常。
- 日语正式分支：`TTS_JA_TYPE=voicevox` → `requestVoicevoxAudio`。
- SBV2 分支可留在代码中作为封存实验路径；只有显式设置 `TTS_JA_TYPE=style_bert_vits2` 且配置 `TTS_JA_SBV2_ENDPOINT` 时才会进入。
- 每条生成结果继续返回实际 `provider` / `model` / `voice` / `status`，避免数据库误判历史音频来源。

### 6.2 `audioFormat.js`

- 英文继续默认 `mp3`。
- 日文继续默认 `wav`。
- VOICEVOX 输出 wav；封存的 SBV2 路径也输出 wav，音频格式规则无需变更。

### 6.3 数据库存储

`audio_files` 表已经有 `tts_provider`、`tts_model`、`tts_voice`、`status`、`format` 等列，**无需 schema 迁移**。需要改的是填值路径。

`databaseHelpers.prepareAudioFilesData` 已支持保存实际生成结果，而不是只按语言猜 provider：

- 英文：`kokoro`
- 日文默认：`voicevox`
- 历史 SBV2 音频：`style_bert_vits2`

关键数据流：

1. `generateAudioBatch` 调用具体 TTS 后，在 `audio.results[]` 中返回实际 `provider` / `model` / `voice` / `status`。
2. `buildPersistedAudioTasks` 把这些字段回填到对应 `audioTasks`。
3. `prepareAudioFilesData` 只读取任务上的实际字段并写入数据库，不再按 `task.lang` 推断。

需要新增填值：

- `tts_model`：`voicevox`、`hexgrad/Kokoro-82M`，或历史 SBV2 model id/name
- `tts_voice`：英文 voice（如 `af_bella`）、VOICEVOX speaker，或历史 SBV2 speaker/style
- `status`：`generated` / `fallback_generated` / `failed`

### 6.4 健康检查与观测

当前健康检查按配置动态检查：

- 默认只配置 `TTS_JA_ENDPOINT`，显示 `TTS Japanese (VOICEVOX)`。
- 如果人为配置封存的 `TTS_JA_SBV2_ENDPOINT`，健康检查会额外显示 SBV2 primary 与 VOICEVOX fallback。
- 日常运行不应配置 SBV2 endpoint。

### 6.5 `docker-compose.yml`

SBV2 服务保留为封存 profile，避免普通 profile 误启动：

```yaml
tts-ja-sbv2:
  profiles: ["archived-sbv2"]
  build:
    context: ./tts/style-bert-vits2
  container_name: trilingual-tts-ja-sbv2
  environment:
    - SBV2_DEVICE=cpu
  volumes:
    - sbv2_models:/models
  ports:
    - "5000:5000"
  restart: unless-stopped
```

注意：`archived-sbv2` 不是日常运行 profile。只有需要复查历史实验、重新做 A/B 对比或验证模型资产时才启动。

### 6.6 `.env.example`

```bash
# English -> Kokoro
TTS_EN_ENDPOINT=http://tts-en:8000/v1/audio/speech
TTS_EN_TYPE=kokoro
TTS_EN_MODEL=hexgrad/Kokoro-82M
TTS_EN_VOICE=af_bella
TTS_EN_SPEED=1.0

# Japanese -> VOICEVOX
TTS_JA_ENDPOINT=http://tts-ja:50021
TTS_JA_TYPE=voicevox
VOICEVOX_SPEAKER=2

# Archived Style-Bert-VITS2 experiment; leave unset for normal runs.
# TTS_JA_SBV2_ENDPOINT=http://tts-ja-sbv2:5000
```

---

## 7. SBV2 封存记录

Style-Bert-VITS2 已完成本地 POC 并被封存。封存原因：

1. **系统开销大**：本地 CPU warm 常驻约 2.8-3.0 GiB 容器内存，明显高于 VOICEVOX 的约 280-350 MiB。
2. **效果提升有限**：对当前学习卡短句、语法例句、场景表达的听感提升不足以抵消常驻成本和模型加载成本。
3. **运行复杂度更高**：需要额外模型资产、BERT 缓存、SBV2 服务和 fallback 监控。

保留内容：

- `tts/style-bert-vits2/`：历史 POC 服务代码。
- `docker-compose.yml` 的 `tts-ja-sbv2`：仅在 `archived-sbv2` profile 下可启动。
- `ttsService.js` 的 SBV2 分支：用于读取历史音频来源或未来重新评估。

---

## 8. 重新启用前必须实测验证

如果未来重新考虑启用 SBV2，学习场景仍然坚持 **发音准确 > 表现力**。切换默认日语后端前必须重新做小批 A/B 验证：

- **标准短句**：寒暖差、予約変更、引き継ぎ、確認事項等常用表达。
- **汉字混排**：维修、预约、沟通、业务交接类句子。
- **片假名外来词**：プロジェクト、エアコン、スケジュール等。
- **长句断句**：场景卡中 12 条常用表达连续生成。
- **运行开销**：记录 cold start、warm 常驻内存、批量生成时间。

验收标准：

- SBV2 生成成功率 >= 95%。
- 单条短句本地 CPU 生成时间可接受，批量 12 条不阻塞主要工作流。
- 至少 10 组 A/B 听感中，SBV2 在自然度或教学可懂度上**明显**优于 VOICEVOX。
- 常驻内存和启动成本必须有明确收益解释；否则保持封存。

---

## 9. 分阶段实施

| 阶段 | 范围 | 完成标准 |
|------|------|---------|
| **P0** | SBV2 独立 POC：本地 CPU 容器、模型资产、`/status`、`/models/info`、`/voice` | 已完成 |
| **P1** | `ttsService.js` 接入 SBV2 + VOICEVOX fallback | 已完成，但默认回退到 VOICEVOX-only |
| **P2** | 健康检查、DB provider/model/voice 记录、日志和测试补齐 | 已完成 |
| **P3** | 根据 A/B 结果把 SBV2 设为默认日语主后端 | **取消：系统开销大，效果提升有限** |
| **P4** | 未来扩展：GPU/上云时评估 CosyVoice2 | 当前不实施 |

---

## 10. 测试清单

- Unit：
  - `ttsService`：VOICEVOX-only、SBV2 历史分支、SBV2 失败回退、未配置 endpoint。
  - `generationHelpers`：把 `generateAudioBatch` 返回的实际 provider/model/voice/status 回填到 persisted audio tasks。
  - `databaseHelpers`：不再按语言猜 provider，按 task 上的实际字段保存 `tts_provider` / `tts_model` / `tts_voice`。
  - `healthCheckService`：VOICEVOX-only、历史 SBV2 primary online、primary offline fallback online、all offline。
- Integration：
  - 三语卡：英文 mp3 + 日文 wav。
  - 日语语法卡：日文 wav。
  - 场景表达卡：当前 prompt/校验要求 12 条英文 mp3 + 12 条日文 wav。
  - 不出现中文 audio task。
- Runtime smoke：
  - `docker compose up -d --build`
  - `curl /api/health` 或页面健康检查
  - 真实生成一张三语卡、一张语法卡、一张场景表达卡
  - 检查 records 目录、HTML 播放按钮、数据库 `audio_files`

---

## 11. Sources

- [Kokoro 官方仓库](https://github.com/hexgrad/kokoro)
- [Kokoro-82M Hugging Face Model Card](https://huggingface.co/hexgrad/Kokoro-82M)
- [Style-Bert-VITS2 官方仓库（litagin02）](https://github.com/litagin02/Style-Bert-VITS2)
- [Style-Bert-VITS2 `server_fastapi.py`](https://github.com/litagin02/Style-Bert-VITS2/blob/master/server_fastapi.py)
- [arXiv 2505.17320 · Style-Bert-VITS2 日语评测](https://arxiv.org/html/2505.17320v1)
- [VOICEVOX 利用規約](https://voicevox.hiroshiba.jp/term/)
- [GNU AGPLv3](https://www.gnu.org/licenses/agpl-3.0.en.html)
