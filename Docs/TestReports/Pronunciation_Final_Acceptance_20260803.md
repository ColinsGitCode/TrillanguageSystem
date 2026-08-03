# 日语按需注音与 Ruby 退役最终验收报告

> 日期：2026-08-03
> 状态：**BLOCKED：自动化与运行态门禁通过，历史迁移、Ruby 正式删除和真实观察期仍待人工/时间门禁**

## 1. 报告边界

本报告记录本轮代码、测试、桌面端验收和 Compose 运行态复核结果。它不把自动化测试通过
误写成历史内容已经批准迁移，也不把新注音链路可用误写成生产 Ruby 已经删除。

## 2. 自动化验收

| 门禁 | 结果 | 证据 |
|---|---|---|
| ESLint | PASS | `npm run lint` 无报错 |
| React TypeScript | PASS | `npm run typecheck:react` 通过 |
| Unit | PASS | **453/453** |
| Integration | PASS | **89/89** |
| Architecture / React build / frontend budget | PASS | `npm run test:architecture` 通过；所有路由和 CardModal 延迟包预算通过 |
| Desktop E2E | PASS | `npm run test:e2e -- --workers=1`：**82/82** |
| Textbook acceptance | PASS | `npm run test:textbooks:acceptance` 完成，TC-P4 acceptance gates passed |
| npm audit | PASS | `npm audit --omit=dev --audit-level=high`：0 vulnerabilities |

主要桌面 E2E 覆盖了 Cards Factory、CardModal、教材和 Review 的纯正文/浮层/整词选择、播放互斥、
历史 Ruby 缺失降级、人工纠音入口、视觉回归和受支持桌面视口。测试内已增加等待 pronunciation
token 就绪的同步，避免把异步浮层加载竞态误报为产品失败。

## 3. Compose 运行态

执行命令：

```text
docker compose -p three_lans_system up -d --build
docker compose -p three_lans_system ps
curl -fsS http://127.0.0.1:3010/api/health
npm run smoke
```

结果：

- `trilingual-viewer`、`trilingual-ocr`、`trilingual-tts-en`、`trilingual-tts-ja` 四个服务均为 Up；
  viewer 和 OCR 使用本轮代码重新构建并重新创建，外部 TTS 镜像服务保持运行。
- `/api/health` 返回 `overallStatus=online`、`criticalOnline=true`。
- DeepSeek API、Kokoro、VOICEVOX、OCR、SQLite Storage、Selection TTS Cache 均报告 online。
- `npm run smoke`：**7/7**。

这证明当前部署可以运行新注音代码，但 health 检查不等于真实 DeepSeek 三类卡片生成已经完成，
因此不把“真实 LLM/TTS 生成冒烟”伪装成已完成证据。

## 4. 已落地的开发范围

- 新卡片使用纯日语正文，并将 pronunciation document/token 作为独立投影保存。
- CardModal 使用 Tooltip/Popover、整词选择、键盘导航、TTS、KG/LA/生成卡动作和人工纠音边界。
- Textbook 和 Review 使用共享 `PronunciationText`，不与官方 Track 音频或生成句子播放混用。
- 迁移审计、60 张历史结构问题卡清单、466 种复合候选、manifest、备份脚本、shadow replay、
  telemetry 隐私约束和运行手册已经落地。
- legacy Ruby reader 仍受 feature flag 保护，历史 Ruby 生成与渲染链路尚未删除。

## 5. 仍然阻塞 Final PASS 的事项

以下事项不能由代码或自动化测试代替：

1. 用户逐项确认 PF-D0、PF-D1、PF-D2 的产品与交互决策。
2. 60 张历史结构问题卡的 `repair/archive/exclude/false-positive` 人工决策。
3. 466 种复合词候选的 accepted 来源、整词读音和人工抽样确认。
4. 批准的历史 Canary、回滚演练、再次前进和全量 apply。
5. 全量迁移完成后的 PF-P5 Ruby 生产链路删除与容器验收。
6. 至少 7 个真实使用日的 PF-R1 观察，以及观察后的最终退役复核。

在上述门禁完成前，禁止执行历史迁移 `--apply`，禁止关闭 legacy reader，也禁止删除生产 Ruby
生成/渲染代码。

## 6. 结论

**开发和自动化验收完成，运行态验收通过；产品最终封板未通过。** 当前版本可以继续在桌面端
验证新注音体验，但历史内容迁移和 Ruby 退役必须继续走人工批准、Canary、回滚和真实观察流程。
