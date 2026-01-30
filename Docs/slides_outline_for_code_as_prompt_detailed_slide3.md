# Code as Prompt: 核心理念深度解析 (Deep Dive)
## Detailed Expansion for Slide 3

---

## Slide 3.0: 核心理念概览 (The Core Philosophy)
- **核心定义**:
    - "Code as Prompt" (CaP) 是指将 Prompt 视为软件工程中的**代码资产**，而非配置文件中的静态字符串。
    - 它遵循软件工程原则：模块化 (Modularity)、版本控制 (Version Control)、类型安全 (Type Safety) 和动态构建 (Dynamic Construction)。
- **传统 vs CaP**:
    - *传统*: `const prompt = "Please translate " + text` (脆弱、难以维护、易幻觉)。
    - *CaP*: `const prompt = PromptBuilder.create().withContext(ctx).withSchema(schema).build()` (健壮、可测试、结构化)。

---

## Slide 3.1: 为什么需要 Code as Prompt? (Why CaP?)
- **解决三大难题**:
    1.  **非结构化输出 (Unstructured Output)**: LLM 默认喜欢“聊天”，难以对接后端 API。
    2.  **上下文缺失 (Context Loss)**: 静态 Prompt 无法根据用户输入的细微差别（如语言、场景）调整指令。
    3.  **幻觉控制 (Hallucination Control)**: 缺乏思维链引导的 Prompt 容易生成看似合理但逻辑错误的内容。
- **解决方案**: 通过**代码逻辑**来强制约束模型的行为边界。

---

## Slide 3.2: 架构拆解：Prompt 的五层模型 (The 5-Layer Model)
我们将一个生产级 Prompt 拆解为五个独立的模块，由 `promptEngine.js` 动态组装：

1.  **System Role (角色层)**: 定义 AI 的身份（语言专家）、能力边界与语气。
2.  **CoT Guidance (思维链层)**: 预设隐式推理步骤（识别语言 -> 多义词消歧 -> 确定语域 -> 生成例句）。
3.  **Few-Shot Examples (样本层)**: 提供高质量的输入/输出对（动态选择：针对技术词汇展示技术示例，针对日常词汇展示生活示例）。
4.  **Detailed Requirements (指令层)**: 具体的业务规则（如“日语外来语必须标注英文”、“例句长度限制”）。
5.  **Data Contract (契约层)**: 严格的 JSON Schema 定义，确保输出可被程序解析。

---

## Slide 3.3: 关键机制 I：动态上下文注入 (Dynamic Context Injection)
- **机制**: Prompt 不是写死的，而是由代码在**运行时 (Runtime)** 生成的。
- **场景举例**:
    - *输入检测*: 当代码检测到用户输入包含日文（如 "こんにちは"）时...
    - *动态调整*: 代码自动向 Prompt 的 `Detailed Requirements` 层注入：“注意：输入为日语，请确保英文例句是翻译而非原文”。
    - *代码体现*:
      ```javascript
      if (isJapanese(phrase)) {
          requirements += "\n- 英文部分例句必须是英语，不能是日语";
      }
      ```

---

## Slide 3.4: 关键机制 II：思维链编排 (CoT Orchestration)
- **理念**: 不要只告诉 AI *做什么* (What)，要告诉它 *怎么思考* (How)。
- **实现**: 在 Prompt 中硬编码 `## 推理步骤`。
- **流程**:
    1.  **语言识别**: 先判断是 En/Ja/Zh。
    2.  **词性分析**: 名词/动词/短语？
    3.  **消歧策略**: 是否有多义词（run: 跑 vs 运行）？
    4.  **生成执行**: 最后才生成 JSON。
- **价值**: 强制模型在生成最终 JSON 之前进行“内部打草稿”，显著提升复杂任务的准确率。

---

## Slide 3.5: 关键机制 III：数据契约与类型安全 (Data Contracts)
- **挑战**: LLM 输出的 JSON 往往不稳定（缺字段、格式错误）。
- **CaP 策略**:
    - **Prompt 端**: 提供极其详尽的 JSON Template，甚至 TypeScript Interface 定义。
    - **Code 端**: 后端 (`server.js`) 实现 `validateGeneratedContent` 函数，对 LLM 返回的 JSON 进行 Schema 校验。
    - **闭环**: 如果校验失败，代码可以自动触发 Retry，并将错误信息反馈给 LLM（Self-Correction）。

---

## Slide 3.6: 代码实战 (Code Implementation View)
*(展示 `services/promptEngine.js` 的伪代码结构)*

```javascript
class PromptEngine {
    build(phrase, options) {
        const role = this.getRole();
        const examples = this.selectFewShots(phrase); // 动态选择示例
        const constraints = this.buildConstraints(options); // 注入业务规则
        
        // 核心：将 JSON Schema 硬编码进 Prompt
        const schema = `
        You MUST return a JSON object:
        {
            "markdown_content": "...",
            "audio_tasks": [ { "text": "...", "lang": "en" } ]
        }`;

        return `${role}
${examples}
${constraints}
${schema}`;
    }
}
```

---

## Slide 3.7: CaP 的未来演进 (Future of CaP)
- **Prompt Versioning**: 像代码一样管理 Prompt 版本 (v1.0, v1.1)。
- **A/B Testing**: 在线上流量中动态切换 Prompt 模块，评估哪种 Few-Shot 效果更好。
- **DSPy 集成**: 未来引入 DSPy 等框架，实现 Prompt 的自动编译和优化（让 AI 写 Prompt）。

```
