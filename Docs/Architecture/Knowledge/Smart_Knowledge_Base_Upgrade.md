# 三语智能知识库升级方案（设计稿）

## 1. 目标与范围
将当前“卡片生成 + 文件浏览”升级为**结构化、可查询、可归纳的三语智能知识库**。系统需要持续沉淀词条、短语、例句、语音路径，并支持按主题/语法点/难度维度检索，同时定期输出总结与分类报告。

**核心目标**
- **结构化存储**：词条/短语/例句/翻译/语音路径统一入库  
- **智能归纳**：自动分类、语法要点总结、相似短语聚类  
- **高效检索**：关键词 + 语义检索 + 多维筛选  
- **可追溯**：数据来源、版本、生成记录完整保留  

---

## 2. 总体架构

**数据层**
- 结构化数据库：PostgreSQL（推荐启用 pgvector）
- 对象存储：语音文件、图片等大文件（S3/MinIO/本地存储）
- 缓存层（可选）：Redis 用于热点查询与任务状态

**服务层**
- API 网关（REST/GraphQL）
- 词条服务：入库/去重/更新  
- 语音服务：生成、关联、路径校验  
- 搜索服务：关键词 + 向量检索  
- 归纳服务：定期分类与语法总结  
- 任务调度：定时批处理与重试

**智能层**
- LLM：分类、语法总结、知识归纳  
- Embedding：为词条/短语/例句生成向量  
- 可解释性：归纳结果保留 evidence 与关联词条

---

## 3. 数据模型（建议）

### 3.1 Entry（词条/短语）
- id  
- phrase（原文）  
- lang（en/ja/zh）  
- type（word/phrase/sentence）  
- normalized_phrase  
- tags（主题/语法/难度）  
- created_at / updated_at  
- source（用户输入/系统生成/导入）  

### 3.2 Translation（翻译/释义）
- id  
- entry_id  
- lang  
- text  
- tone（正式/口语）  
- notes（语法注意点）  

### 3.3 Example Sentence（例句）
- id  
- entry_id  
- lang  
- text  
- gloss（逐词对照，可选）  
- grammar_tags  

### 3.4 Pronunciation / Audio
- id  
- entry_id  
- lang  
- ipa / romaji / furigana  
- audio_path  
- tts_provider / voice / speed  
- created_at  

### 3.5 Knowledge Summary（归纳结果）
- id  
- scope（主题/语法/时间范围）  
- summary_text  
- related_entry_ids  
- created_at / version  

### 3.6 Embedding
- id  
- entry_id  
- vector  
- model_name  
- created_at  

---

## 4. 核心流程设计

### 4.1 入库流程（生成/导入）
1. 用户输入短语  
2. LLM 生成三语卡片（含例句/语法注释）  
3. 内容结构化解析 → 写入 Entry / Translation / Example / Audio  
4. 同步写入静态文件（Markdown + Audio）作为可审计备份  
5. 生成 embedding → 写入 Embedding  

### 4.2 定期归纳（批处理任务）
1. 按时间窗口选取最近新增词条  
2. 按语义聚类  
3. 生成分类结果（场景/语法/难度）  
4. 生成“语法注意事项”摘要  
5. 写入 Knowledge Summary，并关联相关词条  

### 4.3 去重策略
**同语种**
- normalized_phrase 精确匹配  
- 相似度阈值（同义/拼写变化）  

**跨语种**
- 多语 embedding 相似度聚类  
- 保留主 Entry，并建立关联关系  

---

## 5. 检索与查询设计

### 5.1 关键词检索
- phrase / translation / example 中全字段搜索  
- 支持语言限定与类型过滤  

### 5.2 语义检索
- 输入自然语言 → embedding 查询相似词条  
- Top‑K + 语法标签加权  

### 5.3 多维筛选
- 主题 tag / 语法 tag / 难度等级  
- 是否有语音 / 是否有例句  
- 时间窗口与来源筛选  

---

## 6. 前端体验（功能方向）
- **词条详情页**：三语释义 + 例句 + 语音 + 语法点  
- **语法专题页**：自动归纳结果 + 相关词条  
- **搜索页**：关键词 + 语义检索  
- **学习周报**：自动更新的归纳摘要  

---

## 7. 运维与可扩展
- **版本与审计**：保留生成版本与修改记录  
- **数据回填**：支持从既有 Markdown/Audio 反向入库  
- **模型可替换**：LLM/Embedding/TTS 统一适配层  
- **导出能力**：按标签/日期批量导出学习清单  

---

## 8. 落地顺序（不写代码）
1. **Schema 设计与迁移**：确定 Entry/Translation/Example/Audio/Summary  
2. **现有数据入库**：批量扫描历史卡片回填数据库  
3. **Embedding + 搜索**：支持语义检索与多维过滤  
4. **定期归纳**：自动分类与语法总结任务  
5. **前端升级**：搜索页 + 专题页 + 归纳报告页  

---

以上方案以“可用、可扩展、可归纳”为核心思路，既能保持现有生成流程，又能逐步升级为可检索、可沉淀的三语知识系统。
