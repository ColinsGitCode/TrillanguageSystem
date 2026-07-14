'use strict';

const { PlanningSignalProvider } = require('./planningSignalProvider');

const PUBLIC_TAG_NAMESPACES = new Set(['topic', 'fn', 'tag']);

class HeuristicPlanningSignalProvider extends PlanningSignalProvider {
  constructor(options = {}) {
    super({ id: 'heuristic-v1', version: '1.0.0', kind: 'heuristic', maxDurationMs: 10, ...options });
  }

  evaluate(studyItem) {
    const reasons = [];
    const groups = [
      `kind:${studyItem.unitKind}`,
      `card-type:${studyItem.cardType}`,
    ];
    if (studyItem.generationDate) groups.push(`month:${String(studyItem.generationDate).slice(0, 7)}`);
    if (studyItem.folderName) groups.push(`folder:${studyItem.folderName}`);

    let score = 0;
    const lapses = Math.max(0, Number(studyItem.reviewEvidence?.lapses || 0));
    if (lapses > 0) {
      score += Math.min(24, lapses * 6);
      reasons.push({ code: 'review-lapses', label: `曾有 ${lapses} 次遗忘` });
    }
    const difficulty = Number(studyItem.reviewEvidence?.difficulty || 0);
    if (difficulty >= 8) {
      score += 18;
      reasons.push({ code: 'review-high-difficulty', label: '历史难度较高' });
    } else if (difficulty >= 6.5) {
      score += 9;
      reasons.push({ code: 'review-moderate-difficulty', label: '历史难度偏高' });
    }

    const cueLength = [...String(studyItem.sourceTitle || '')].length;
    if (cueLength >= 80) {
      score += 8;
      reasons.push({ code: 'content-long-cue', label: '提示内容较长' });
    } else if (cueLength >= 40) {
      score += 4;
      reasons.push({ code: 'content-medium-cue', label: '提示内容信息较多' });
    }

    const publicTags = (studyItem.tags || []).filter((tag) => PUBLIC_TAG_NAMESPACES.has(tag.namespace));
    for (const tag of publicTags) groups.push(`${tag.namespace}:${tag.normalizedValue}`);
    if (publicTags.length) {
      const labels = publicTags.slice(0, 3).map((tag) => tag.value || tag.normalizedValue);
      reasons.push({ code: 'active-tag-context', label: `标签分组：${labels.join(' / ')}` });
    }

    return {
      score,
      groups,
      reasons,
      evidence: publicTags.map((tag) => ({
        source: tag.source,
        ruleVersion: tag.ruleVersion,
        ruleKey: tag.ruleKey,
      })),
    };
  }
}

module.exports = { HeuristicPlanningSignalProvider };
