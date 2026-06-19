# TTS 模型选型调研与决策（英文 / 日文语音 · 本地 CPU）

> 状态：**调研 + 选型决策（待实施）** · 2026-06
> 约束：Mac · CPU 本地部署 · 零成本 / 隐私 · **教学发音准确性优先** · 自用（非对外服务）
> 关联：[Trilingual Card Generation System](Trilingual_Card_Generation_System.md)
> 影响文件：`services/generation/ttsService.js` · `lib/generationHelpers.js` · `services/observability/healthCheckService.js` · `services/storage/databaseHelpers.js` · `docker-compose.yml` · `.env.example` · TTS 相关测试

本文是三语学习系统 TTS 选型的真源。当前正式边界是：**中文只作为文本解释 / 翻译展示，不生成、不保存、不播放中文语音**。TTS 主线只覆盖英文和日文。

结论先行：

- **英文**：保持现有 Kokoro-82M，不升级。
- **日文**：引入 Style-Bert-VITS2 做主后端候选，通过 POC 后设为主；VOICEVOX 保留作 fallback。
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
| 日语 | VOICEVOX（speaker 2） | `voicevox/voicevox_engine:cpu-latest` | wav | 升级主后端候选 |
| 中文 | 无 | 无 | 无 | **保持无 TTS** |

关键发现：

- 当前生成链路只把英文 / 日文写入 `audio_tasks`，符合产品边界。
- 当前 `ttsService.js` 只支持 `en` / `ja`，也符合产品边界。
- 真正需要升级的是**日语语音质量**，不是补中文语音。
- 高质量多语 TTS 大多依赖 GPU；本项目仍以 Mac CPU 本地可用为硬约束。

---

## 3. 候选模型对比（含许可维度）

| 模型 | 适用角色 | CPU·Mac | 质量 | 许可 | 自用可行 | 结论 |
|------|---------|---------|------|------|---------|------|
| **Kokoro-82M**（现英语） | 英文 TTS | 优秀 | 中上 | Apache-2.0 | 可行 | 英文保持 |
| **VOICEVOX**（现日语） | 日文 fallback | 优秀 | 中（角色音） | 免费可商用；生成语音需按音声库规则署名 | 可行 | 保留备用 |
| **Style-Bert-VITS2** | 日文主后端候选 | CPU 可推理，需实测延迟 | 高（日语自然度） | AGPL-3.0 + 部分 LGPL；具体 voice/model 另有条款 | 仅本地自用可接受 | POC 后接入 |
| MeloTTS | 备选轻量 TTS | 良好 | 中上 | MIT | 可行 | 当前不优先 |
| Piper | 轻量 CPU-first | 优秀 | 中 | MIT | 可行 | 当前不优先 |
| CosyVoice2-0.5B | 未来统一升级 | 需 GPU 更现实 | 高 | Apache-2.0 | 本地 CPU 不优先 | 未来扩展位 |
| Fish-Speech S2 / IndexTTS-2 | 高质量 / zero-shot | GPU 门槛高 | 高 | 需逐项确认 | 当前不现实 | 不选 |

质量天花板仍受硬件约束影响。Mac CPU 本地优先时，日语升级最务实路径是 Style-Bert-VITS2 POC，而不是引入大型多语 GPU 模型。

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
| 日语 | **Style-Bert-VITS2 为主后端候选，VOICEVOX 保留作 fallback** | SBV2 日语自然度更高，适合教学听感；VOICEVOX 稳定轻量，适合作备用 |
| 中文 | **不做 TTS** | 中文在本系统中是解释 / 翻译文本，不需要朗读 |
| 未来（若有 GPU/上云） | CosyVoice2-0.5B | 多语言统一能力强，Apache；当前不符合本地 CPU 优先 |

> 用户决策（2026-06）：中文不需要语音；日语主用 Style-Bert-VITS2 的方向保留，VOICEVOX 保留作备用，不直接删除。

---

## 6. 落地架构：日语主备 fallback

核心是让日语 TTS 可在 **Style-Bert-VITS2（主）↔ VOICEVOX（备）** 间切换 / 回退。中文不进入这条链路。

### 6.1 `ttsService.js`

- 保持英文分支：`TTS_EN_TYPE=kokoro` → `requestOpenAiSpeechAudio`。
- 保持不支持 `zh`：如果未来遇到 `zh` audio task，应继续视为生成链路异常。
- 新增 `requestStyleBertVits2Audio(task)`：
  - endpoint：`TTS_JA_SBV2_ENDPOINT`
  - API：SBV2 官方 `server_fastapi.py` 的 `/voice`
  - 输出：`audio/wav`
  - 参数：`text`、`model_id` / `model_name`、`speaker_id` / `speaker_name`、`style`、`length` 等按 POC 结果确定
- 改造日语分支：
  - `TTS_JA_TYPE=style_bert_vits2` 时优先请求 SBV2。
  - SBV2 未配置、超时或非 2xx 时回退 VOICEVOX。
  - 每条生成结果必须返回实际 `provider` / `model` / `voice` / `status`，例如 `style_bert_vits2` 成功、`voicevox` fallback 成功或失败原因。

### 6.2 `audioFormat.js`

- 英文继续默认 `mp3`。
- 日文继续默认 `wav`。
- SBV2 与 VOICEVOX 均输出 wav，原则上无需改格式规则。

### 6.3 数据库存储

`audio_files` 表已经有 `tts_provider`、`tts_model`、`tts_voice`、`status`、`format` 等列，**无需 schema 迁移**。需要改的是填值路径。

当前 `databaseHelpers.prepareAudioFilesData` 按语言硬编码 `en -> kokoro`、其它 -> `voicevox`。接入 SBV2 后必须改为保存实际生成结果，而不是按语言猜 provider：

- 英文：`kokoro`
- 日文主成功：`style_bert_vits2`
- 日文 fallback：`voicevox`

关键数据流：

1. `generateAudioBatch` 调用具体 TTS 后，在 `audio.results[]` 中返回实际 `provider` / `model` / `voice` / `status`。
2. `buildPersistedAudioTasks` 把这些字段回填到对应 `audioTasks`。
3. `prepareAudioFilesData` 只读取任务上的实际字段并写入数据库，不再按 `task.lang` 推断。

需要新增填值：

- `tts_model`：SBV2 model id/name 或 `hexgrad/Kokoro-82M`
- `tts_voice`：当前列存在但未写入；接入时要写英文 voice（如 `af_bella`）、VOICEVOX speaker，或 SBV2 speaker/style
- `status`：`generated` / `fallback_generated` / `failed`

### 6.4 健康检查与观测

当前健康检查硬编码日文 TTS 为 VOICEVOX。接入 SBV2 后应改成：

- `TTS Japanese Primary (Style-Bert-VITS2)`：检查 `/status` 或 `/models/info`
- `TTS Japanese Fallback (VOICEVOX)`：检查 `/version`
- 日语健康检查触发条件要同时看 `TTS_JA_SBV2_ENDPOINT` 和 `TTS_JA_ENDPOINT`，不能只依赖现有 `TTS_JA_ENDPOINT`
- 若 primary 离线但 fallback 在线，整体状态为 `degraded`，不是 `offline`
- 生成日志/错误中显式区分 primary failure 与 fallback success

### 6.5 `docker-compose.yml`

新增 SBV2 服务时保留现有 `tts-ja`：

```yaml
tts-ja-sbv2:
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

注意：这只是目标形态。真正落地前必须先完成 POC，确认镜像构建、模型资产初始化和 API 参数。

### 6.6 `.env.example`

```bash
# English -> Kokoro
TTS_EN_ENDPOINT=http://tts-en:8000/v1/audio/speech
TTS_EN_TYPE=kokoro
TTS_EN_MODEL=hexgrad/Kokoro-82M
TTS_EN_VOICE=af_bella
TTS_EN_SPEED=1.0

# Japanese primary -> Style-Bert-VITS2
TTS_JA_TYPE=style_bert_vits2
TTS_JA_SBV2_ENDPOINT=http://tts-ja-sbv2:5000
TTS_JA_SBV2_MODEL_ID=0
TTS_JA_SBV2_SPEAKER_ID=0
TTS_JA_SBV2_STYLE=Neutral

# Japanese fallback -> VOICEVOX
TTS_JA_ENDPOINT=http://tts-ja:50021
VOICEVOX_SPEAKER=2
```

---

## 7. SBV2 POC 必须先解决的问题

Style-Bert-VITS2 不是“加一个镜像名”即可稳定落地。POC 必须验证：

1. **模型资产来源**：选择具体日语模型，记录来源、许可、署名要求、是否可本地长期缓存。
2. **初始化方式**：模型放入 `model_assets` / `/models` 的具体目录结构。
3. **启动命令**：确认 `server_fastapi.py --cpu --dir <model_dir>` 可在容器中启动。
4. **API 参数**：确认 `/voice` 的 `model_id`、`speaker_id`、`style`、`length`、`language=JP` 等参数。
5. **性能**：Mac CPU 下短句、长句、12 条场景表达批量生成的耗时。
6. **稳定性**：容器冷启动时间、内存占用、模型首次加载耗时。
7. **教学质量**：标准日语、汉字混排、片假名外来词、长句断句是否优于 VOICEVOX。

---

## 8. 必须实测验证（教学准确性）

学习场景 **发音准确 > 表现力**。切换默认日语后端前必须做小批 A/B 验证：

- **标准短句**：寒暖差、予約変更、引き継ぎ、確認事項等常用表达。
- **汉字混排**：维修、预约、沟通、业务交接类句子。
- **片假名外来词**：プロジェクト、エアコン、スケジュール等。
- **长句断句**：场景卡中 12 条常用表达连续生成。
- **回退验证**：停掉 SBV2 后，VOICEVOX fallback 能生成并保存 wav。

验收标准：

- SBV2 生成成功率 >= 95%。
- 单条短句本地 CPU 生成时间可接受，批量 12 条不阻塞主要工作流。
- 至少 10 组 A/B 听感中，SBV2 在自然度或教学可懂度上明显优于 VOICEVOX。
- fallback 成功时数据库 `tts_provider` 记录为 `voicevox`，而不是 `style_bert_vits2`。

---

## 9. 分阶段实施

| 阶段 | 范围 | 完成标准 |
|------|------|---------|
| **P0** | SBV2 独立 POC：本地 CPU 容器、模型资产、`/status`、`/models/info`、`/voice` | 能用固定日语文本生成 wav，并记录耗时/内存/模型条款 |
| **P1** | `ttsService.js` 接入 SBV2 + VOICEVOX fallback，默认仍可回退 | 生成三语卡、日语语法卡、场景表达卡时日语音频正常保存 |
| **P2** | 健康检查、DB provider/model/voice 记录、日志和测试补齐 | UI/health/db 都能区分 SBV2 与 VOICEVOX fallback |
| **P3** | 根据 A/B 结果把 SBV2 设为默认日语主后端 | 重建容器后真实生成链路稳定通过 |
| **P4** | 未来扩展：GPU/上云时评估 CosyVoice2 | 当前不实施 |

---

## 10. 测试清单

- Unit：
  - `ttsService`：SBV2 成功、SBV2 失败回退、VOICEVOX-only、未配置 endpoint。
  - `generationHelpers`：把 `generateAudioBatch` 返回的实际 provider/model/voice/status 回填到 persisted audio tasks。
  - `databaseHelpers`：不再按语言猜 provider，按 task 上的实际字段保存 `tts_provider` / `tts_model` / `tts_voice`。
  - `healthCheckService`：primary online、primary offline fallback online、all offline。
- Integration：
  - 三语卡：英文 mp3 + 日文 wav。
  - 日语语法卡：日文 wav。
  - 场景表达卡：当前 prompt/校验要求 12 条英文 mp3 + 12 条日文 wav。
  - 不出现中文 audio task。
- Runtime smoke：
  - `docker compose -p npm-audit-deps up -d --build`（`npm-audit-deps` 是当前本地 Compose project 名，不是 TTS 方案名）
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
