# PF-R1 注音运行观察报告

> 日期：2026-08-03
> 状态：**BLOCKED：观察窗口尚未开始**

## 已提供的运行观测能力

- `POST /api/pronunciation/telemetry` 接收有限枚举、耗时、长度、状态码和错误码。
- `GET /api/pronunciation/telemetry` 返回进程内聚合计数和 controller/listener/request
  活跃度峰值。
- 观测开关为 `PRONUNCIATION_TELEMETRY_ENABLED`；默认关闭，Compose 验收环境显式开启。
- 服务拒绝 `text`、`phrase`、`surface`、`reading`、`exact`、`markdown`、`content`、`html`
  等内容字段；不写 SQLite，不保存正文或读音。
- 前端 CardModal、教材/Review 共用注音组件上报 token 状态、浮层动作、TTS、纠音、请求
  中止和 listener/controller 生命周期。

## 尚不能声称完成的内容

1. 至少 7 个真实使用日尚未发生，不能用空闲日或自动化测试代替。
2. 尚未从运行数据汇总真实 Tooltip/Popover、unresolved、correction、TTS/KG 降级和
   legacy hit 指标。
3. 60 张历史结构问题卡和 466 种复合词候选仍需要人工裁决。
4. 因此 PF-R1 不通过，Ruby 不能在本报告日期删除。
