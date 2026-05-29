'use strict';

// Curated semantic taxonomy for the knowledge `cluster` task. Two axes:
//
//   - `function` axis: applied to japanese-grammar cards (card_type ===
//     'grammar_ja'). Modeled on the Feishu "日语句式索引" base, which buckets
//     grammar patterns by communicative function (questioning, advising,
//     comparing, …) rather than by topic.
//   - `topic` axis: applied to everything else (trilingual vocab cards).
//     Buckets cards by subject domain (engineering, AI, business, …).
//
// Each category is `{ key, label, desc, axis, keywords[] }`. Keys are globally
// unique across both axes (prefixed `fn_` / `tp_`) because cluster_key is the
// lookup handle in knowledge_clusters and must not collide between axes. Every
// axis ends with a fallback category (no keywords) that catches cards the
// rules + LLM could not place.

const FUNCTION_TAXONOMY = [
  {
    key: 'fn_question',
    label: '疑问·询问',
    desc: '提问、反问、确认与征询信息的句式',
    axis: 'function',
    keywords: ['か', 'かな', 'かしら', 'のか', 'だろうか', 'でしょうか', '疑问', '反问', '询问', '提问', 'question', 'whether']
  },
  {
    key: 'fn_judgment',
    label: '判断·推测·评价',
    desc: '判定、推断、预测、评价与说明的句式',
    axis: 'function',
    keywords: ['はずだ', 'に違いない', 'かもしれない', 'らしい', 'ようだ', 'みたい', 'そうだ', 'と思う', '判断', '推测', '推断', '预测', '评价', '说明', 'probably', 'seem', 'judgment']
  },
  {
    key: 'fn_advice',
    label: '建议·忠告·推荐',
    desc: '提出建议、忠告与推荐的句式',
    axis: 'function',
    keywords: ['ほうがいい', 'べきだ', 'なさい', 'たらどう', 'すすめ', '勧め', '建议', '忠告', '推荐', 'should', 'recommend', 'advice', 'had better']
  },
  {
    key: 'fn_intention',
    label: '意愿·目的·计划',
    desc: '意愿、想要、目的、计划与准备的句式',
    axis: 'function',
    keywords: ['たい', 'たがる', 'つもり', 'ため', 'ように', 'ことにする', '予定', '意愿', '想要', '目的', '计划', '准备', 'want', 'intend', 'plan', 'purpose', 'in order to']
  },
  {
    key: 'fn_request',
    label: '请求·邀请·征求同意',
    desc: '请求、邀请、征求同意与许可的句式',
    axis: 'function',
    keywords: ['てください', 'てくれ', 'てもらえ', 'ましょう', 'ませんか', 'てもいい', '请求', '邀请', '征求', '同意', 'please', 'invite', 'may i', 'could you']
  },
  {
    key: 'fn_prohibition',
    label: '禁止·允许·应该',
    desc: '禁止、不准、允许与义务的句式',
    axis: 'function',
    keywords: ['てはいけない', 'てはならない', 'なければならない', 'ないといけない', 'な', '禁止', '不准', '不行', '允许', '应该', 'must not', 'forbidden', 'have to', 'not allowed']
  },
  {
    key: 'fn_sequence',
    label: '顺序·并列·列举',
    desc: '动作顺序、并列与列举的句式',
    axis: 'function',
    keywords: ['てから', 'たあとで', 'まえに', 'ながら', 'し', 'たり', 'とともに', '顺序', '并列', '列举', 'and', 'then', 'before', 'after', 'while', 'sequence']
  },
  {
    key: 'fn_comparison',
    label: '比较·对照·类似',
    desc: '比较、对照、类似与程度差异的句式',
    axis: 'function',
    keywords: ['より', 'ほど', 'くらい', 'ような', 'と同じ', 'に比べ', '比较', '对比', '对照', '类似', 'than', 'as as', 'compare', 'similar', 'like']
  },
  {
    key: 'fn_aspect',
    label: '时·体·变化',
    desc: '持续、完成、未完成与变化等时体表达',
    axis: 'function',
    keywords: ['ている', 'てある', 'ておく', 'てしまう', 'たところ', 'になる', 'くなる', 'てくる', 'ていく', '持续', '完成', '未完成', '变化', 'continue', 'finish', 'become', 'change']
  },
  {
    key: 'fn_hypothesis',
    label: '假设·条件',
    desc: '虚拟、假设与条件的句式',
    axis: 'function',
    keywords: ['ば', 'たら', 'なら', 'と', 'ても', 'としたら', '假设', '假如', '条件', '虚拟', 'if', 'unless', 'suppose', 'condition']
  },
  {
    key: 'fn_causation',
    label: '因果关系',
    desc: '原因、理由与结果的句式',
    axis: 'function',
    keywords: ['から', 'ので', 'ため', 'おかげで', 'せいで', 'によって', '因为', '由于', '所以', '因果', '原因', '理由', 'because', 'so', 'therefore', 'due to', 'cause']
  },
  {
    key: 'fn_frequency',
    label: '频率·数量',
    desc: '频率、次数与数量关系的句式',
    axis: 'function',
    keywords: ['ことがある', 'たびに', 'ずつ', 'おき', 'ごと', '频率', '次数', '数量', 'often', 'every', 'times', 'frequency', 'amount']
  },
  {
    key: 'fn_reporting',
    label: '转述·传达',
    desc: '引用、转述与传达信息的句式',
    axis: 'function',
    keywords: ['そうだ', 'という', 'とのこと', 'によると', 'と言って', '转述', '传达', '引用', '据说', 'reportedly', 'according to', 'said that', 'quote']
  },
  {
    key: 'fn_giving_receiving',
    label: '授受关系',
    desc: '给予、接受与恩惠方向的句式',
    axis: 'function',
    keywords: ['あげる', 'くれる', 'もらう', 'てあげる', 'てくれる', 'てもらう', '授受', '给予', '接受', 'give', 'receive', 'favor']
  },
  {
    key: 'fn_concession',
    label: '转折·让步',
    desc: '转折、让步与逆接的句式',
    axis: 'function',
    keywords: ['が', 'けど', 'のに', 'ても', 'ながらも', 'にもかかわらず', '转折', '让步', '虽然', '但是', 'but', 'however', 'although', 'even though', 'despite']
  },
  {
    key: 'fn_voice',
    label: '动词语态',
    desc: '被动、使役、可能与自他动词等语态',
    axis: 'function',
    keywords: ['られる', 'れる', 'させる', 'させられる', '可能', '被动', '使役', '语态', '自动词', '他动词', 'passive', 'causative', 'potential', 'voice']
  },
  {
    key: 'fn_scope',
    label: '范围·限定',
    desc: '限定、范围与所属关系的句式',
    axis: 'function',
    keywords: ['だけ', 'しか', 'のみ', 'ばかり', 'まで', 'について', '范围', '限定', '所属', 'only', 'just', 'scope', 'about', 'regarding']
  },
  {
    key: 'fn_conjunction',
    label: '接续·口语表达',
    desc: '接续词、常用短语与口语连接表达',
    axis: 'function',
    keywords: ['それで', 'そして', 'でも', 'ところで', 'つまり', '要するに', '接续', '连接词', '短语', '口语', 'conjunction', 'by the way', 'in short']
  },
  {
    key: 'fn_other',
    label: '其他句式',
    desc: '规则与模型均未能归类的语法句式',
    axis: 'function',
    keywords: []
  }
];

const TOPIC_TAXONOMY = [
  {
    key: 'tp_engineering',
    label: '工程技术',
    desc: '架构、接口、性能、运维与系统工程相关表达',
    axis: 'topic',
    keywords: ['api', 'queue', 'retry', 'latency', 'throughput', 'cache', 'docker', 'proxy', 'database', 'db', 'deploy', 'server', 'pipeline', '架构', '接口', '性能', '运维', '可观测', '高可用', '重试', '部署', '系统']
  },
  {
    key: 'tp_ai_data',
    label: 'AI与数据',
    desc: '人工智能、机器学习、模型与数据相关表达',
    axis: 'topic',
    keywords: ['model', 'prompt', 'token', 'llm', 'embedding', 'dataset', 'training', 'inference', 'neural', 'agent', '模型', '提示词', '推理', '训练', '数据', '机器学习', '人工智能', '向量']
  },
  {
    key: 'tp_communication',
    label: '沟通表达',
    desc: '解释、总结、论述、转述与表达技巧',
    axis: 'topic',
    keywords: ['explain', 'clarify', 'summarize', 'persuade', 'argue', 'feedback', '简而言之', '也就是说', '说明', '解释', '总结', '论述', '表达', '沟通', '焦点', '舆论']
  },
  {
    key: 'tp_business',
    label: '商务职场',
    desc: '商务、职场、管理与商业流程相关表达',
    axis: 'topic',
    keywords: ['meeting', 'client', 'project', 'deadline', 'budget', 'strategy', 'revenue', 'market', 'manager', 'negotiat', '商务', '职场', '会议', '客户', '项目', '预算', '战略', '管理', '市场', '业务']
  },
  {
    key: 'tp_academic',
    label: '学术研究',
    desc: '学术、研究、论文与理论相关表达',
    axis: 'topic',
    keywords: ['research', 'theory', 'hypothesis', 'analysis', 'experiment', 'thesis', 'study', 'evidence', 'academic', '研究', '学术', '论文', '理论', '假设', '分析', '实验', '文献']
  },
  {
    key: 'tp_daily',
    label: '日常生活',
    desc: '日常生活、饮食、出行与家庭相关表达',
    axis: 'topic',
    keywords: ['food', 'travel', 'family', 'shopping', 'weather', 'health', 'hobby', 'home', '日常', '生活', '饮食', '出行', '家庭', '购物', '天气', '健康', '爱好']
  },
  {
    key: 'tp_society',
    label: '社会时事',
    desc: '社会、文化、新闻与时事相关表达',
    axis: 'topic',
    keywords: ['society', 'culture', 'news', 'politics', 'economy', 'environment', 'policy', 'public', '社会', '文化', '新闻', '政治', '经济', '环境', '政策', '时事', '舆论']
  },
  {
    key: 'tp_general',
    label: '通用/其他',
    desc: '规则与模型均未能归类的常规词汇',
    axis: 'topic',
    keywords: []
  }
];

const AXIS_TAXONOMY = {
  function: FUNCTION_TAXONOMY,
  topic: TOPIC_TAXONOMY
};

const FALLBACK_KEY = {
  function: 'fn_other',
  topic: 'tp_general'
};

// grammar_ja cards go on the communicative-function axis; everything else
// (notably trilingual vocab) goes on the topic axis.
function axisForCardType(cardType) {
  return String(cardType || '').trim().toLowerCase() === 'grammar_ja' ? 'function' : 'topic';
}

function getTaxonomy(axis) {
  return AXIS_TAXONOMY[axis] || TOPIC_TAXONOMY;
}

function getFallbackKey(axis) {
  return FALLBACK_KEY[axis] || 'tp_general';
}

function getCategory(axis, key) {
  return getTaxonomy(axis).find((cat) => cat.key === key) || null;
}

// Keys the LLM is allowed to assign on a given axis (fallback excluded — the
// model should only place cards it can confidently bucket; everything else
// stays in the fallback).
function assignableKeys(axis) {
  return getTaxonomy(axis)
    .filter((cat) => cat.key !== getFallbackKey(axis))
    .map((cat) => cat.key);
}

module.exports = {
  FUNCTION_TAXONOMY,
  TOPIC_TAXONOMY,
  axisForCardType,
  getTaxonomy,
  getFallbackKey,
  getCategory,
  assignableKeys,
};
