# 朗读选区 TTS ST-P4 验收报告

> 结论：**PASS**
>
> 日期：2026-07-27
>
> 范围：ST-01 至 ST-37，桌面端 CardModal 英文/日文选区朗读

## 1. 用户现在得到什么

用户在学习卡片中选中英文或日文后，可以直接朗读该选区：

- 英文由 Kokoro 生成 MP3；
- 日文由 VOICEVOX 生成 WAV；
- 可选择 `0.8×`、`1.0×`、`1.2×` 三档语速；
- 纯汉字和无法可靠判断的混合文本必须由用户确认 English 或日本語；
- 支持生成中、停止、重播、失败重试和服务繁忙提示；
- 新播放会停止当前卡片、教材页面或复习页面中的上一段音频；
- feature flag 关闭时仅隐藏朗读入口，不影响标记、复制、知识点查询和生成卡片。

这项能力不生成新卡、不保存临时音频到 `audio_files`，也不修改 annotation、
知识图谱、学习记录或 FSRS 调度。

## 2. 实施范围

| 层级 | 已完成 |
|---|---|
| TTS 内核 | 抽出不写文件的 `synthesizeSpeech()`，批量生成继续复用同一入口 |
| 跨业务协调 | 交互朗读优先、批量任务防饥饿、共享并发上限 2 |
| HTTP | `GET/POST /api/tts/selection`，二进制响应、受控 headers、abort 与错误码 |
| 缓存 | 独立 named volume、稳定 hash key、原子写、TTL、空间清理、BYPASS |
| UI | CardModal 选区按钮、语言确认、速度、状态机、键盘与焦点恢复 |
| 横向播放 | CardModal、Textbook Courses、Review Session 共用独占播放 owner |
| 可观测性 | 缓存可写性和剩余空间进入 `/api/health`，不暴露绝对路径 |
| 运维 | feature flag、回滚、缓存清理与故障诊断已写入运行手册 |

正式范围仅为桌面端，没有进行移动端设计或验收。

## 3. 真实 TTS 与争用 POC

测试环境为 Compose 内的真实 viewer、Kokoro 和 VOICEVOX 服务。

| 场景 | 结果 |
|---|---|
| 空闲英语短句 | 1,289 ms，MP3 |
| 空闲日语短句 | 812 ms，WAV |
| 6 个交互请求与 40 个批量任务争用 | 6/6 成功 |
| 争用延迟 | p50 1,891 ms；p95/max 2,923 ms |
| 40 个批量任务 | 40/40 成功；总计 41,291 ms |

最终参数：

- 共享 provider 并发上限：2；
- 交互请求优先；
- 批量任务最长等待 5,000 ms 后获得一次执行机会，避免饥饿；
- 单次朗读 timeout：15,000 ms；
- 等待超过 600 ms 时显示繁忙提示。

因此没有增加第二套 TTS 容量。

## 4. 真实 API 与缓存

| 请求 | 状态 | 时间 | 字节 | 关键结果 |
|---|---:|---:|---:|---|
| 英语首次请求 | 200 | 2.028 s | 68,012 | `MISS`、Kokoro、`af_bella` |
| 英语重复请求 | 200 | 0.0078 s | 68,012 | `HIT` |
| 日语首次请求 | 200 | 0.966 s | 135,724 | `MISS`、VOICEVOX、`speaker:2` |
| 日语重复请求 | 200 | 0.0064 s | 135,724 | `HIT` |
| 人为制造缓存写失败 | 200 | 1.034 s | 43,820 | `BYPASS`，音频仍正常返回 |

过期缓存清理实测成功：删除 3 个缓存对象，清理后缓存字节数为 0。

## 5. 零业务写入证明

POC、真实 API smoke、BYPASS 和缓存清理前后，脚本对真实 SQLite 与 records 做了
内容级只读审计：

| 审计对象 | 结果 |
|---|---|
| annotation、KG、learning、Study Item 相关表 | 聚合 hash 未变化 |
| SQLite 业务快照 | 未变化 |
| records 文件 | 5,179 个文件，546,489,330 bytes，内容 hash 未变化 |
| 综合 hash | `771527b1...dda43`，比较结果 `matches: true` |

临时选区音频只进入独立缓存 volume，不进入 SQLite、records 或教材媒体目录。

## 6. 自动化门禁

最终源码版本复验：

| 门禁 | 结果 |
|---|---|
| lint | PASS |
| React TypeScript | PASS |
| unit | 391/391 |
| integration | 65/65 |
| architecture + production build | PASS |
| desktop E2E + visual | 53/53 |
| smoke | 7/7 |
| npm audit high | 0 vulnerabilities |

浏览器覆盖了英文、假名、纯汉字确认、三档速度、生成失败、重试、停止、播放互斥、
请求取消、feature flag、readOnly、亮色/暗色、`Escape` 和焦点恢复。

## 7. 运行态验收

- Compose 项目：`three_lans_system`；
- viewer、Kokoro、VOICEVOX、OCR 四个容器在线；
- `/api/health` 返回 200；
- Selection TTS Cache 报告 online、writable 和剩余空间；
- DeepSeek、Kokoro、VOICEVOX、OCR、Storage 均为 online；
- 生产 viewer 使用最终源码重新构建，不使用源码 bind mount。

## 8. 产品边界

本次没有实现：

- 中文 TTS；
- 麦克风、ASR、发音评分；
- 自动猜测纯汉字语言；
- 用户自定义音色；
- 把选区朗读保存成学习事实；
- 移动端页面或移动端验收。

以上能力需要另立产品范围，不应塞入 annotation、KG 或 learning 数据层。
