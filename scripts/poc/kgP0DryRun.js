'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { analyzeJapaneseForm, analyzerDescriptor } = require('../../services/kg/domain/japaneseFormAnalysis');
const { buildEvidenceLinkCandidate } = require('../../services/kg/domain/knowledgeEvidence');

const fixturePath = path.join(__dirname, '../../tests/fixtures/kg-p0-japanese-token-fixtures.json');

async function run() {
  const fixture = JSON.parse(fs.readFileSync(fixturePath, 'utf8'));
  const cases = [];
  for (const entry of fixture.cases) {
    const result = await analyzeJapaneseForm(entry.input);
    cases.push({
      id: entry.id,
      input: entry.input,
      status: result.status,
      reason: result.reason || null,
      canonicalForm: result.canonicalForm || null,
      lemmaReading: result.lemmaReading || null,
      relation: result.relation || null,
      pointKey: result.pointIdentity?.pointKey || null,
      surfaceKey: result.surfaceIdentity?.surfaceKey || null,
      tokenSequence: result.tokens,
    });
  }

  const taberu = cases.find((entry) => entry.input === '食べる');
  const evidenceCandidate = buildEvidenceLinkCandidate({
    pointKey: taberu.pointKey,
    sourceKind: 'study_item',
    sourceRefId: 42,
    sourceRevision: 1,
    sourceContentHash: 'a'.repeat(64),
    language: 'ja',
    sourceText: '食べます',
    locator: { unitKey: 'trilingual_ja' },
  });
  const resolved = cases.filter((entry) => entry.status === 'resolved');
  const unresolved = cases.filter((entry) => entry.status === 'unresolved');
  const output = {
    schemaVersion: 'kg-p0-dry-run-v1',
    mode: 'read-only-no-database',
    analyzer: analyzerDescriptor(),
    summary: {
      fixtures: cases.length,
      resolved: resolved.length,
      unresolved: unresolved.length,
      relationCounts: resolved.reduce((counts, entry) => {
        const key = entry.relation.linkKind;
        counts[key] = (counts[key] || 0) + 1;
        return counts;
      }, { 'evidence-of': 1 }),
      taberuPointKeys: [...new Set(resolved
        .filter((entry) => entry.canonicalForm === '食べる')
        .map((entry) => entry.pointKey))],
    },
    cases,
    evidenceCandidate,
  };
  process.stdout.write(`${JSON.stringify(output, null, 2)}\n`);
}

run().catch((error) => {
  process.stderr.write(`${error.stack || error}\n`);
  process.exitCode = 1;
});
