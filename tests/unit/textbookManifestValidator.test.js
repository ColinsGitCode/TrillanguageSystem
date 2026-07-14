'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const root = path.resolve(__dirname, '../..');
const validatorPath = path.join(root, 'skills/import-textbook-track/scripts/validate-manifest.mjs');
const libraryPath = path.join(root, 'services/textbooks/manifestContract.mjs');

function createFixture(t) {
  const sourceRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'textbook-manifest-'));
  t.after(() => fs.rmSync(sourceRoot, { recursive: true, force: true }));
  const relativePath = 'synthetic-course/track-01/source-01.png';
  const assetPath = path.join(sourceRoot, relativePath);
  fs.mkdirSync(path.dirname(assetPath), { recursive: true });
  fs.writeFileSync(assetPath, Buffer.from('synthetic-image-fixture'));
  return { sourceRoot, relativePath, assetPath };
}

async function buildManifest(t) {
  const fixture = createFixture(t);
  const lib = await import(libraryPath);
  const inspected = lib.inspectAsset(fixture.sourceRoot, fixture.relativePath);
  const zeroHash = '0'.repeat(64);
  const manifest = {
    schemaVersion: 'textbook-track-manifest/v1',
    course: {
      key: 'synthetic-course',
      title: 'Synthetic Course',
      sourceNotice: 'Synthetic fixture only',
    },
    track: {
      number: 1,
      displayOrder: 1,
      title: 'Morning practice',
      expectedExpressionCount: 1,
    },
    revision: {
      number: 1,
      status: 'draft',
      parentManifestHash: null,
    },
    assets: [{
      assetKey: 'source:01',
      kind: 'source_image',
      ordinal: 1,
      ...inspected,
    }],
    expressions: [{
      key: 'expr:01',
      ordinal: 1,
      official: {
        en: {
          text: 'I leave for school.',
          sourceSpan: { assetKey: 'source:01', pageOrdinal: 1, region: [0.1, 0.1, 0.4, 0.2] },
        },
        ja: {
          text: '学校に行く。',
          sourceSpan: { assetKey: 'source:01', pageOrdinal: 1, region: [0.1, 0.3, 0.4, 0.2] },
        },
      },
      derived: {
        zhCue: '我去学校。',
        rubySegments: [
          { text: '学校', reading: 'がっこう' },
          { text: 'に' },
          { text: '行', reading: 'い' },
          { text: 'く。' },
        ],
        analysis: {
          phrases: [{ label: 'leave for', explanation: 'Depart for a destination.', source: 'ai-derived' }],
          grammar: [],
          register: [],
          comparison: [],
        },
      },
      confidence: { pairing: 0.99, en: 0.99, ja: 0.99, zhCue: 0.95, ruby: 0.98 },
      unitHashes: { en: zeroHash, ja: zeroHash },
    }],
    import: {
      skillName: 'import-textbook-track',
      skillVersion: '1.0.0',
      createdAtUtc: '2026-07-14T00:00:00Z',
    },
    integrity: { sourceFingerprint: zeroHash, contentHash: zeroHash },
  };
  const manifestPath = path.join(fixture.sourceRoot, 'synthetic-course/track-01/manifest.v1.draft.json');
  fs.writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
  return { ...fixture, manifest, manifestPath, lib };
}

function runValidator(manifestPath, sourceRoot, extraArgs = []) {
  return spawnSync(process.execPath, [
    validatorPath,
    '--manifest', manifestPath,
    '--source-root', sourceRoot,
    ...extraArgs,
  ], { encoding: 'utf8' });
}

test.describe('textbook Track Manifest validator', () => {
  test.it('writes stable hashes and produces an idempotent content-free summary', async (t) => {
    const fixture = await buildManifest(t);
    const first = runValidator(fixture.manifestPath, fixture.sourceRoot, ['--write-hashes']);
    assert.equal(first.status, 0, first.stderr);
    const firstResult = JSON.parse(first.stdout);
    assert.equal(firstResult.summary.expressionCount, 1);
    assert.equal(firstResult.summary.unitCounts.total, 2);

    const firstBytes = fs.readFileSync(fixture.manifestPath, 'utf8');
    const second = runValidator(fixture.manifestPath, fixture.sourceRoot);
    assert.equal(second.status, 0, second.stderr);
    const secondResult = JSON.parse(second.stdout);
    assert.deepEqual(secondResult.summary.hashes, firstResult.summary.hashes);
    assert.equal(fs.readFileSync(fixture.manifestPath, 'utf8'), firstBytes);
    assert.doesNotMatch(second.stdout, /I leave for school|学校に行く/u);
  });

  test.it('isolates English and Japanese unit hash changes', async (t) => {
    const { manifest, lib } = await buildManifest(t);
    lib.applyComputedHashes(manifest);
    const baseEn = manifest.expressions[0].unitHashes.en;
    const baseJa = manifest.expressions[0].unitHashes.ja;

    manifest.expressions[0].derived.rubySegments[0].reading = 'がくこう';
    assert.equal(lib.computeUnitHash(manifest.expressions[0], 'en'), baseEn);
    assert.notEqual(lib.computeUnitHash(manifest.expressions[0], 'ja'), baseJa);

    const changedJa = lib.computeUnitHash(manifest.expressions[0], 'ja');
    manifest.expressions[0].derived.analysis.grammar.push({
      label: 'synthetic',
      explanation: 'Synthetic note.',
      source: 'ai-derived',
    });
    assert.equal(lib.computeUnitHash(manifest.expressions[0], 'en'), baseEn);
    assert.equal(lib.computeUnitHash(manifest.expressions[0], 'ja'), changedJa);
  });

  test.it('rejects ruby that annotates okurigana with the Han segment', async (t) => {
    const fixture = await buildManifest(t);
    fixture.manifest.expressions[0].derived.rubySegments = [
      { text: '学校', reading: 'がっこう' },
      { text: 'に' },
      { text: '行く', reading: 'いく' },
      { text: '。' },
    ];
    fs.writeFileSync(fixture.manifestPath, `${JSON.stringify(fixture.manifest, null, 2)}\n`);
    const result = runValidator(fixture.manifestPath, fixture.sourceRoot, ['--write-hashes']);
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /RUBY_READING_NOT_HAN_ONLY/u);
  });

  test.it('requires source evidence for an official glossary entry', async (t) => {
    const fixture = await buildManifest(t);
    fixture.manifest.expressions[0].derived.analysis.phrases[0].source = 'official-source';
    fs.writeFileSync(fixture.manifestPath, `${JSON.stringify(fixture.manifest, null, 2)}\n`);
    const result = runValidator(fixture.manifestPath, fixture.sourceRoot, ['--write-hashes']);
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /MANIFEST_SCHEMA_INVALID/u);
    assert.match(result.stderr, /sourceSpan/u);
  });

  test.it('rejects symlink traversal below the source root', async (t) => {
    const fixture = await buildManifest(t);
    const outside = fs.mkdtempSync(path.join(os.tmpdir(), 'textbook-outside-'));
    t.after(() => fs.rmSync(outside, { recursive: true, force: true }));
    const outsideFile = path.join(outside, 'source.png');
    fs.writeFileSync(outsideFile, Buffer.from('outside'));
    fs.rmSync(fixture.assetPath);
    fs.symlinkSync(outsideFile, fixture.assetPath);

    const result = runValidator(fixture.manifestPath, fixture.sourceRoot, ['--write-hashes']);
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /TEXTBOOK_MEDIA_PATH_REJECTED/u);
  });

  test.it('does not expose absolute paths when an asset is missing', async (t) => {
    const fixture = await buildManifest(t);
    fs.rmSync(fixture.assetPath);
    const result = runValidator(fixture.manifestPath, fixture.sourceRoot, ['--write-hashes']);
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /TEXTBOOK_MEDIA_NOT_FOUND/u);
    assert.doesNotMatch(result.stderr, new RegExp(fixture.sourceRoot.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&'), 'u'));
  });
});
