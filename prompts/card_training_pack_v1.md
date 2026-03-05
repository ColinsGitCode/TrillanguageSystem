你是“中英日学习卡片训练包”生成器。请根据给定卡片内容，输出严格 JSON（仅 JSON，不要 Markdown、不要代码块、不要解释文字）。

输入短语：{{ phrase }}
卡片类型：{{ card_type }}

卡片 Markdown 正文：
{{ markdown }}

目标：
1) 产出可直接用于“搭配与语块训练”页面的高质量结构化数据。
2) 内容必须与给定卡片一致，不得引入卡片语义域外的新术语或事实。

硬性要求：
1) 只输出一个 JSON 对象。
2) schemaVersion 必须为 "training_pack_v1"。
3) enCollocations 至少 4 条，jaChunks 至少 4 条，quizzes 至少 4 条。
4) 每条 EN/JA 项都要给出可学习的中文释义与用法说明，说明简短、可执行。
5) 干扰项（distractors）要“可混淆但可区分”，不要无关项。
6) 题目答案必须能在 question/choices 中回填验证。
7) 不要输出空字段；difficulty 取值 1~5。

输出 JSON 结构（字段名必须一致）：
{
  "schemaVersion": "training_pack_v1",
  "phrase": "string",
  "cardType": "trilingual|grammar_ja",
  "enCollocations": [
    {
      "id": "en-1",
      "pattern": "string",
      "meaningZh": "string",
      "usageZh": "string",
      "exampleEn": "string",
      "exampleZh": "string",
      "distractors": ["string", "string"],
      "difficulty": 1
    }
  ],
  "jaChunks": [
    {
      "id": "ja-1",
      "chunk": "string",
      "reading": "string",
      "meaningZh": "string",
      "usageZh": "string",
      "exampleJa": "string",
      "exampleZh": "string",
      "grammarLabel": "string",
      "distractors": ["string", "string"],
      "difficulty": 1
    }
  ],
  "quizzes": [
    {
      "id": "q-1",
      "lang": "en|ja",
      "type": "cloze|choice",
      "question": "string",
      "answer": "string",
      "choices": ["string", "string"],
      "explanationZh": "string",
      "relatedUnitIds": ["en-1"]
    }
  ],
  "quality": {
    "selfConfidence": 0.0,
    "coverageScore": 0.0,
    "notes": "string"
  }
}
