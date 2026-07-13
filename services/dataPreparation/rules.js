'use strict';

const crypto = require('node:crypto');
const path = require('node:path');
const { parseTrilingualMarkdown } = require('../generation/markdownParser');
const { buildAudioTasksFromMarkdown } = require('../generation/htmlRenderer');

const RULE_VERSION = 'tagrules-v1';
const HIGH_CONFIDENCE_TEST_IDS = new Set([402, 467, 477, 478, 493, 496]);
const HOIKUEN_GENERATION_IDS = new Set(Array.from({ length: 30 }, (_value, index) => 846 + index));

const FN_RULES = [
  ['question', /疑问|確認|确认|询问|質問|不确定|不明确|怎么说|如何回答/iu],
  ['judgment', /判断|推测|推量|样态|様態|断定|确信|结论|总结|看起来|好像|仿佛|评价/iu],
  ['advice', /建议|忠告|勧告|劝告|劝诱/iu],
  ['intent', /意愿|意志|目的|目标|愿望|盼望|期待|尽量|准备|下决心|尝试|希望|即将/iu],
  ['request', /请求|许可|拜托|委托|依頼|征求|同意|认可|容许|转达/iu],
  ['prohibit', /禁止|义务|義務|必须|不可以|不许|不应当|拒绝|婉拒|否定/iu],
  ['sequence', /顺序|并列|然后|之后|接续|列举|同时|追加|前后动作|伴随发生/iu],
  ['compare', /比较|程度|超过|超出|难易|幅度|增减|越.+越|区别对比|与其说|范围不仅|更加|进一步/iu],
  ['aspect', /持续|进行|状态|变化|習慣|习惯|完成|发生|结束|刚刚|尚未|未完成|过程中|反复|每月/iu],
  ['condition', /假设|条件|仮定|如果|必然发生|即便|未必|无论如何|不管怎样/iu],
  ['cause', /因果|原因|理由|导致|结果|因此|所以|因为|缘故|背景/iu],
  ['report', /转述|引用|传达|報告|传闻|听到的信息|说过/iu],
  ['give-receive', /授受/iu],
  ['colloquial', /口语|口語|随意|缩略|语气|委婉|不妨/iu],
];

const FN_PHRASE_RULES = [
  ['question', /疑问表达|なんていうんだっけ|では(?:じゃ)?ないでしょうか/iu],
  ['judgment', /要するに|やっぱり|〜?ようです$|とは限らない|かのように|みたい$|安っぽい/iu],
  ['advice', /ほうがいい|べき|なるべく/iu],
  ['intent', /しておこう|ないように|見たい$|ように$|楽しみに|つもり/iu],
  ['prohibit', /わけでもなく|終わらせない|〜まで〜ない/iu],
  ['sequence', /その上|ときに|にあたり|ちなみに|さて|それでも|しかし|^でも|だが/iu],
  ['compare', /かなり|めちゃくちゃ|使い分け|比较用法|動词变化对比|どちらかといえば/iu],
  ['aspect', /飛んじゃう|すでに|なくなる|ところです|しまう$|ている$|ようになってきました|なくなったみたい/iu],
  ['condition', /ていけば|場合|条件形|とは限らない/iu],
  ['cause', /おかげで|^それで$|背景として|理由として/iu],
  ['colloquial', /なんて$|さばくのって|偏口语|～って|なんかこう/iu],
];

const TOPIC_RULES = [
  ['software-eng', /\b(?:api|server|database|docker|git|github|deploy(?:ment)?|frontend|backend|runtime|cache|storage|schema|code|coding|software|http|json|sql)\b|代码|数据库|部署|前端|后端|缓存|存储|架构|接口|服务器|运行时|软件工程/iu],
  ['ai-data', /\b(?:ai|llm|machine learning|deep learning|model|embedding|vector|rag|dataset|prompt)\b|人工智能|机器学习|深度学习|大模型|向量|数据集|提示词/iu],
  ['finance-biz', /\b(?:finance|financial|bank|stock|fund|invoice|payment|revenue|cost|budget|contract)\b|金融|银行|股票|基金|发票|付款|预算|合同|费用/iu],
  ['childcare', /保育園|保育园|育児|育儿|联络簿|連絡帳|睡眠|食欲|咳|鼻水|便秘|絵本|绘本/iu],
  ['net-slang', /摆烂|躺平|内卷|破防|上头|网红|梗|ネットスラング/iu],
];

function normalizeMarkdown(markdown) {
  return String(markdown || '').replace(/^\uFEFF/, '').replace(/\r\n?/g, '\n');
}

function sha256(value) {
  return crypto.createHash('sha256').update(value).digest('hex');
}

function contentHash(markdown) {
  return sha256(normalizeMarkdown(markdown));
}

function repairMarkdownStructure(record, markdown, strategy) {
  const normalized = normalizeMarkdown(markdown);
  const lines = normalized.split('\n');
  const title = `# ${String(record.phrase || '').trim()}`;

  if (strategy === 'prefix-title-before-first-section') {
    const sectionIndex = lines.findIndex((line) => /^##\s+\d+\./u.test(line));
    if (sectionIndex < 0) throw new Error(`no numbered section found for generation ${record.id}`);
    return normalizeMarkdown(`${title}\n${lines.slice(sectionIndex).join('\n')}`);
  }
  if (strategy === 'promote-first-heading') {
    if (!/^##\s+/u.test(lines[0] || '')) throw new Error(`first heading is not H2 for generation ${record.id}`);
    lines[0] = lines[0].replace(/^##\s+/u, '# ');
    return normalizeMarkdown(lines.join('\n'));
  }
  if (strategy === 'recover-inline-title') {
    const titleIndex = String(lines[0] || '').indexOf('# ');
    if (titleIndex < 0) throw new Error(`inline title not found for generation ${record.id}`);
    lines[0] = lines[0].slice(titleIndex);
    return normalizeMarkdown(lines.join('\n'));
  }
  throw new Error(`unsupported repair strategy: ${strategy}`);
}

function folderNameToGenerationDate(folderName) {
  const match = String(folderName || '').match(/^(\d{4})(\d{2})(\d{2})$/u);
  if (!match) return null;
  const [, year, month, day] = match;
  const date = new Date(`${year}-${month}-${day}T00:00:00Z`);
  if (Number.isNaN(date.getTime())) return null;
  if (date.toISOString().slice(0, 10) !== `${year}-${month}-${day}`) return null;
  return `${year}-${month}-${day}`;
}

function normalizeTagValue(value) {
  return String(value || '').normalize('NFKC').trim().toLocaleLowerCase('und');
}

function inferLanguage(record) {
  const cardType = String(record.card_type || 'trilingual');
  const phrase = String(record.phrase || '').normalize('NFKC');
  const hasKana = /[\u3040-\u30ff]/u.test(phrase);
  const hasHan = /[\u3400-\u9fff々〆ヵヶ]/u.test(phrase);
  const hasLatin = /[A-Za-z]/u.test(phrase);

  if (cardType === 'grammar_ja') {
    return { value: 'ja', ruleKey: 'lang.card-type.grammar-ja', evidence: { cardType } };
  }
  if (cardType === 'scenario_phrase' && hasHan && !hasKana && !hasLatin) {
    return { value: 'zh', ruleKey: 'lang.scenario.han-input', evidence: { cardType, hasHan } };
  }
  if (hasKana && hasLatin) {
    return { value: 'mixed', ruleKey: 'lang.characters.kana-latin', evidence: { hasKana, hasLatin } };
  }
  if (hasKana) {
    return { value: 'ja', ruleKey: 'lang.characters.kana', evidence: { hasKana } };
  }
  if (hasHan && hasLatin) {
    return { value: 'mixed', ruleKey: 'lang.characters.han-latin', evidence: { hasHan, hasLatin } };
  }
  if (hasHan) {
    return { value: 'unknown', ruleKey: 'lang.characters.han-ambiguous', evidence: { hasHan } };
  }
  if (hasLatin) {
    return { value: 'en', ruleKey: 'lang.characters.latin', evidence: { hasLatin } };
  }
  return { value: 'unknown', ruleKey: 'lang.characters.unresolved', evidence: {} };
}

function inferSource(record) {
  const sourceMode = String(record.source_mode || '').trim().toLowerCase();
  if (['input', 'selection', 'ocr', 'manual'].includes(sourceMode)) {
    return {
      value: sourceMode,
      ruleKey: `src.source-mode.${sourceMode}`,
      evidence: { sourceMode },
    };
  }
  if (HOIKUEN_GENERATION_IDS.has(Number(record.id))) {
    return {
      value: 'hoikuen-import',
      ruleKey: 'src.import.hoikuen-generation-manifest',
      evidence: { generationId: Number(record.id), manifest: 'hoikuen-20260713-v1' },
    };
  }
  return { value: 'unknown', ruleKey: 'src.metadata.unresolved', evidence: { sourceMode: null } };
}

function extractFunctionTags(record) {
  if (record.card_type !== 'grammar_ja') return [];
  const phrase = String(record.phrase || '');
  const separator = phrase.search(/[：:]/u);
  const annotation = separator >= 0 ? phrase.slice(separator + 1).trim() : '';
  const annotationTags = FN_RULES
    .filter(([_value, pattern]) => pattern.test(annotation))
    .map(([value]) => ({
      value,
      ruleKey: `fn.annotation.${value}`,
      evidence: { annotation },
    }));
  const phraseTags = FN_PHRASE_RULES
    .filter(([_value, pattern]) => pattern.test(phrase))
    .map(([value]) => ({
      value,
      ruleKey: `fn.phrase.${value}`,
      evidence: { phrase },
    }));
  const byValue = new Map();
  [...annotationTags, ...phraseTags].forEach((tag) => {
    if (!byValue.has(tag.value)) byValue.set(tag.value, tag);
  });
  return [...byValue.values()];
}

function inferTopicTags(record) {
  const haystack = `${record.phrase || ''}\n${record.markdown_content || ''}`;
  return TOPIC_RULES
    .filter(([_value, pattern]) => pattern.test(haystack))
    .map(([value]) => ({
      value,
      ruleKey: `topic.keyword.${value}`,
      evidence: { phrase: String(record.phrase || '').slice(0, 160) },
    }));
}

function inferTestCandidate(record) {
  const phrase = String(record.phrase || '');
  if (HIGH_CONFIDENCE_TEST_IDS.has(Number(record.id))) {
    return {
      value: 'test-artifact-candidate',
      ruleKey: 'qa.test.known-generation-manifest',
      evidence: { generationId: Number(record.id), phrase },
    };
  }
  const patterns = [
    /(?:限流|压测|fixture|e2e|playwright|测试卡|测试数据|OCR\s*test)/iu,
    /请注意今天的日期/iu,
    /\b(?:frontend|backend|gateway)\s+smoke\b/iu,
  ];
  const matched = patterns.find((pattern) => pattern.test(phrase));
  if (!matched) return null;
  return {
    value: 'test-artifact-candidate',
    ruleKey: 'qa.test.high-confidence-pattern',
    evidence: { phrase, pattern: matched.source },
  };
}

function analyzeMarkdown(record, markdown) {
  const normalized = normalizeMarkdown(markdown);
  const parsed = parseTrilingualMarkdown(normalized);
  const audioTasks = buildAudioTasksFromMarkdown(normalized);
  const type = record.card_type;
  let sections = false;
  let examples = false;
  let expectedAudio = false;

  if (type === 'trilingual') {
    sections = ['en', 'ja', 'zh'].every((language) => parsed.meta.sectionOrder.includes(language));
    examples = parsed.sections.en.examples.length >= 2 && parsed.sections.ja.examples.length >= 2;
    expectedAudio = audioTasks.filter((task) => task.lang === 'en').length >= 2
      && audioTasks.filter((task) => task.lang === 'ja').length >= 2;
  } else if (type === 'grammar_ja') {
    sections = parsed.meta.sectionOrder.includes('ja');
    examples = parsed.sections.ja.examples.length >= 3;
    expectedAudio = audioTasks.filter((task) => task.lang === 'ja').length >= 3;
  } else if (type === 'scenario_phrase') {
    const headings = (normalized.match(/^###\s+\d{2}\./gm) || []).length;
    const chinese = (normalized.match(/^\s*-\s*\*\*中文\*\*\s*[:：]/gm) || []).length;
    const english = (normalized.match(/^\s*-\s*\*\*英文\*\*\s*[:：]/gm) || []).length;
    const japanese = (normalized.match(/^\s*-\s*\*\*日本語\*\*\s*[:：]/gm) || []).length;
    sections = /^##\s*1\.\s*场景说明/m.test(normalized)
      && /^##\s*2\.\s*常用表达/m.test(normalized);
    examples = headings === 12 && chinese === 12 && english === 12 && japanese === 12;
    expectedAudio = audioTasks.filter((task) => task.lang === 'en').length === 12
      && audioTasks.filter((task) => task.lang === 'ja').length === 12;
  }

  return {
    hasTitle: parsed.meta.hasTitle,
    sections,
    examples,
    expectedAudio,
    audioTaskCount: audioTasks.length,
    reviewRequired: !(parsed.meta.hasTitle && sections && examples && expectedAudio),
  };
}

function resolveRecordPath(filePath, recordsPath) {
  const raw = String(filePath || '');
  if (!raw) return '';
  if (raw.startsWith('/data/trilingual_records')) {
    return path.join(recordsPath, raw.slice('/data/trilingual_records'.length));
  }
  return raw;
}

module.exports = {
  RULE_VERSION,
  HIGH_CONFIDENCE_TEST_IDS,
  HOIKUEN_GENERATION_IDS,
  normalizeMarkdown,
  sha256,
  contentHash,
  repairMarkdownStructure,
  folderNameToGenerationDate,
  normalizeTagValue,
  inferLanguage,
  inferSource,
  extractFunctionTags,
  inferTopicTags,
  inferTestCandidate,
  analyzeMarkdown,
  resolveRecordPath,
};
