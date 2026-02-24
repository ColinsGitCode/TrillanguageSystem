# 前端架构文档

**项目**: Trilingual Records  
**版本**: 3.3
**更新日期**: 2026-02-24

## 1. 前端目录

```text
public/
├── index.html
├── dashboard.html
├── styles.css
├── modern-card.css
├── observability.css
├── favicon-lan.svg
├── css/
│   └── dashboard.css
└── js/
    └── modules/
        ├── app.js
        ├── dashboard.js
        ├── api.js
        ├── store.js
        ├── utils.js
        ├── audio-player.js
        ├── info-modal.js
        └── virtual-list.js
```

## 2. 主界面布局（index）

```text
Header (TRILINGUAL RECORDS + Mission Control)
├─ 左侧：生成面板（文本输入 / OCR / 进度）
├─ 右侧：Phrase List（学习卡片列表）
└─ 下方：资源区 Tabs（文件夹 / 历史记录）
```

### 2.1 关键交互

- 生成成功后自动刷新列表并定位到目标日期目录
- 页面常驻操作时保持当前选中目录
- 页面刷新时默认显示最近日期目录
- 卡片列表支持多列自适应显示

## 3. 卡片弹窗（Viewer Modal）

### 3.1 单卡弹窗 Tabs

- `CONTENT`：卡片正文 + 例句音频
- `INTEL`：质量/Token/性能/Prompt/LLM Output
- `REVIEW`（有 generationId 时显示）：例句人工评分与评论

### 3.2 INTEL 页能力

- Prompt / LLM Output 支持 `RAW` / `STRUCT` 切换
- 支持一键复制
- 指标说明 `?` 按钮弹窗（info-modal）

### 3.3 REVIEW 页能力

- 每条例句评分：`原句 / 翻译 / TTS`（1~5）
- 决策：`推荐注入 / 不推荐注入 / 中立`
- 评论：文本备注
- 批次动作：
  - 创建批次、查看进度、刷新
  - 统一处理并入池（要求全量评审完成）
  - **采样处理**（绿色按钮）：跳过未评审样本，按 `minReviewRate=0.3` 门控（v3.3 新增）
  - **回滚**（红色按钮，二次确认）：已完成批次重置为 active（v3.3 新增）
  - **已完成** 标签（蓝色 badge）：finalized 批次状态标识（v3.3 新增）

## 4. 对比模式弹窗

- 左右双列并排显示 Gemini / Local 内容
- 同时支持 CONTENT 与 INTEL 对照
- 结果区含 winner 与 metrics 对比
- 支持按模型侧删除对应生成记录

## 5. Mission Control（dashboard）

定位：系统级统计大盘（不是单卡调试页）

主要模块：

- 质量趋势
- Token 趋势
- 延迟趋势
- provider 分布
- 近期记录与基础健康信息

## 6. 状态管理与 API 封装

- 状态：`store.js`
  - `selectedFolder`、`selectedFile`
  - `llmProvider`、`modelMode`、`compareMode`
- API：`api.js`
  - 生成/OCR/历史/统计
  - 评审 campaign（创建/finalize/rollback）与评分提交
  - 删除与文件读取

## 7. 视觉与可用性

- 主页面：浅色、内容密度高、卡片化
- 对比弹窗：宽视图对照优先
- Mission Control：仪表盘风格
- 浏览器标签页图标：`favicon-lan.svg`（LAN）

## 8. 与后端主线关系

- 前端不直接执行 few-shot 逻辑，只透传配置
- 单卡详细实验字段由 `observability.metadata` 驱动
- review-gated 流程通过评审 API 触发，最终由后端 finalize 后生效

---

**维护者**: Three LANS Team
