# 英日统一选区与本地中文释义

状态：Implemented · 2026-08-09 扩展本地词典

## 1. 目标

学习卡片中的英文和日文正文使用同一套选区工作流：

1. 用户选择英文、日文词语或句子；
2. 页面在同一个选区工具条中显示简明中文释义；
3. 用户继续执行标记、复制、朗读、知识点查找或生成卡片；
4. 本地没有释义时，用户可以手动填写，或显式请求 DeepSeek 生成候选；
5. DeepSeek 候选必须由用户确认后才能进入本地词库。

本能力只辅助理解选区，不改变卡片正文、annotation、pronunciation、KG、Study Item、Review Event 或 FSRS 状态。

## 2. 交互基线

- 英文与日文共用 `.card-selection-toolbar`，不再维护两套操作入口。
- 日语注音 Tooltip 只负责快速显示读音；单击不会抢占文本选择。
- 双击已确认的日语 pronunciation token 会选择整个词语，再打开统一工具条。
- 手动拖选日语文字与英文拖选行为一致。
- 选区必须位于同一个标题、段落或列表项内；跨区块选择会立即清除，避免把整张卡误当成一个查询词条。
- 右键位于已有合法选区内时保留该选区；右键位于选区外时，英文按鼠标下的完整单词重选，日语按已确认的 pronunciation token 整词重选。
- 无法得到合法词语或句子时不显示应用内右键菜单，也不保留旧的蓝色大选区。
- 选区与 pronunciation token 相交时，页面可确定该内容来自日语投影，因此纯汉字也直接按日语处理。
- 脱离日语投影的纯汉字仍可能是中文或日文，继续要求用户明确语言，禁止猜测。
- 工具条最大宽度为桌面视口减去 16px，内容不足时仍保持单行；内容较多时换行，所有操作必须留在视口内。

## 3. 中文释义来源

本地查询按以下顺序执行，命中即停止：

1. 当前卡片中的英文/日文例句及其中文译文；
2. 已确认的教材表达及其中文提示；
3. `local_glossary_entries` 中的人工确认词条；
4. `local_dictionary_entries` 中的本地英日简明词典；
5. 最近 200 张历史卡片中的完全一致表达；
6. 未命中。

查询是只读操作。打开工具条、切换选区和重复查询都不得创建词条或 AI proposal。

本地词典是独立的只读事实层，不与人工词库混用。词典命中可以返回简短中文释义、日语读音、词性、辞书形和词典版本；用户不能直接编辑词典行，只能通过人工词库覆盖某个词条。查询过程不写入词典表。

## 4. 本地规范化

- 英文使用 NFKC、大小写归一和保守的复数/时态候选别名。
- 日文复用现有 Kuromoji 分析器，保守提取辞书形；例如 `食べた` 可查询 `食べる`。
- 分析器不可用时自动降级为表面文本完全匹配。
- 分析结果只是查询候选，不自动写入词典，也不改变 pronunciation token。
- 不确定义项使用 `sense_key` 隔离；v1 默认 `default`，不自动拆分义项。

## 5. 人工词条

`local_glossary_entries` 保存用户确认的简明中文释义：

- 支持新建、编辑、软归档；
- 使用 `version` 做乐观并发控制；
- 活跃词条的 `(language, normalized_form, sense_key)` 唯一；
- `source_kind` 仅允许 `manual`、`llm-confirmed`、`imported`；
- 释义最长 120 个 Unicode code point；
- 词条不拥有学习调度或知识图谱状态。

## 6. DeepSeek 候选

DeepSeek 不参与普通查询。只有用户点击“AI 候选”时才调用：

1. 服务端只发送选区、语言和最多 200 字符的页面标题用于消歧；
2. 不发送整张卡片正文；
3. 返回值先写入 `local_glossary_proposals`，状态为 `pending`；
4. 用户可编辑中文释义；
5. 点击确认后才创建 `llm-confirmed` 词条；
6. 取消会把 proposal 标为 `rejected`；
7. 模型、prompt 版本、响应哈希和 token usage 留作审计，不保存完整模型原文。

服务端默认关闭该能力：`LOCAL_GLOSSARY_LLM_ENABLED=0`。本地 owner Compose 可显式开启；关闭时返回 `LOCAL_GLOSSARY_LLM_DISABLED`，不得自动降级成其它远端模型。

## 7. 数据与 API

Migration `013_local_glossary.sql` 新增：

- `local_glossary_entries`：人工确认后的活动/归档词条；
- `local_glossary_proposals`：DeepSeek 候选与人工裁决审计。

Migration `014_local_dictionary.sql` 新增 `local_dictionary_entries`。仓库内的 `services/localGlossary/dictionaries/local-en-ja-zh-v1.json` 是一份原创简明启动词典，不包含第三方词典内容。

授权的第三方词典通过 `npm run dictionary:import:open` 导入，默认先 dry-run：

```bash
npm run dictionary:import:open -- \
  --source=ecdict --file=/path/ecdict.csv --scope=common
npm run dictionary:import:open -- \
  --source=jmdict --file=/path/jmdict.json --ecdict-file=/path/ecdict.csv
```

确认条目数量、许可和版本后，增加 `--apply` 才写入 SQLite。ECDICT 提供英语词条、词性和中文翻译；JMdict-Simplified 提供日语表记、读音和词性，但本系统只保留能与 ECDICT 英文释义**精确对应**的中文简释。没有可靠中文对应的日语词条直接跳过，不把英文释义冒充中文。

外部原始文件不进入 Git，也不复制进应用镜像；每条导入记录把 `source_id`、输入文件 SHA-256、来源 URL、许可和 `dictionary_version` 写入词典表，便于审计、升级和重建。更新时导入新的版本，不原地覆盖旧版本；查询仍按现有的人工词条优先、本地词典兜底规则执行。

来源与许可：

- ECDICT：[upstream repository](https://github.com/skywind3000/ECDICT)，仓库声明 MIT；由于其数据来自多个上游，重新分发前仍需保留并复核上游 notices。
- JMdict：[EDRDG license](https://www.edrdg.org/edrdg/licence.html) 与 [JMdict documentation](https://www.edrdg.org/jmdict/edict_doc_depr.html)；采用 CC BY-SA 4.0 / EDRDG 条款，更新时保留署名和许可信息。

HTTP contract：

- `GET /api/local-glossary/lookup`；
- `GET /api/local-glossary/lookup` 返回 `sourceKind=dictionary` 时，同时提供 `reading`、`partOfSpeech`、`lemma` 和 `dictionaryVersion`；
- `GET /api/local-glossary/entries`；
- `POST /api/local-glossary/entries`；
- `PATCH /api/local-glossary/entries/:id`；
- `DELETE /api/local-glossary/entries/:id`；
- `POST /api/local-glossary/proposals`；
- `POST /api/local-glossary/proposals/:id/accept`；
- `POST /api/local-glossary/proposals/:id/reject`。

## 8. 所有权边界

- `services/localGlossary`：规范化、分层查询、人工词条和 AI proposal 工作流；
- `services/storage/db/localGlossary.js`：SQLite 行映射与原子写入；
- `services/storage/db/localDictionary.js`：只读词典查询与版本化导入；
- `services/localGlossary/localDictionaryCatalog.js`：词典目录格式校验与启动词典加载；
- `routes/localGlossary.js`：薄 HTTP adapter；
- `SelectionGlossaryInline.tsx`：选区工具条中的查询、人工编辑和候选确认；
- `PronunciationCardContent.tsx`：日语 hover 读音与整词选择，不保存中文释义。

本能力不得写入：

- `card_annotations`；
- pronunciation tables；
- `kg_*`；
- `study_items`；
- learning queue/session/review/schedule tables；
- `audio_files` 或生成任务。

## 9. 测试门禁

- 单元测试覆盖英文别名、日语辞书形、当前卡只读命中、人工 CRUD、proposal 确认和关闭开关；
- 单元和集成测试覆盖本地词典英文短语、日语读音/词性、日语辞书形候选以及查询零写入；
- 集成测试覆盖真实 Express contract、零写入查询和禁用时 fail-closed；
- Cards Factory E2E 覆盖英文/日文共用工具条、本地中文释义、零自动 proposal、纯汉字日语上下文识别和视口不溢出；
- lint、React typecheck、unit、integration、architecture、build、smoke 和 Compose health 必须通过。

自动化测试使用 mock DeepSeek，不证明真实模型翻译质量。真实候选只能由用户显式触发并人工确认。

## 10. 后续扩展

- 增加独立的本地词库管理页面，用于批量检索、义项拆分、导入和归档恢复；
- 将教材人工确认结果批量导入为 `imported` 词条；
- 基于真实使用数据评估是否需要更完整的英语词形分析器；
- 中文释义可作为未来学习提示信号，但不得直接成为 FSRS 调度事实。
