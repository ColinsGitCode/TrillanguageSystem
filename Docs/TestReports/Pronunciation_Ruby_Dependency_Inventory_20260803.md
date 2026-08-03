# Ruby 生产依赖清单

> 目的：为 Ruby 退役提供逐项回归范围。历史 Ruby 是迁移输入，不是新活动内容的真源。

## 生产路径

| 区域 | 当前位置 | 处理方式 |
|---|---|---|
| 生成提示 | `services/generation/promptEngine.js`、`prompts/*.md` | PF-P1 改为纯正文；不再要求或注入 Ruby |
| 生成后处理 | `services/generation/contentPostProcessor.js` | 保留旧内容读取兼容，新增去除显式括号读音 |
| 旧 HTML 渲染 | `services/generation/htmlRenderer.js` 的 `normalizeJapaneseRuby()` / `toRuby()` | PF-P5 前作为 legacy reader，之后仅保留迁移工具 |
| 生成服务 | `services/generation/cardGenerationService.js`、`services/application/executeCardGeneration.js` | 新卡显式 `legacyRuby: false` |
| CardModal | `app/features/card-modal/markdown.ts`、`CardModal.tsx` | PF-P2 使用 pronunciation token overlay；目标是活动 DOM 零 Ruby |
| 教材浏览 | `TextbookPublishedBrowser.tsx`、`ja_ruby_html` | `ja_ruby_html` 仅作历史输入，PF-P3 改用 pronunciation view-model |
| Review | `ReviewSessionPage.tsx`、review answer renderer | PF-P3 仅在答案面加载 token；不改变评分和调度 |
| 选区投影 | `text-projection.mjs`、`selection.ts` | 迁移期间保留 Ruby 兼容；PF-P5 删除 fallback |
| Annotation | `annotation-anchor.mjs`、`annotation-render.mjs` | 先 shadow replay，再证明 plain projection 可重锚 |
| 语音 | `contentPostProcessor.js` 的 audio task 清理、Selection TTS | 读音只做 token/浮层辅助，不进入音频正文 |

## 数据与工具

| 区域 | 位置 | 处理方式 |
|---|---|---|
| generation Markdown/HTML | `generations.markdown_content`、records volume | 不原地改写；通过 PF-D2 身份方案和 hash-gated apply 处理 |
| 教材 revision | `ja_ruby_html` | 保留不可变历史，活动 view-model 不再直接渲染 |
| 只读 Ruby 解析 | `services/pronunciation/rubyParser.js`、维护脚本 | 只服务审计/迁移，不作为活动渲染依赖 |
| pronunciation 真源 | `pronunciation_documents`、`pronunciation_tokens`、correction events | 独立域；不拥有学习调度、KG 或 annotation |
| 测试 fixtures | `tests/unit/*ruby*`、教材/annotation fixtures | 分为 legacy 兼容测试和 plain overlay 测试，PF-P5 后删除不再需要的 fixture |

## 目前仍存在的 Ruby 引用

这些引用在 PF-P5 前是有意保留的迁移输入或兼容路径；全量退役前必须由架构门禁逐项解释：

- 历史 Ruby 解析器和 `normalizeJapaneseRuby()`；
- 教材 `ja_ruby_html` 字段及旧 workflow fixture；
- annotation 对 `rt/rp` 的兼容测试；
- legacy Markdown renderer 的 Ruby 正规化测试。

该清单不表示已经完成全量迁移；它是 Gate 0 的边界冻结结果。
