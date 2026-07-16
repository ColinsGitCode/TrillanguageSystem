'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

function sha256(buffer) {
  return crypto.createHash('sha256').update(buffer).digest('hex');
}

function sourceSpan() {
  return { assetKey: 'source:01', pageOrdinal: 1, region: [0.1, 0.1, 0.4, 0.1] };
}

function expression(key, ordinal, en, ja, zh, { pairing = 1 } = {}) {
  return {
    key,
    ordinal,
    official: {
      en: { text: en, sourceSpan: sourceSpan() },
      ja: { text: ja, sourceSpan: sourceSpan() },
    },
    derived: {
      zhCue: zh,
      rubySegments: [{ text: ja }],
      analysis: {
        phrases: [{ label: ordinal === 1 ? 'start here' : 'ready now', explanation: 'Synthetic fixture note.', source: 'ai-derived' }],
        grammar: [{ label: ordinal === 1 ? 'imperative' : 'present state', explanation: 'Synthetic fixture note.', source: 'ai-derived' }],
        register: [],
        comparison: [],
      },
    },
    confidence: { pairing, en: 1, ja: 1, zhCue: 0.9, ruby: 0.9 },
    unitHashes: { en: '0'.repeat(64), ja: '0'.repeat(64) },
  };
}

async function createTextbookManifestFixture(repoRoot) {
  const sourceRoot = path.join(repoRoot, '.tmp', 'e2e', 'textbook-source');
  const baseDir = path.join(sourceRoot, 'desktop-course', 'track-01');
  fs.mkdirSync(baseDir, { recursive: true });

  const imageRelative = 'desktop-course/track-01/source-01.png';
  const audioRelative = 'desktop-course/track-01/official-track-01.mp3';
  const manifestRelative = 'desktop-course/track-01/manifest.v1.json';
  const image = Buffer.from('synthetic-textbook-page');
  const audio = Buffer.from('synthetic-official-track-audio');
  fs.writeFileSync(path.join(sourceRoot, imageRelative), image);
  fs.writeFileSync(path.join(sourceRoot, audioRelative), audio);

  const manifest = {
    schemaVersion: 'textbook-track-manifest/v1',
    course: {
      key: 'desktop-course',
      title: 'Desktop Course',
      sourceNotice: 'Synthetic E2E fixture. No textbook content.',
    },
    track: {
      number: 1,
      displayOrder: 1,
      title: 'Compact Morning Practice',
      expectedExpressionCount: 2,
    },
    revision: { number: 1, status: 'draft', parentManifestHash: null },
    assets: [
      {
        assetKey: 'source:01',
        kind: 'source_image',
        ordinal: 1,
        relativePath: imageRelative,
        sha256: sha256(image),
        byteSize: image.length,
        mimeType: 'image/png',
      },
      {
        assetKey: 'official:01',
        kind: 'official_audio',
        ordinal: 1,
        relativePath: audioRelative,
        sha256: sha256(audio),
        byteSize: audio.length,
        mimeType: 'audio/mpeg',
        durationMs: 1800,
      },
    ],
    expressions: [
      expression('expr:01', 1, 'Start here.', 'ここからはじめて。', '从这里开始。'),
      expression('expr:02', 2, 'I am ready now.', 'もうじゅんびできたよ。', '我已经准备好了。', { pairing: 0.6 }),
    ],
    import: {
      skillName: 'import-textbook-track',
      skillVersion: '1.0.0',
      createdAtUtc: '2026-07-15T00:00:00.000Z',
    },
    integrity: { sourceFingerprint: '0'.repeat(64), contentHash: '0'.repeat(64) },
  };
  const contract = await import('../../../services/textbooks/manifestContract.mjs');
  contract.applyComputedHashes(manifest);
  const manifestPath = path.join(sourceRoot, manifestRelative);
  fs.writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
  return {
    manifestRelative,
    manifestHash: contract.computeManifestFileHash(manifest),
  };
}

module.exports = { createTextbookManifestFixture };
