'use strict';

// Smoke tests for the per-task modules under services/knowledge/tasks/.
// One representative case per task — they're pure transforms over a card
// list, so the goal here is to fence the public output shape against
// regressions while the engine itself is being split. The synonym_boundary
// LLM branch is intentionally NOT exercised (no env / no proxy).

const test = require('node:test');
const assert = require('node:assert/strict');

const summary = require('../../services/knowledge/tasks/summary');
const cardIndex = require('../../services/knowledge/tasks/cardIndex');
const grammarLink = require('../../services/knowledge/tasks/grammarLink');
const cluster = require('../../services/knowledge/tasks/cluster');
const issuesAudit = require('../../services/knowledge/tasks/issuesAudit');
const synonymBoundary = require('../../services/knowledge/tasks/synonymBoundary');
const engine = require('../../services/knowledge/knowledgeAnalysisEngine');

function buildCard(overrides = {}) {
  return {
    id: 1,
    phrase: 'hello',
    card_type: 'trilingual',
    llm_provider: 'gemini',
    folder_name: '20260101',
    base_filename: 'hello',
    md_file_path: '',
    en_translation: 'hello',
    ja_translation: 'こんにちは',
    zh_translation: '你好',
    markdown_content: [
      '## 1. 英文',
      '- **例句1**: Hello world.',
      '## 2. 日本語',
      '- **例句1**: こんにちはと言いました。',
      '- **例句2**: 〜要するに、よろしくお願いします。',
      '## 3. 中文',
      '- **例句1**: 你好。'
    ].join('\n'),
    quality_score: 90,
    tokens_total: 300,
    ...overrides
  };
}

test.describe('knowledge task: summary', () => {
  test.it('returns counts + qualityObservations for non-empty input', () => {
    const out = summary.run([
      buildCard({ id: 1, llm_provider: 'gemini', quality_score: 90 }),
      buildCard({ id: 2, llm_provider: 'local', quality_score: 70 })
    ]);
    assert.equal(typeof out.overview, 'string');
    assert.ok(out.overview.includes('2'));
    assert.equal(out.topTopics.length, 1);
    assert.equal(out.topTopics[0].topic, 'trilingual');
    assert.equal(out.topTopics[0].count, 2);
    assert.equal(out.qualityObservations.length, 2);
    // Avg quality (80) is not < 80 so severity should be low.
    const qualityFinding = out.qualityObservations[0].finding;
    assert.ok(qualityFinding.includes('80'));
  });

  test.it('flags missing grammar_ja coverage as an action item', () => {
    const out = summary.run([buildCard()]);
    assert.ok(out.actionItems.some((item) => item.action.includes('语法')));
  });
});

test.describe('knowledge task: cardIndex', () => {
  test.it('produces one entry per card with headwords + tags', () => {
    const out = cardIndex.run([
      buildCard({ id: 7, phrase: 'persistent state', en_translation: 'persistent state' })
    ]);
    assert.equal(out.entries.length, 1);
    const [entry] = out.entries;
    assert.equal(entry.generationId, 7);
    assert.equal(entry.phrase, 'persistent state');
    assert.equal(entry.langProfile, 'en');
    assert.ok(Array.isArray(entry.aliases));
    assert.ok(entry.aliases.includes('persistent state'));
    assert.ok(Array.isArray(entry.tags));
  });
});

test.describe('knowledge task: grammarLink', () => {
  test.it('groups sentences by detected pattern with example refs', () => {
    const out = grammarLink.run([buildCard({ id: 5 })]);
    // Card includes "要するに" in section 2 → '〜要するに' pattern.
    const patterns = out.patterns.map((p) => p.pattern);
    assert.ok(patterns.includes('〜要するに'), `expected 〜要するに in ${patterns}`);
    const found = out.patterns.find((p) => p.pattern === '〜要するに');
    assert.equal(found.exampleRefs.length, 1);
    assert.equal(found.exampleRefs[0].generationId, 5);
  });

  test.it('returns empty patterns list when no japanese section', () => {
    const out = grammarLink.run([buildCard({ markdown_content: '## 1. 英文\n- **例句1**: Hi.' })]);
    assert.deepEqual(out.patterns, []);
  });
});

test.describe('knowledge task: cluster', () => {
  test.it('routes engineering phrases to tp_engineering on the topic axis; falls back to tp_general (llm off)', async () => {
    // markdown_content is empty so the second card doesn't pick up unrelated
    // keywords from the default fixture body. llmEnabled:false isolates the
    // rule pass — no network.
    const blankCard = (id, phrase, en) => buildCard({
      id,
      phrase,
      en_translation: en,
      ja_translation: '',
      zh_translation: '',
      markdown_content: ''
    });
    const out = await cluster.run([
      blankCard(1, 'docker proxy', 'docker proxy api retry'),
      blankCard(2, 'random phrase', 'random phrase')
    ], { llmEnabled: false });
    const engCluster = out.clusters.find((c) => c.clusterKey === 'tp_engineering');
    assert.ok(engCluster, 'tp_engineering cluster missing');
    assert.equal(engCluster.taxonomy, 'topic');
    assert.ok(engCluster.cards.some((c) => c.generationId === 1));
    const generalCluster = out.clusters.find((c) => c.clusterKey === 'tp_general');
    assert.ok(generalCluster, 'tp_general cluster missing');
    assert.ok(generalCluster.cards.some((c) => c.generationId === 2));
  });

  test.it('places grammar_ja cards on the function axis via keyword rules', async () => {
    const grammarCard = (id, phrase) => buildCard({
      id,
      phrase,
      card_type: 'grammar_ja',
      en_translation: '',
      ja_translation: '',
      zh_translation: '',
      markdown_content: ''
    });
    const out = await cluster.run([
      grammarCard(1, '〜たほうがいい'),
      grammarCard(2, '〜より〜のほうが')
    ], { llmEnabled: false });
    const advice = out.clusters.find((c) => c.clusterKey === 'fn_advice');
    assert.ok(advice, 'fn_advice cluster missing');
    assert.equal(advice.taxonomy, 'function');
    assert.ok(advice.cards.some((c) => c.generationId === 1));
    const comparison = out.clusters.find((c) => c.clusterKey === 'fn_comparison');
    assert.ok(comparison, 'fn_comparison cluster missing');
    assert.ok(comparison.cards.some((c) => c.generationId === 2));
  });

  test.it('uses the LLM fallback for rule-misses and honors injected transport', async () => {
    const blankCard = (id, phrase) => buildCard({
      id, phrase, en_translation: phrase, ja_translation: '', zh_translation: '', markdown_content: ''
    });
    let invoked = 0;
    const llmInvoke = async () => {
      invoked += 1;
      // Model places the unmatched card into tp_business.
      return JSON.stringify({ assignments: [{ id: 7, categoryKey: 'tp_business', confidence: 0.8 }] });
    };
    const out = await cluster.run([
      blankCard(7, 'quarterly synergy alignment')
    ], { llmEnabled: true, llmInvoke });
    assert.equal(invoked, 1, 'llm transport should be invoked once');
    const business = out.clusters.find((c) => c.clusterKey === 'tp_business');
    assert.ok(business, 'tp_business cluster missing');
    assert.ok(business.cards.some((c) => c.generationId === 7));
    assert.equal(out.meta.stats.llmMatched, 1);
  });

  test.it('falls back to tp_general when the LLM returns an unknown key', async () => {
    const blankCard = (id, phrase) => buildCard({
      id, phrase, en_translation: phrase, ja_translation: '', zh_translation: '', markdown_content: ''
    });
    const llmInvoke = async () => JSON.stringify({ assignments: [{ id: 9, categoryKey: 'not_a_real_key' }] });
    const out = await cluster.run([
      blankCard(9, 'qqq wibble xyzzy')
    ], { llmEnabled: true, llmInvoke });
    const general = out.clusters.find((c) => c.clusterKey === 'tp_general');
    assert.ok(general, 'tp_general cluster missing');
    assert.ok(general.cards.some((c) => c.generationId === 9));
  });
});

test.describe('knowledge task: issuesAudit', () => {
  test.it('flags duplicate phrases', () => {
    const out = issuesAudit.run([
      buildCard({ id: 1, phrase: 'dup' }),
      buildCard({ id: 2, phrase: 'dup' }),
      buildCard({ id: 3, phrase: 'unique' })
    ]);
    const dupIssues = out.issues.filter((i) => i.issueType === 'duplicate_phrase');
    assert.equal(dupIssues.length, 2);
    assert.equal(dupIssues[0].severity, 'medium'); // groupSize=2 → medium
  });

  test.it('flags format_anomaly when a trilingual card is missing a section', () => {
    const out = issuesAudit.run([
      buildCard({ id: 9, markdown_content: '## 1. 英文\n- **例句1**: Hi.' })
    ]);
    const formatIssues = out.issues.filter((i) => i.issueType === 'format_anomaly');
    assert.equal(formatIssues.length, 1);
    assert.equal(formatIssues[0].detail.hasJapanese, false);
  });

  test.it('returns no issues for a well-formed unique card', () => {
    const out = issuesAudit.run([buildCard()]);
    assert.equal(out.issues.length, 0);
  });
});

test.describe('knowledge task: synonymBoundary (LLM disabled / local-only path)', () => {
  test.it('discovers a candidate pair when two cards share zh_translation tokens', async () => {
    const out = await synonymBoundary.run([
      buildCard({ id: 1, phrase: 'persistent', en_translation: 'persistent', zh_translation: '持续的, 稳定的' }),
      buildCard({ id: 2, phrase: 'sustained', en_translation: 'sustained', zh_translation: '持续的, 稳定的' })
    ], { llmEnabled: false, minCandidateScore: 0.2 });

    assert.equal(out.groups.length, 1);
    const [group] = out.groups;
    assert.ok(['persistent', 'sustained'].includes(group.termA));
    assert.ok(['persistent', 'sustained'].includes(group.termB));
    assert.equal(group.parseStatus, 'local');
    assert.equal(out.stats.candidateCount, 1);
    assert.equal(out.stats.llmAttempted, 0);
  });

  test.it('returns empty groups when no candidate clears minCandidateScore', async () => {
    const out = await synonymBoundary.run([
      buildCard({ id: 1, phrase: 'apple', zh_translation: '苹果' }),
      buildCard({ id: 2, phrase: 'truck', zh_translation: '卡车' })
    ], { llmEnabled: false });
    assert.equal(out.groups.length, 0);
  });
});

test.describe('knowledgeAnalysisEngine.runTask dispatcher', () => {
  test.it('returns wrapped result with status:ok for a known task', async () => {
    const out = await engine.runTask('summary', [buildCard()]);
    assert.equal(out.task, 'summary');
    assert.equal(out.status, 'ok');
    assert.ok(out.result && typeof out.result === 'object');
    assert.ok(out.quality.coverageRatio > 0);
  });

  test.it('returns status:failed for an unknown task type', async () => {
    const out = await engine.runTask('nonexistent', []);
    assert.equal(out.status, 'failed');
    assert.equal(out.task, 'nonexistent');
    assert.ok(out.errors[0].includes('Unsupported'));
  });

  test.it('accepts taskType case-insensitive', async () => {
    const out = await engine.runTask('  SUMMARY  ', [buildCard()]);
    assert.equal(out.task, 'summary');
    assert.equal(out.status, 'ok');
  });
});
