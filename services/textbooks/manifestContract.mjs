import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

const SHA256_PATTERN = /^[a-f0-9]{64}$/u;
const HAN_ONLY_PATTERN = /^[\p{Script=Han}々〆ヵヶ]+$/u;
const HAN_PATTERN = /[\p{Script=Han}々〆ヵヶ]/u;

export function stableJson(value) {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableJson(value[key])}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

export function sha256Text(value) {
  return crypto.createHash('sha256').update(value).digest('hex');
}

export function sha256File(filePath) {
  const hash = crypto.createHash('sha256');
  hash.update(fs.readFileSync(filePath));
  return hash.digest('hex');
}

export function normalizeText(value) {
  return String(value ?? '').normalize('NFC').replace(/\r\n?/gu, '\n').trim();
}

export function mimeForPath(filePath) {
  switch (path.extname(filePath).toLowerCase()) {
    case '.jpg':
    case '.jpeg':
      return 'image/jpeg';
    case '.png':
      return 'image/png';
    case '.webp':
      return 'image/webp';
    case '.mp3':
      return 'audio/mpeg';
    case '.m4a':
    case '.mp4':
      return 'audio/mp4';
    case '.wav':
      return 'audio/wav';
    case '.flac':
      return 'audio/flac';
    default:
      return null;
  }
}

function isInside(root, target) {
  return target === root || target.startsWith(`${root}${path.sep}`);
}

export function resolveAssetPath(sourceRoot, relativePath) {
  if (!sourceRoot) throw new Error('TEXTBOOK_SOURCE_ROOT_REQUIRED');
  if (!relativePath || path.isAbsolute(relativePath) || relativePath.includes('\0') || relativePath.includes('\\')) {
    throw new Error('TEXTBOOK_MEDIA_PATH_REJECTED');
  }
  const parts = relativePath.split('/');
  if (parts.some((part) => !part || part === '.' || part === '..')) {
    throw new Error('TEXTBOOK_MEDIA_PATH_REJECTED');
  }
  const rootStat = fs.lstatSync(sourceRoot);
  if (!rootStat.isDirectory() || rootStat.isSymbolicLink()) throw new Error('TEXTBOOK_MEDIA_PATH_REJECTED');
  const rootReal = fs.realpathSync(sourceRoot);
  const candidate = path.resolve(rootReal, ...parts);
  if (!isInside(rootReal, candidate)) throw new Error('TEXTBOOK_MEDIA_PATH_REJECTED');

  let cursor = rootReal;
  for (const part of parts) {
    cursor = path.join(cursor, part);
    const stat = fs.lstatSync(cursor);
    if (stat.isSymbolicLink()) throw new Error('TEXTBOOK_MEDIA_PATH_REJECTED');
  }
  const targetReal = fs.realpathSync(candidate);
  if (!isInside(rootReal, targetReal)) throw new Error('TEXTBOOK_MEDIA_PATH_REJECTED');
  const targetStat = fs.statSync(targetReal);
  if (!targetStat.isFile()) throw new Error('TEXTBOOK_MEDIA_NOT_FOUND');
  return targetReal;
}

export function inspectAsset(sourceRoot, relativePath) {
  const filePath = resolveAssetPath(sourceRoot, relativePath);
  const stat = fs.statSync(filePath);
  const mimeType = mimeForPath(filePath);
  if (!mimeType) throw new Error('TEXTBOOK_MEDIA_TYPE_REJECTED');
  return {
    relativePath,
    sha256: sha256File(filePath),
    byteSize: stat.size,
    mimeType,
  };
}

function normalizedAsset(asset) {
  return {
    assetKey: asset.assetKey,
    kind: asset.kind,
    ordinal: asset.ordinal,
    sha256: asset.sha256,
    byteSize: asset.byteSize,
    mimeType: asset.mimeType,
    ...(asset.durationMs ? { durationMs: asset.durationMs } : {}),
  };
}

function normalizedExpression(expression) {
  return {
    key: expression.key,
    ordinal: expression.ordinal,
    official: expression.official,
    derived: expression.derived,
    confidence: expression.confidence,
    ...(expression.editorNote ? { editorNote: expression.editorNote } : {}),
  };
}

export function sourceFingerprintPayload(manifest) {
  return {
    version: 1,
    courseKey: manifest.course.key,
    trackNumber: manifest.track.number,
    skillName: manifest.import.skillName,
    skillVersion: manifest.import.skillVersion,
    assets: [...manifest.assets].sort((left, right) => left.ordinal - right.ordinal || left.assetKey.localeCompare(right.assetKey))
      .map((asset) => ({ assetKey: asset.assetKey, kind: asset.kind, ordinal: asset.ordinal, sha256: asset.sha256 })),
  };
}

export function contentHashPayload(manifest) {
  return {
    schemaVersion: manifest.schemaVersion,
    course: manifest.course,
    track: manifest.track,
    assets: [...manifest.assets].sort((left, right) => left.ordinal - right.ordinal || left.assetKey.localeCompare(right.assetKey))
      .map(normalizedAsset),
    expressions: [...manifest.expressions].sort((left, right) => left.ordinal - right.ordinal)
      .map(normalizedExpression),
  };
}

export function unitHashPayload(expression, direction) {
  const base = {
    version: 1,
    expressionKey: expression.key,
    direction,
    prompt: normalizeText(expression.derived.zhCue),
    target: normalizeText(expression.official[direction].text),
  };
  if (direction === 'ja') base.ruby = expression.derived.rubySegments;
  return base;
}

export function computeSourceFingerprint(manifest) {
  return sha256Text(stableJson(sourceFingerprintPayload(manifest)));
}

export function computeContentHash(manifest) {
  return sha256Text(stableJson(contentHashPayload(manifest)));
}

export function computeUnitHash(expression, direction) {
  return sha256Text(stableJson(unitHashPayload(expression, direction)));
}

export function computeManifestFileHash(manifest) {
  return sha256Text(stableJson(manifest));
}

export function applyComputedHashes(manifest) {
  for (const expression of manifest.expressions) {
    expression.unitHashes = {
      en: computeUnitHash(expression, 'en'),
      ja: computeUnitHash(expression, 'ja'),
    };
  }
  manifest.integrity = {
    sourceFingerprint: computeSourceFingerprint(manifest),
    contentHash: computeContentHash(manifest),
  };
  return manifest;
}

function addError(errors, code, context = {}) {
  errors.push({ code, ...context });
}

function contiguous(values) {
  return values.every((value, index) => value === index + 1);
}

export function runDeterministicChecks(manifest, options = {}) {
  const errors = [];
  const assetKeys = new Set();
  const assetsByKey = new Map();
  const ordinalsByKind = new Map();
  for (const asset of manifest.assets || []) {
    if (assetKeys.has(asset.assetKey)) addError(errors, 'DUPLICATE_ASSET_KEY', { assetKey: asset.assetKey });
    assetKeys.add(asset.assetKey);
    assetsByKey.set(asset.assetKey, asset);
    const ordinals = ordinalsByKind.get(asset.kind) || [];
    ordinals.push(asset.ordinal);
    ordinalsByKind.set(asset.kind, ordinals);
    if (options.sourceRoot) {
      try {
        const actual = inspectAsset(options.sourceRoot, asset.relativePath);
        if (actual.sha256 !== asset.sha256) addError(errors, 'ASSET_HASH_MISMATCH', { assetKey: asset.assetKey });
        if (actual.byteSize !== asset.byteSize) addError(errors, 'ASSET_SIZE_MISMATCH', { assetKey: asset.assetKey });
        if (actual.mimeType !== asset.mimeType && !(actual.mimeType === 'audio/mp4' && asset.mimeType === 'audio/x-m4a')) {
          addError(errors, 'ASSET_MIME_MISMATCH', { assetKey: asset.assetKey });
        }
      } catch (error) {
        const code = String(error.message || '').startsWith('TEXTBOOK_')
          ? error.message
          : error.code === 'ENOENT'
            ? 'TEXTBOOK_MEDIA_NOT_FOUND'
            : 'TEXTBOOK_MEDIA_VALIDATION_FAILED';
        addError(errors, code, { assetKey: asset.assetKey });
      }
    }
  }
  for (const [kind, ordinals] of ordinalsByKind) {
    const sorted = [...ordinals].sort((left, right) => left - right);
    if (new Set(sorted).size !== sorted.length) addError(errors, 'DUPLICATE_ASSET_ORDINAL', { kind });
    if (!contiguous(sorted)) addError(errors, 'NON_CONTIGUOUS_ASSET_ORDINAL', { kind });
  }

  if (manifest.track?.expectedExpressionCount !== manifest.expressions?.length) {
    addError(errors, 'EXPRESSION_COUNT_MISMATCH');
  }
  const keys = new Set();
  const ordinals = [];
  const pairs = new Set();
  const validateSourceSpan = (sourceSpan, context) => {
    const sourceAsset = assetsByKey.get(sourceSpan?.assetKey);
    if (!sourceAsset || sourceAsset.kind !== 'source_image') {
      addError(errors, 'INVALID_SOURCE_SPAN_ASSET', context);
    }
    const [x, y, width, height] = sourceSpan?.region || [];
    if ([x, y, width, height].some((value) => !Number.isFinite(value)) || x + width > 1 || y + height > 1) {
      addError(errors, 'INVALID_SOURCE_SPAN_REGION', context);
    }
  };
  for (const expression of manifest.expressions || []) {
    if (keys.has(expression.key)) addError(errors, 'DUPLICATE_EXPRESSION_KEY', { expressionKey: expression.key });
    keys.add(expression.key);
    ordinals.push(expression.ordinal);
    const pairHash = sha256Text(stableJson([normalizeText(expression.official?.en?.text), normalizeText(expression.official?.ja?.text)]));
    if (pairs.has(pairHash)) addError(errors, 'DUPLICATE_EXPRESSION_PAIR', { expressionKey: expression.key });
    pairs.add(pairHash);

    for (const direction of ['en', 'ja']) {
      const sourceSpan = expression.official?.[direction]?.sourceSpan;
      validateSourceSpan(sourceSpan, { expressionKey: expression.key, direction });
    }
    for (const category of ['phrases', 'grammar', 'register', 'comparison']) {
      for (const [itemIndex, item] of (expression.derived?.analysis?.[category] || []).entries()) {
        if (item.source === 'official-source') {
          validateSourceSpan(item.sourceSpan, { expressionKey: expression.key, category, item: itemIndex });
        }
      }
    }

    const segments = expression.derived?.rubySegments || [];
    if (segments.map((segment) => segment.text).join('') !== expression.official?.ja?.text) {
      addError(errors, 'RUBY_TEXT_MISMATCH', { expressionKey: expression.key });
    }
    for (const [index, segment] of segments.entries()) {
      const hasHan = HAN_PATTERN.test(segment.text);
      if (segment.reading && !HAN_ONLY_PATTERN.test(segment.text)) {
        addError(errors, 'RUBY_READING_NOT_HAN_ONLY', { expressionKey: expression.key, segment: index });
      }
      if (hasHan && !segment.reading) {
        addError(errors, 'RUBY_READING_MISSING', { expressionKey: expression.key, segment: index });
      }
      if (!hasHan && segment.reading) {
        addError(errors, 'RUBY_READING_ON_NON_HAN', { expressionKey: expression.key, segment: index });
      }
    }

    if (options.verifyComputedHashes !== false) {
      for (const direction of ['en', 'ja']) {
        if (!SHA256_PATTERN.test(expression.unitHashes?.[direction] || '')
          || expression.unitHashes[direction] !== computeUnitHash(expression, direction)) {
          addError(errors, 'UNIT_HASH_MISMATCH', { expressionKey: expression.key, direction });
        }
      }
    }
  }
  const sortedOrdinals = [...ordinals].sort((left, right) => left - right);
  if (new Set(sortedOrdinals).size !== sortedOrdinals.length) addError(errors, 'DUPLICATE_EXPRESSION_ORDINAL');
  if (!contiguous(sortedOrdinals)) addError(errors, 'NON_CONTIGUOUS_EXPRESSION_ORDINAL');
  if (manifest.revision?.number === 1) {
    const expectedKeys = sortedOrdinals.map((ordinal) => `expr:${String(ordinal).padStart(2, '0')}`);
    if (expectedKeys.some((key) => !keys.has(key))) addError(errors, 'INITIAL_EXPRESSION_KEYS_NOT_CONTIGUOUS');
  }

  if (options.verifyComputedHashes !== false) {
    if (manifest.integrity?.sourceFingerprint !== computeSourceFingerprint(manifest)) {
      addError(errors, 'SOURCE_FINGERPRINT_MISMATCH');
    }
    if (manifest.integrity?.contentHash !== computeContentHash(manifest)) {
      addError(errors, 'CONTENT_HASH_MISMATCH');
    }
  }
  return errors;
}

export function summarizeManifest(manifest) {
  const phraseLabels = new Set();
  let grammarCount = 0;
  let annotatedRubySegments = 0;
  const lowConfidence = [];
  for (const expression of manifest.expressions) {
    for (const phrase of expression.derived.analysis.phrases) phraseLabels.add(normalizeText(phrase.label).toLowerCase());
    grammarCount += expression.derived.analysis.grammar.length;
    annotatedRubySegments += expression.derived.rubySegments.filter((segment) => Boolean(segment.reading)).length;
    const fields = Object.entries(expression.confidence)
      .filter(([, value]) => value < 0.85)
      .map(([field]) => field);
    if (fields.length) lowConfidence.push({ expressionKey: expression.key, fields });
  }
  return {
    status: 'valid-draft',
    schemaVersion: manifest.schemaVersion,
    courseKey: manifest.course.key,
    trackNumber: manifest.track.number,
    revisionNumber: manifest.revision.number,
    assetCounts: {
      sourceImages: manifest.assets.filter((asset) => asset.kind === 'source_image').length,
      officialAudio: manifest.assets.filter((asset) => asset.kind === 'official_audio').length,
    },
    expressionCount: manifest.expressions.length,
    phraseCount: phraseLabels.size,
    grammarNoteCount: grammarCount,
    annotatedRubySegments,
    lowConfidence,
    unitCounts: {
      textbookEn: manifest.expressions.length,
      textbookJa: manifest.expressions.length,
      total: manifest.expressions.length * 2,
    },
    hashes: {
      manifestFileHash: computeManifestFileHash(manifest),
      sourceFingerprint: manifest.integrity.sourceFingerprint,
      contentHash: manifest.integrity.contentHash,
    },
  };
}
