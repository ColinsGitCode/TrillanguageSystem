'use strict';

const {
  RULE_VERSION,
  extractFunctionTags,
  inferLanguage,
  inferSource,
  inferTestCandidate,
  inferTopicTags,
  normalizeTagValue,
} = require('./rules');

function buildTagProposals(records) {
  return records.flatMap((record) => {
    const inferred = [
      { namespace: 'lang', ...inferLanguage(record) },
      { namespace: 'src', ...inferSource(record) },
      ...extractFunctionTags(record).map((tag) => ({ namespace: 'fn', ...tag })),
      ...inferTopicTags(record).map((tag) => ({ namespace: 'topic', ...tag })),
    ];
    const qa = inferTestCandidate(record);
    if (qa) inferred.push({ namespace: 'qa', ...qa });
    return inferred.map((tag) => ({
      generationId: record.id == null ? null : Number(record.id),
      namespace: tag.namespace,
      value: tag.value,
      normalizedValue: normalizeTagValue(tag.value),
      ruleVersion: RULE_VERSION,
      ruleKey: tag.ruleKey,
      evidenceJson: JSON.stringify(tag.evidence || {}),
    }));
  }).sort((a, b) => Number(a.generationId || 0) - Number(b.generationId || 0)
    || a.namespace.localeCompare(b.namespace)
    || a.normalizedValue.localeCompare(b.normalizedValue));
}

function toRuleRecord(generation) {
  return {
    id: generation.id ?? generation.generationId ?? null,
    phrase: generation.phrase,
    card_type: generation.card_type || generation.cardType || 'trilingual',
    source_mode: generation.source_mode || generation.sourceMode || null,
    markdown_content: generation.markdown_content || generation.markdownContent || '',
  };
}

function buildAdmissionTags(generation) {
  return buildTagProposals([toRuleRecord(generation)]).map(({ generationId: _generationId, ...tag }) => tag);
}

function summarizeTagProposals(proposals) {
  const counts = {};
  const cardsByNamespace = {};
  for (const proposal of proposals) {
    counts[proposal.namespace] ||= {};
    counts[proposal.namespace][proposal.value] = (counts[proposal.namespace][proposal.value] || 0) + 1;
    cardsByNamespace[proposal.namespace] ||= new Set();
    cardsByNamespace[proposal.namespace].add(proposal.generationId);
  }
  return {
    proposals: proposals.length,
    counts,
    cardsByNamespace: Object.fromEntries(
      Object.entries(cardsByNamespace).map(([namespace, ids]) => [namespace, ids.size])
    ),
    qaCandidates: proposals.filter((item) => item.namespace === 'qa').map((item) => item.generationId),
    languageUnknown: proposals.filter((item) => item.namespace === 'lang' && item.value === 'unknown').length,
    sourceUnknown: proposals.filter((item) => item.namespace === 'src' && item.value === 'unknown').length,
  };
}

module.exports = {
  buildAdmissionTags,
  buildTagProposals,
  summarizeTagProposals,
  toRuleRecord,
};
