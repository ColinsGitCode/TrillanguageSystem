'use strict';

const { normalizeKnowledgeText, sha256, stableJson } = require('./knowledgeIdentity');

const EVIDENCE_RULE_VERSION = 'kg-evidence-v1';
const SOURCE_KINDS = new Set(['generation', 'study_item', 'textbook_expression']);

function assertSha256(value, label) {
  const normalized = String(value || '').trim().toLowerCase();
  if (!/^[a-f0-9]{64}$/u.test(normalized)) throw new TypeError(`${label} must be a SHA-256 hex digest`);
  return normalized;
}

function buildEvidenceLinkCandidate({
  pointKey,
  sourceKind,
  sourceRefId,
  sourceRevision = 1,
  sourceContentHash,
  language,
  sourceText,
  locator = {},
  evidenceRole = 'primary',
} = {}) {
  const normalizedSourceKind = String(sourceKind || '').trim();
  if (!SOURCE_KINDS.has(normalizedSourceKind)) throw new TypeError(`Unsupported evidence source kind: ${sourceKind}`);
  const normalizedRefId = Number(sourceRefId);
  const normalizedRevision = Number(sourceRevision);
  if (!Number.isInteger(normalizedRefId) || normalizedRefId <= 0) throw new TypeError('sourceRefId must be a positive integer');
  if (!Number.isInteger(normalizedRevision) || normalizedRevision <= 0) throw new TypeError('sourceRevision must be a positive integer');
  if (!['primary', 'context'].includes(evidenceRole)) throw new TypeError(`Unsupported evidence role: ${evidenceRole}`);

  const normalizedPointKey = assertSha256(pointKey, 'pointKey');
  const normalizedContentHash = assertSha256(sourceContentHash, 'sourceContentHash');
  const identityPayload = {
    identityVersion: EVIDENCE_RULE_VERSION,
    sourceKind: normalizedSourceKind,
    sourceRefId: normalizedRefId,
    sourceRevision: normalizedRevision,
    locator,
    sourceContentHash: normalizedContentHash,
  };
  return {
    status: 'accepted',
    linkKind: 'evidence-of',
    strength: evidenceRole === 'primary' ? 'strong' : 'weak',
    sourceKind: 'deterministic-structure',
    ruleVersion: EVIDENCE_RULE_VERSION,
    pointKey: normalizedPointKey,
    evidence: {
      evidenceKey: sha256(stableJson(identityPayload)),
      sourceKind: normalizedSourceKind,
      sourceRefId: normalizedRefId,
      sourceRevision: normalizedRevision,
      sourceContentHash: normalizedContentHash,
      language: String(language || '').trim().toLowerCase(),
      sourceText: normalizeKnowledgeText(sourceText, language),
      locator,
      evidenceRole,
    },
    publicReason: 'Structured primary expression provides deterministic content evidence.',
  };
}

module.exports = {
  EVIDENCE_RULE_VERSION,
  SOURCE_KINDS,
  buildEvidenceLinkCandidate,
};
