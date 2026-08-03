# PF-P1 新卡纯正文与注音数据链验收

> 日期：2026-08-03
> 状态：**代码与自动化门禁通过；真实三类 LLM/TTS 运行冒烟待运行态复核**

## 已落地

- 三语、日语语法、场景卡 prompt 要求纯日语正文，不再要求生成 Ruby。
- 生成后处理只清理活动日语区的显式注音，中文、英文、音频任务不进入日语分析。
- generation 写入后尝试生成独立 `pronunciation_documents` / `pronunciation_tokens`；分析失败
  不阻塞卡片生成，状态保留为 deferred/partial。
- pronunciation projection 以 generation content hash 绑定，重复运行幂等，不改原 Markdown。
- 生产架构门禁禁止新 prompt、fixture 和 CardModal 依赖 Ruby；legacy reader 仍有明确白名单。

## 自动化证据

| 门禁 | 结果 |
|---|---|
| pronunciation unit/integration contract | 已覆盖生成、投影、API、纠音幂等、stale 409、关闭开关 |
| 新卡 Ruby 架构扫描 | 通过；legacy migration/archive 路径除外 |
| 生成内容 | 测试断言 Markdown 不含 `<ruby>`，audio 文本路径不改变 |
| 历史内容 | 保留 legacy reader，未执行历史 apply |

## 未完成门禁

- 尚未使用当前 compose 对真实 DeepSeek + EN/JA TTS 完成三类新卡各一张的人工运行验收。
- 尚未对真实生成结果完成“Markdown、DB、DOM、TTS、保存、标签、KG、Study Item”全链路
  的运行态记录；自动化 fixture 不能替代该证据。
