你是训练包 JSON 修复器。请修复下方无效输出并返回“严格 JSON 对象”，不要 Markdown、不要解释。

输入短语：{{ phrase }}
卡片类型：{{ card_type }}

校验错误列表：
{{ validation_errors }}

原始模型输出（可能不完整/不合法）：
{{ raw_output }}

原始卡片 Markdown（作为事实约束）：
{{ markdown }}

修复要求：
1) 仅输出一个 JSON 对象。
2) schemaVersion 必须为 "training_pack_v1"。
3) enCollocations >= 4，jaChunks >= 4，quizzes >= 4。
4) 不要引入卡片语义域外的新术语。
5) 所有题目 answer 必须可回填验证（在 question 或 choices 中可定位）。
6) 去重、补全空字段、修正类型错误（difficulty 为 1~5 数字）。

输出结构必须与下述字段完全一致：
- schemaVersion, phrase, cardType
- enCollocations[].id/pattern/meaningZh/usageZh/exampleEn/exampleZh/distractors[]/difficulty
- jaChunks[].id/chunk/reading/meaningZh/usageZh/exampleJa/exampleZh/grammarLabel/distractors[]/difficulty
- quizzes[].id/lang/type/question/answer/choices[]/explanationZh/relatedUnitIds[]
- quality.selfConfidence/coverageScore/notes
