# CA-R1 规范注解层运行观察报告

> 日期：2026-07-27
> 环境：本地 Docker Compose `three_lans_system`
> 结论：**PASS**；规范注解层可继续运行，旧 `card_highlights` 保持冻结，不执行 DROP

## 1. 这次检查了什么

CA-R1 用真实容器和真实 SQLite 数据，检查 CA-P8 切换后的规范注解层是否稳定。
本次操作严格只读：

- 不创建、修改或删除卡片、教材、注解和学习记录；
- 不修复已知孤立数据；
- 不调用旧 highlights API；
- 不删除 `card_highlights`；
- 原始 JSON 报告保存在 Git 仓库之外。

观察分为两次。第一次建立只读基线；随后只调用规范注解 API 和三个已退役 API；
第二次再次计算数据库状态和哈希，确认探测前后没有数据变化。

## 2. 真实数据结果

| 指标 | 结果 |
|---|---:|
| 规范注解总数 | 28 |
| Active / Orphaned | 27 / 1 |
| Active 注解目标数 | 11 |
| generation 目标 / red 标记 | 28 / 28 |
| 历史迁移事件 | 26 |
| Migrated / Orphaned 迁移事件 | 25 / 1 |
| CA-P8 后新建注解 | 2 |
| 冻结旧快照 | 11 |
| SQLite quick check / 外键违规 | `ok` / 0 |

唯一已知孤立注解：

- `annotation_id`：`ca_legacy_4086b8f6f0f6ec5fd45c28e8027da1dc`
- 目标：generation `503`
- 来源：legacy highlight `20`
- 状态：迁移时已标记为 `orphaned`，本次没有自动修复或重新附着

没有发现 active 注解目标缺失、revision 漂移、selector 格式错误、重复 active
anchor、迁移触发器缺失或外键违规。

## 3. API 与运行时代码检查

| 检查 | 结果 |
|---|---:|
| `/api/annotations?targetKind=generation&targetId=503` | 200 |
| `/api/highlights/by-file` | 404 |
| `/api/textbooks/tracks/1/highlights` | 404 |
| `/api/annotations/shadow-status` | 404 |
| 扫描运行时代码文件 | 185 |
| 旧 route / flag / repository 引用 | 0 |
| `CARD_ANNOTATIONS_ENABLED` | 已启用 |

这说明当前页面与服务只使用规范注解接口，已退役的旧接口没有被重新暴露。

## 4. 两次观察的一致性

第二次观察与基线比较后，以下门禁全部通过：

- 注解状态未被观察脚本修改；
- `card_highlights` 冻结快照未变化；
- 迁移事实未变化；
- active 目标、selector 和 append-only 约束保持有效；
- 旧运行时依赖仍为零。

关键哈希：

| 状态 | SHA-256 |
|---|---|
| 注解状态 | `3dc66b8d2c9b8560f275c57299e1c46ee281328b009199022a73b1da30b8732c` |
| 冻结旧快照 | `cd1442e3760187e10687c5519ad2861822a484a04568605d524e78033f955982` |
| 迁移事实 | `1f3f3c1f6a33ef229dbe92e615077e2782af62e0d4f034883ebbc79f68abaca5` |

Git 外原始报告：

- `/tmp/three-lans-ca-r1-baseline.json`
- `/tmp/three-lans-ca-r1-after-probes.json`

## 5. 工程验证

| 检查 | 结果 |
|---|---:|
| ESLint / React typecheck | 通过 / 通过 |
| Architecture gate | 通过 |
| Unit / Integration | 371/371 / 62/62 |
| 桌面 E2E | 47/47 |
| Smoke | 7/7 |
| Docker runtime | 4 个容器运行 |

当前产品边界是桌面端，本次没有执行移动端设计或验收。

## 6. 结论与边界

CA-R1 判定为 **PASS**。CA-P8 后的规范注解层在当前真实数据上没有出现运行时
回退、旧表继续写入、目标漂移或 selector 损坏。

这是一段受控的本地观察，不等同于数天或数周的长期生产监控。因此：

1. `card_annotations` 继续作为唯一运行时真源；
2. `card_highlights` 继续作为冻结审计快照保留，**不执行 DROP**；
3. 已知 orphaned 注解保持显式状态，不做猜测性自动修复；
4. 下一阶段进入 CA-I1，补齐多色标记、取消标记、复制、知识点查询和键盘操作；
5. 选区 TTS 仍是独立能力，不与注解数据所有权混在一起。
