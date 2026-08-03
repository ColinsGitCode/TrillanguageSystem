# PF-P3 教材与 Review 注音消费者验收

> 日期：2026-08-03
> 状态：**代码接入完成；阶段报告待完整消费者门禁复核**

## 已落地

- 教材表达使用 `textbook_expression` pronunciation target，官方日语正文不再直接把
  `ja_ruby_html` 注入活动 token DOM。
- Review 只在 reveal 后渲染答案注音，cue 面不提前泄露读音；缺少 projection 不阻塞评分。
- CardModal、教材和 Review 复用 `PronunciationText` 以及同一 token mapper/Selection TTS。
- `ja_ruby_html` 保留为历史迁移读取输入，不作为新内容真源。

## 边界

- pronunciation 不写 annotation、KG lookup、LA manual intent、Review Event 或 FSRS。
- Track 未发布不创建学习项；教材官方音频和系统生成音频仍是两条独立播放路径。
- 关闭 pronunciation flag 后正文、选区、标红、TTS 与评分仍可继续工作。

## 还需运行确认

- 教材 acceptance 与 Review 完整 E2E 需要在本轮最终代码和重建容器上重跑。
- 真实用户确认教材人工校对入口只修改 pronunciation projection，不改官方教材原文。
