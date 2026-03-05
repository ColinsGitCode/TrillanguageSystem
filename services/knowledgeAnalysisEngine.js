const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

function stripHtml(text) {
  return String(text || '').replace(/<[^>]*>/g, '');
}

function normalizeText(text) {
  return stripHtml(String(text || ''))
    .replace(/[ \t\r\n]+/g, ' ')
    .replace(/[\u200B-\u200D\uFEFF]/g, '')
    .trim();
}

function profileLang(text) {
  const input = String(text || '');
  const hasZh = /[\u4e00-\u9fff]/.test(input);
  const hasJa = /[\u3040-\u30ff]/.test(input);
  const hasEn = /[A-Za-z]/.test(input);
  if (hasZh && !hasJa && !hasEn) return 'zh';
  if (!hasZh && hasJa && !hasEn) return 'ja';
  if (!hasZh && !hasJa && hasEn) return 'en';
  return 'mixed';
}

function extractEnHeadword(record) {
  const phrase = String(record.phrase || '');
  const enFromPhrase = phrase.match(/[A-Za-z][A-Za-z\s\-']*/);
  if (enFromPhrase && enFromPhrase[0]) return enFromPhrase[0].trim();
  return normalizeText(record.en_translation || '').slice(0, 80) || null;
}

function extractJaHeadword(record) {
  const phrase = String(record.phrase || '');
  if (/[\u3040-\u30ff]/.test(phrase)) return normalizeText(phrase).slice(0, 80);
  const ja = normalizeText(record.ja_translation || '');
  if (!ja) return null;
  return ja
    .replace(/\([^)]*\)/g, '')
    .replace(/[（][^）]*[）]/g, '')
    .slice(0, 80)
    .trim() || null;
}

function extractZhHeadword(record) {
  const phrase = String(record.phrase || '');
  const zhPhrase = phrase.match(/[\u4e00-\u9fff]{1,}/g);
  if (zhPhrase && zhPhrase.length) return zhPhrase.join('').slice(0, 40);
  return normalizeText(record.zh_translation || '').slice(0, 40) || null;
}

function buildAliases(record) {
  const set = new Set();
  [record.phrase, record.en_translation, record.ja_translation, record.zh_translation].forEach((value) => {
    const normalized = normalizeText(value);
    if (normalized) set.add(normalized);
  });
  return Array.from(set).slice(0, 12);
}

function inferTags(record) {
  const text = normalizeText([
    record.phrase,
    record.en_translation,
    record.ja_translation,
    record.zh_translation,
    record.markdown_content
  ].join(' ')).toLowerCase();

  const tags = [];
  const rules = [
    { tag: 'ai-tech', keys: ['model', 'prompt', 'token', 'llm', '推理', '模型', '提示词'] },
    { tag: 'engineering', keys: ['api', 'queue', 'retry', 'latency', 'circuit', 'cache', 'docker', 'proxy', 'db', 'database'] },
    { tag: 'communication', keys: ['简而言之', '也就是说', '要するに', 'つまり', 'explain', 'clarify'] },
    { tag: 'grammar-ja', keys: ['文法', 'grammar', '〜', 'わけでもなく', '要するに'] }
  ];
  rules.forEach((rule) => {
    if (rule.keys.some((key) => text.includes(String(key).toLowerCase()))) {
      tags.push(rule.tag);
    }
  });
  if (!tags.length) tags.push('general');
  return Array.from(new Set(tags));
}

function extractJapaneseSentences(markdownContent) {
  const text = String(markdownContent || '');
  const sectionMatch = text.match(/##\s*2\.[\s\S]*?(?:##\s*3\.|$)/);
  if (!sectionMatch) return [];
  const section = sectionMatch[0];
  const lines = section.split('\n');
  const sentences = [];
  for (const line of lines) {
    const match = line.match(/^\s*-\s*\*\*例句\d+\*\*:\s*(.+)$/);
    if (match) {
      const sentence = normalizeText(match[1]);
      if (sentence) sentences.push(sentence);
    }
  }
  return sentences;
}

function detectGrammarPatterns(sentence) {
  const knownPatterns = [
    { pattern: '〜わけでもなく', explanationZh: '表示并非完全如此，而是部分否定或缓和表达。' },
    { pattern: '〜要するに', explanationZh: '用于总结前文，表示“简而言之/总之”。' },
    { pattern: '〜ことがある', explanationZh: '表示“有时会……”的经验或偶发事件。' },
    { pattern: '〜ておく', explanationZh: '表示提前做好某动作以备后续。' },
    { pattern: '〜てしまう', explanationZh: '表示动作完成或带有遗憾语气。' },
    { pattern: '〜ように', explanationZh: '表示目的、变化结果或请求。' }
  ];

  const normalized = String(sentence || '');
  return knownPatterns.filter((item) => normalized.includes(item.pattern.replace('〜', '')));
}

function hashFingerprint(parts) {
  return crypto.createHash('sha1').update(parts.join('|')).digest('hex');
}

function runSummary(cards = []) {
  const totals = {
    total: cards.length,
    byCardType: {},
    byProvider: {},
    byLangProfile: {}
  };
  let qualityCount = 0;
  let qualitySum = 0;
  let tokenCount = 0;
  let tokenSum = 0;

  cards.forEach((card) => {
    const cardType = String(card.card_type || 'trilingual');
    const provider = String(card.llm_provider || 'unknown');
    const langProfile = profileLang(card.phrase);
    totals.byCardType[cardType] = (totals.byCardType[cardType] || 0) + 1;
    totals.byProvider[provider] = (totals.byProvider[provider] || 0) + 1;
    totals.byLangProfile[langProfile] = (totals.byLangProfile[langProfile] || 0) + 1;

    if (card.quality_score != null) {
      qualityCount += 1;
      qualitySum += Number(card.quality_score || 0);
    }
    if (card.tokens_total != null) {
      tokenCount += 1;
      tokenSum += Number(card.tokens_total || 0);
    }
  });

  const avgQuality = qualityCount > 0 ? Number((qualitySum / qualityCount).toFixed(2)) : null;
  const avgTokens = tokenCount > 0 ? Number((tokenSum / tokenCount).toFixed(2)) : null;
  const actionItems = [];
  if ((totals.byCardType.grammar_ja || 0) < Math.max(5, Math.round(cards.length * 0.08))) {
    actionItems.push({ priority: 1, action: '提升语法卡占比，优先覆盖高频语法点。' });
  }
  if ((totals.byProvider.local || 0) < 10) {
    actionItems.push({ priority: 2, action: '增加本地模型样本，形成稳定对照集。' });
  }

  return {
    overview: `共分析 ${cards.length} 张卡片。`,
    topTopics: Object.entries(totals.byCardType)
      .sort((a, b) => b[1] - a[1])
      .map(([topic, count]) => ({ topic, count })),
    qualityObservations: [
      {
        finding: avgQuality == null ? '质量数据不足' : `平均质量分 ${avgQuality}`,
        severity: avgQuality != null && avgQuality < 80 ? 'high' : 'low',
        evidenceIds: []
      },
      {
        finding: avgTokens == null ? 'Token 数据不足' : `平均总 Token ${avgTokens}`,
        severity: 'low',
        evidenceIds: []
      }
    ],
    actionItems
  };
}

function runIndex(cards = []) {
  const entries = cards.map((card) => {
    const aliases = buildAliases(card);
    return {
      generationId: Number(card.id),
      phrase: String(card.phrase || ''),
      cardType: String(card.card_type || 'trilingual'),
      folderName: String(card.folder_name || ''),
      langProfile: profileLang(card.phrase),
      enHeadword: extractEnHeadword(card),
      jaHeadword: extractJaHeadword(card),
      zhHeadword: extractZhHeadword(card),
      aliases,
      tags: inferTags(card),
      score: Number(card.quality_score || 0)
    };
  });
  return { entries };
}

function runSynonymBoundary(cards = []) {
  const groupMap = new Map();
  cards.forEach((card) => {
    const key = normalizeText(card.zh_translation || '').toLowerCase();
    if (!key) return;
    if (!groupMap.has(key)) groupMap.set(key, []);
    groupMap.get(key).push(card);
  });

  const groups = [];
  for (const [groupKey, members] of groupMap.entries()) {
    const uniqueTerms = new Set(members.map((item) => normalizeText(item.phrase).toLowerCase()).filter(Boolean));
    if (members.length < 2 || uniqueTerms.size < 2) continue;
    const normalizedMembers = members.slice(0, 10).map((item) => ({
      generationId: Number(item.id),
      term: normalizeText(item.phrase || ''),
      lang: profileLang(item.phrase || '')
    }));
    groups.push({
      groupKey,
      members: normalizedMembers,
      boundaryMatrix: {
        tone: '需人工复核',
        register: '需人工复核',
        collocation: '需结合上下文进一步确认'
      },
      misuseRisk: members.length >= 4 ? 'high' : 'medium',
      recommendation: '优先在卡片中补充使用场景和搭配差异。',
      confidence: 0.62,
      coverageRatio: Math.min(1, members.length / 5)
    });
  }

  return { groups };
}

function runGrammarLink(cards = []) {
  const patternMap = new Map();
  cards.forEach((card) => {
    const sentences = extractJapaneseSentences(card.markdown_content || '');
    sentences.forEach((sentence) => {
      const patterns = detectGrammarPatterns(sentence);
      patterns.forEach((patternInfo) => {
        const key = patternInfo.pattern;
        if (!patternMap.has(key)) {
          patternMap.set(key, {
            pattern: key,
            explanationZh: patternInfo.explanationZh,
            confidence: 0.7,
            exampleRefs: []
          });
        }
        patternMap.get(key).exampleRefs.push({
          generationId: Number(card.id),
          sentence: sentence.slice(0, 140)
        });
      });
    });
  });

  return {
    patterns: Array.from(patternMap.values()).map((item) => ({
      ...item,
      exampleRefs: item.exampleRefs.slice(0, 50)
    }))
  };
}

function runCluster(cards = []) {
  const clusterDefs = [
    { key: 'engineering', label: '工程系统', desc: '架构、接口、性能与运维相关表达', keywords: ['api', 'queue', 'retry', 'latency', 'db', 'database', 'cache', 'docker', 'proxy', '可观测', '高可用', '重试'] },
    { key: 'communication', label: '沟通表达', desc: '解释、总结、转述与论述相关表达', keywords: ['简而言之', '也就是说', '要するに', 'つまり', '说明', '解释', '焦点', '舆论'] },
    { key: 'grammar', label: '日语语法', desc: '语法结构和句型模式', keywords: ['わけでもなく', '〜', '文法', 'grammar', '使い分け'] },
    { key: 'general', label: '通用词汇', desc: '未归类的常规词汇', keywords: [] }
  ];

  const clusters = clusterDefs.map((def) => ({
    clusterKey: def.key,
    label: def.label,
    description: def.desc,
    keywords: def.keywords,
    confidence: 0.6,
    cards: []
  }));

  cards.forEach((card) => {
    const haystack = normalizeText([
      card.phrase,
      card.en_translation,
      card.ja_translation,
      card.zh_translation,
      card.markdown_content
    ].join(' ')).toLowerCase();

    let matched = false;
    for (const cluster of clusters) {
      if (!cluster.keywords.length) continue;
      const hitCount = cluster.keywords.filter((keyword) => haystack.includes(String(keyword).toLowerCase())).length;
      if (hitCount > 0) {
        matched = true;
        cluster.cards.push({
          generationId: Number(card.id),
          score: Number((hitCount / cluster.keywords.length).toFixed(4))
        });
      }
    }
    if (!matched) {
      const fallback = clusters.find((cluster) => cluster.clusterKey === 'general');
      fallback.cards.push({
        generationId: Number(card.id),
        score: 0.2
      });
    }
  });

  return {
    clusters: clusters.filter((cluster) => cluster.cards.length > 0)
  };
}

function runIssuesAudit(cards = []) {
  const issues = [];
  const phraseMap = new Map();

  cards.forEach((card) => {
    const normalizedPhrase = normalizeText(card.phrase || '').toLowerCase();
    if (!normalizedPhrase) return;
    if (!phraseMap.has(normalizedPhrase)) phraseMap.set(normalizedPhrase, []);
    phraseMap.get(normalizedPhrase).push(card);
  });

  for (const [phrase, group] of phraseMap.entries()) {
    if (group.length <= 1) continue;
    group.forEach((card) => {
      issues.push({
        issueType: 'duplicate_phrase',
        severity: group.length >= 3 ? 'high' : 'medium',
        generationId: Number(card.id),
        phrase: card.phrase || '',
        fingerprint: hashFingerprint(['duplicate_phrase', phrase, String(card.id)]),
        detail: {
          phrase,
          duplicateCount: group.length,
          relatedIds: group.map((item) => item.id)
        }
      });
    });
  }

  cards.forEach((card) => {
    const markdown = String(card.markdown_content || '');
    const refs = markdown.match(/<audio\s+controls\s+src="([^"]+)"/g) || [];
    if (!refs.length) return;
    const mdPath = String(card.md_file_path || '');
    const dir = mdPath ? path.dirname(mdPath) : '';
    if (!dir || !fs.existsSync(dir)) return;

    const missing = [];
    refs.forEach((raw) => {
      const m = raw.match(/src="([^"]+)"/);
      const src = m ? m[1] : '';
      if (!src) return;
      const target = path.join(dir, src);
      if (!fs.existsSync(target)) {
        missing.push(src);
      }
    });
    if (missing.length > 0) {
      issues.push({
        issueType: 'audio_missing',
        severity: missing.length >= 2 ? 'high' : 'medium',
        generationId: Number(card.id),
        phrase: card.phrase || '',
        fingerprint: hashFingerprint(['audio_missing', String(card.id), missing.join('|')]),
        detail: {
          missingAudioFiles: missing,
          mdFilePath: mdPath
        }
      });
    }
  });

  cards.forEach((card) => {
    const markdown = String(card.markdown_content || '');
    if (String(card.card_type || 'trilingual') === 'trilingual') {
      const hasEnglish = /##\s*1\.\s*英文/.test(markdown);
      const hasJapanese = /##\s*2\./.test(markdown);
      const hasChinese = /##\s*3\.\s*中文/.test(markdown);
      if (!hasEnglish || !hasJapanese || !hasChinese) {
        issues.push({
          issueType: 'format_anomaly',
          severity: 'medium',
          generationId: Number(card.id),
          phrase: card.phrase || '',
          fingerprint: hashFingerprint(['format_anomaly', String(card.id), 'section_missing']),
          detail: {
            hasEnglish,
            hasJapanese,
            hasChinese
          }
        });
      }
    }
  });

  return { issues };
}

function wrapResult(task, result, inputCount) {
  const hasPayload = result && Object.keys(result).length > 0;
  return {
    task,
    status: hasPayload ? 'ok' : 'partial',
    warnings: [],
    errors: [],
    quality: {
      confidence: hasPayload ? 0.75 : 0.4,
      coverageRatio: inputCount > 0 ? 1 : 0
    },
    result: result || {}
  };
}

function runTask(taskType, cards = []) {
  const normalizedTask = String(taskType || '').trim().toLowerCase();
  switch (normalizedTask) {
    case 'summary':
      return wrapResult('summary', runSummary(cards), cards.length);
    case 'index':
      return wrapResult('index', runIndex(cards), cards.length);
    case 'synonym_boundary':
      return wrapResult('synonym_boundary', runSynonymBoundary(cards), cards.length);
    case 'grammar_link':
      return wrapResult('grammar_link', runGrammarLink(cards), cards.length);
    case 'cluster':
      return wrapResult('cluster', runCluster(cards), cards.length);
    case 'issues_audit':
      return wrapResult('issues_audit', runIssuesAudit(cards), cards.length);
    default:
      return {
        task: normalizedTask || 'unknown',
        status: 'failed',
        warnings: [],
        errors: [`Unsupported task type: ${normalizedTask}`],
        quality: { confidence: 0, coverageRatio: 0 },
        result: {}
      };
  }
}

module.exports = {
  runTask
};
