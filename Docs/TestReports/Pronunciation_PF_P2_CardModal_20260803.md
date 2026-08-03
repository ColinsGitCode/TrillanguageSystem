# PF-P2 CardModal 注音浮层与选区验收

> 日期：2026-08-03
> 状态：**桌面定向 E2E 通过；完整套件和人工视觉门禁待本轮复核**

## 本轮确认

- 注音由结构化 token 按 code point offset 映射到纯正文，不把正文包进 button。
- Tooltip 延迟 250ms，只显示整词读音和类型；Popover 才提供朗读、复制、查知识点、生成卡、纠音。
- 非空浏览器选区优先使用既有标红/生成工具条；双击 accepted token 选择完整词面。
- roving tabindex、方向键、Home/End、Enter/Space、Escape 已进入前端实现。
- 选区朗读复用 Selection TTS 与共享播放所有者；TTS、KG、LA、纠音动作相互独立。

## 自动化证据

| 门禁 | 结果 |
|---|---|
| 定向 word-level pronunciation E2E | **1 passed** |
| 断言内容 | Tooltip 读音、整词 accepted token、重载后选区预览 |
| TypeScript / lint / unit / integration | 在最终改动后重新运行，结果记录于 Final 报告 |

## 未完成门禁

- 1440 桌面截图、无障碍扫描、Portal/listener 长时泄漏观察还未形成运行报告。
- 完整 `test:e2e`、frontend budget 和容器重建后的浏览器复核需要在本阶段末统一执行。
