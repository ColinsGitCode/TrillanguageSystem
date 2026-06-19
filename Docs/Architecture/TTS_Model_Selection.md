# TTS 模型选型调研与决策（中 / 英 / 日 三语 · 本地 CPU）

> 状态：**调研 + 选型决策（待实施）** · 2026-06
> 约束：Mac · CPU 本地部署 · 零成本 / 隐私 · **教学发音准确性优先** · 自用（非对外服务）
> 关联：[Trilingual Card Generation System](Trilingual_Card_Generation_System.md)
> 影响文件：`services/generation/ttsService.js` · `services/generation/audioFormat.js` · `docker-compose.yml` · `.env.example`

本文是三语学习系统 TTS 选型的真源。结论先行：**高质量模型都需 GPU、对 Mac CPU 部署不现实**；在 CPU 约束内真正要做的是 ① 补完全缺失的中文 ② 把日语自然度升一档。

---

## 1. 现状与关键发现

| 语言 | 当前 TTS | 容器 | 输出 |
|------|---------|------|------|
| 英语 | Kokoro-82M（`hexgrad/Kokoro-82M`，OpenAI `/v1/audio/speech` 接口，voice `af_bella`） | `dlaszlo/speech-service` (CPU int8) | mp3 |
| 日语 | VOICEVOX（speaker 2） | `voicevox/voicevox_engine:cpu-latest` | wav |
| **中文** | **无** | — | — |

**关键发现**：这是三语系统，但 `ttsService.js` 的 `generateAudioBatch` 只处理 `lang === 'en' / 'ja'`，`zh` 直接抛「未支持的语言」。**中文卡片完全无法朗读——这是比"换更好模型"更紧迫的缺口。**

---

## 2. 候选模型对比（含许可维度）

| 模型 | 大小 | 中/英/日 | CPU·Mac | 质量 | 许可 | 自用可行 |
|------|------|---------|---------|------|------|---------|
| **Kokoro-82M**（现英语） | 82M | ✅✅✅（`misaki[zh/ja]`） | ✅✅ M4 20–50× 实时 | 中上 | **Apache-2.0** | ✅ 无约束 |
| MeloTTS | 轻 | ✅✅✅ | ✅✅ CPU 实时 | 中上 | **MIT** | ✅ 无约束 |
| Piper | 轻 | 中日较弱 | ✅✅ CPU-first | 中 | MIT | ✅ |
| **VOICEVOX**（现日语） | — | ❌仅日 | ✅ CPU 轻 | 中（角色音） | 免费可商用·**需署名** | ✅ 自用 OK |
| **Style-Bert-VITS2** | 中 | ❌仅日 | ✅ CPU 可行 | **高（日语自然）** | **AGPL-3.0** + LGPL | ✅ **自用 OK**（见 §3） |
| CosyVoice2-0.5B | 0.5B | ✅方言✅✅✅韩 | ⚠️ 需 GPU 6–8G | 高 | Apache-2.0 | 需 GPU |
| Fish-Speech S2 | 大 | ✅✅✅(top) | ❌ 需 24GB GPU | 最高(ELO~1339) | 待确认(历史 NC) | 需强 GPU |
| IndexTTS-2 | 大 | 英语中心 | ⚠️ 需 GPU | 高(zero-shot) | 开源 | 需 GPU |

**质量天花板 = GPU 门槛**：Fish-Speech 要 24GB、CosyVoice2 要 6–8GB 显存（CPU 上慢 10–50×）。Mac CPU 部署走不通。CPU 友好的只有 Kokoro / MeloTTS / Piper / Style-Bert-VITS2 / VOICEVOX。

---

## 3. 许可维度（自用 vs 对外服务）

许可对选型有实质影响，且**强烈依赖"是否对外提供服务"**：

- **Apache-2.0 / MIT**（Kokoro / MeloTTS / CosyVoice2）：无约束，商用 / 闭源 / 服务均可。
- **VOICEVOX**：引擎免费可商用，但**生成的语音需署名**（`VOICEVOX:角色名`）。学习自用无负担。
- **Style-Bert-VITS2 = AGPL-3.0**（+ text/user_dict 模块 LGPL-3.0，继承自 VOICEVOX）：
  - AGPL 的触发条件是**「通过网络把它作为服务提供给第三方」**——那时要求开源整个服务端。
  - **本项目是自用（非对外服务），不触发 AGPL 的开源义务**，可放心使用。
  - ⚠️ 额外注意：SBV2 的**预训练 / 社区音色模型各自带使用条款**（部分为非商用或需署名），选具体 voice 时单独确认。
  - 若未来本系统要**对外开放 / 商用**，需重新评估——届时日语可回退 VOICEVOX 或换 Apache 系（CosyVoice2）。

**自用场景结论**：Kokoro(Apache) / VOICEVOX(署名) / Style-Bert-VITS2(AGPL 自用 OK) 三者许可均可接受。

---

## 4. 选型决策

| 语言 | 决策 | 理由 |
|------|------|------|
| 英语 | **保持 Kokoro** | 已集成、CPU 优秀、Apache |
| **中文** | **补 Kokoro 中文（`misaki[zh]`）** | 现成、零新基建、CPU 友好、统一接口——解决最大缺口 |
| **日语** | **Style-Bert-VITS2 为主，VOICEVOX 保留作 fallback** | SBV2 自然度更高（汉字混排好），自用许可 OK；VOICEVOX 不删除，降级为备用 |
| 未来（若有 GPU/上云） | CosyVoice2-0.5B | 质量 + 多语言（中英日韩+方言）最佳平衡，Apache |

> 用户决策（2026-06）：日语主用 Style-Bert-VITS2，**VOICEVOX 先保留作备用**，不直接删除。

---

## 5. 落地架构：日语主备 fallback

核心是让日语 TTS 可在 **Style-Bert-VITS2（主）↔ VOICEVOX（备）** 间切换 / 回退，而非替换删除。

- **`ttsService.js`**：
  - 新增 `zh` 分支 → 走 Kokoro（OpenAI `/v1/audio/speech`，复用现有 `requestOpenAiSpeechAudio`，传中文 voice）。
  - `ja` 分支改为「主后端 + 回退」：`TTS_JA_TYPE = style_bert_vits2`（主）时请求 SBV2 API server，**失败 / 未配置时回退 `voicevox`**。新增 `requestStyleBertVits2Audio(task)`。
  - SBV2 输出 wav，与现有 `audioFormat.js`（ja → wav）一致，无需改格式。
- **`docker-compose.yml`**：新增 `tts-ja-sbv2` 服务（SBV2 自带 `pip install style-bert-vits2` 的 FastAPI server，可容器化），**保留 `tts-ja`（VOICEVOX）** 作 fallback。
- **`.env.example`**：
  ```
  # 日语主后端：style_bert_vits2 | voicevox
  TTS_JA_TYPE=style_bert_vits2
  TTS_JA_SBV2_ENDPOINT=http://tts-ja-sbv2:5000
  TTS_JA_SBV2_MODEL=<model_id>
  TTS_JA_ENDPOINT=http://tts-ja:50021      # VOICEVOX，保留作 fallback
  VOICEVOX_SPEAKER=2
  # 中文：复用 Kokoro
  TTS_ZH_VOICE=<kokoro 中文 voice>
  ```

> SBV2 的具体 API 路径（`/voice` 等参数）以官方 [server_fastapi](https://github.com/litagin02/Style-Bert-VITS2) 为准，落地时核对。

---

## 6. 必须实测验证（教学准确性）

学习场景 **发音准确 > 表现力**，切换前小批 POC 听感验证：

- **Kokoro 中文质量**：无明确中文 benchmark，且 Kokoro 长文本多语言 voice 有"不稳定"报告——中文教学是否达标需亲耳验证。不达标则退而用 MeloTTS（中文）或保留中文走 Kokoro 但限定短句。
- **SBV2 日语 vs VOICEVOX**：A/B 对比标准日语朗读，确认 SBV2 音色/语调更适合教学再设为主；否则维持 VOICEVOX 为主、SBV2 备选。

---

## 7. 分阶段实施

| 阶段 | 范围 |
|------|------|
| **P1** | 补中文（`ttsService.js` `zh` 分支 → Kokoro 中文 voice）+ Kokoro 中文质量 POC |
| **P2** | 日语 Style-Bert-VITS2 容器 + 主备 fallback（VOICEVOX 保留）+ A/B 验证 |
| **P3** | （可选，若有 GPU/上云）CosyVoice2-0.5B 统一升级 |

---

## 8. Sources

- [siliconflow · Best Open-Source TTS 2026](https://www.siliconflow.com/articles/en/best-open-source-text-to-speech-models)
- [dtelecom · Kokoro on M4 ~100ms](https://blog.dtelecom.org/we-replaced-elevenlabs-with-kokoro-tts-on-an-m4-gpu-latency-fell-to-100-ms-and-tts-cost-nearly-68bcc3313cdd)
- [Spheron · TTS GPU 显存要求 2026](https://www.spheron.network/blog/deploy-open-source-tts-gpu-cloud-2026/)
- [LocalClaw · Local TTS Guide 2026](https://localclaw.io/blog/local-tts-guide-2026)
- [arXiv 2505.17320 · Style-Bert-VITS2 日语评测](https://arxiv.org/html/2505.17320v1)
- [Style-Bert-VITS2 官方仓库（litagin02）](https://github.com/litagin02/Style-Bert-VITS2)
- [Fish-Speech 推理文档（GPU 要求）](https://github.com/fishaudio/fish-speech/blob/main/docs/en/inference.md)
