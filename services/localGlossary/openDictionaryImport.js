'use strict';

const crypto = require('node:crypto');

const ECDICT_REQUIRED_HEADERS = ['word', 'translation'];

function sha256(value) {
  return crypto.createHash('sha256').update(value).digest('hex');
}

function normalizeEnglish(value) {
  return String(value || '')
    .normalize('NFKC')
    .toLocaleLowerCase('en-US')
    .replace(/\s+/gu, ' ')
    .replace(/^[\s.,!?;:'"“”‘’()[\]{}<>]+|[\s.,!?;:'"“”‘’()[\]{}<>]+$/gu, '')
    .trim();
}

function parseCsvRows(input) {
  const rows = [];
  let row = [];
  let field = '';
  let quoted = false;

  for (let index = 0; index < input.length; index += 1) {
    const char = input[index];
    if (quoted) {
      if (char === '"' && input[index + 1] === '"') {
        field += '"';
        index += 1;
      } else if (char === '"') {
        quoted = false;
      } else {
        field += char;
      }
      continue;
    }
    if (char === '"' && field.length === 0) {
      quoted = true;
    } else if (char === ',') {
      row.push(field);
      field = '';
    } else if (char === '\n' || char === '\r') {
      if (char === '\r' && input[index + 1] === '\n') index += 1;
      row.push(field);
      if (row.some((value) => value !== '')) rows.push(row);
      row = [];
      field = '';
    } else {
      field += char;
    }
  }

  if (field || row.length) {
    row.push(field);
    if (row.some((value) => value !== '')) rows.push(row);
  }
  return rows;
}

function compactChineseGloss(value) {
  const parts = String(value || '')
    .replace(/\\n/gu, '\n')
    .split(/\r?\n/u)
    .map((part) => part
      .replace(/^\[[^\]]+\]\s*/u, '')
      .replace(/^(?:n|v|vt|vi|adj|adv|pron|prep|conj|aux|num|art)\.\s*/iu, '')
    .trim())
    .filter(Boolean);
  const primary = [...new Set(parts)][0] || '';
  return primary.split(/[,，;；]/u).map((part) => part.trim()).find(Boolean)?.slice(0, 120) || '';
}

function extractPartOfSpeech(value) {
  return /^\s*((?:n|v|vt|vi|adj|adv|pron|prep|conj|aux|num|art)\.)/iu.exec(String(value || ''))?.[1] || null;
}

function assertEcdictHeaders(headers) {
  const available = new Set(headers.map((header) => header.replace(/^\uFEFF/u, '').trim()));
  const missing = ECDICT_REQUIRED_HEADERS.filter((header) => !available.has(header));
  if (missing.length) {
    throw new Error(`ECDICT CSV 缺少必需列: ${missing.join(', ')}`);
  }
}

function isCommonEcdictRow(row) {
  const tags = String(row.tag || '').split(/\s+/u);
  const frequency = Number(row.frq || row.bnc || 0);
  return row.oxford === '1'
    || Number(row.collins || 0) > 0
    || (Number.isFinite(frequency) && frequency > 0 && frequency <= 100000)
    || tags.some((tag) => ['cet4', 'cet6', 'ielts', 'toefl', 'gk', 'zk'].includes(tag));
}

function readEcdictEntries(input, options = {}) {
  const rows = parseCsvRows(input);
  if (!rows.length) return [];
  const headers = rows[0].map((header) => header.replace(/^\uFEFF/u, '').trim());
  assertEcdictHeaders(headers);
  const entries = [];
  const seen = new Set();
  const scope = options.scope || 'common';

  for (const values of rows.slice(1)) {
    const row = Object.fromEntries(headers.map((header, index) => [header, values[index] || '']));
    const wordValue = String(row.word || '').trim();
    const translationValue = String(row.translation || '');
    const word = normalizeEnglish(wordValue);
    const zhGloss = compactChineseGloss(translationValue);
    if (!word || !zhGloss || (scope === 'common' && !isCommonEcdictRow(row))) continue;
    if (seen.has(word)) continue;
    seen.add(word);
    entries.push({
      language: 'en',
      surfaceForm: wordValue,
      normalizedForm: word,
      lemma: word,
      reading: String(row.phonetic || '').trim() || null,
      partOfSpeech: String(row.pos || '').trim() || extractPartOfSpeech(translationValue),
      zhGloss,
      senseKey: 'default',
      sourceRef: {
        definition: String(row.definition || '').trim() || null,
        exchange: String(row.exchange || '').trim() || null,
        collins: String(row.collins || '').trim() || null,
        oxford: String(row.oxford || '').trim() || null,
        tag: String(row.tag || '').trim() || null,
        bnc: String(row.bnc || '').trim() || null,
        frq: String(row.frq || '').trim() || null,
      },
    });
  }
  return entries;
}

function buildEnglishGlossMap(entries) {
  return new Map(entries.map((entry) => [entry.normalizedForm, entry.zhGloss]));
}

function mapJapaneseChineseGloss(glosses, englishGlossMap) {
  const chinese = [];
  const matchedEnglish = [];
  for (const gloss of glosses) {
    const english = String(gloss || '').trim();
    const translation = englishGlossMap.get(normalizeEnglish(english));
    if (translation) {
      matchedEnglish.push(english);
      chinese.push(translation);
      break;
    }
  }
  return {
    zhGloss: [...new Set(chinese)].join('；').slice(0, 120).trim(),
    matchedEnglish: [...new Set(matchedEnglish)],
  };
}

function firstApplicableReading(word, surface) {
  const direct = word.kana.find((item) => item.appliesToKanji?.includes(surface));
  return direct?.text || word.kana.find((item) => item.appliesToKanji?.includes('*'))?.text || word.kana[0]?.text || null;
}

function readJmdictEntries(payload, options = {}) {
  const englishGlossMap = options.englishGlossMap || new Map();
  const englishSource = options.englishSource || null;
  const entries = [];
  const seen = new Set();
  const words = Array.isArray(payload.words) ? payload.words : [];

  for (const word of words) {
    const surfaces = [
      ...(word.kanji || []).map((item) => item.text),
      ...(word.kana || []).map((item) => item.text),
    ].filter(Boolean);
    for (const [senseIndex, sense] of (word.sense || []).entries()) {
      const englishGlosses = (sense.gloss || [])
        .filter((gloss) => !gloss.lang || gloss.lang === 'eng')
        .map((gloss) => gloss.text)
        .filter(Boolean);
      const mapped = mapJapaneseChineseGloss(englishGlosses, englishGlossMap);
      if (!mapped.zhGloss) continue;
      const partOfSpeech = [...new Set(sense.partOfSpeech || [])].join(', ') || null;
      for (const surface of [...new Set(surfaces)]) {
        const normalizedForm = surface.normalize('NFKC');
        const key = `${normalizedForm}\u0000${word.id}\u0000${senseIndex}`;
        if (seen.has(key)) continue;
        seen.add(key);
        const isKanjiSurface = (word.kanji || []).some((item) => item.text === surface);
        entries.push({
          language: 'ja',
          surfaceForm: surface,
          normalizedForm,
          lemma: surface,
          reading: isKanjiSurface ? firstApplicableReading(word, surface) : surface,
          partOfSpeech,
          zhGloss: mapped.zhGloss,
          senseKey: `${word.id}:${senseIndex}`,
          sourceRef: {
            jmdictId: word.id,
            englishGlosses: mapped.matchedEnglish,
            translationPath: 'jmdict-simplified-eng-to-ecdict-zh',
            zhGlossSource: englishSource,
          },
        });
      }
    }
  }
  return entries;
}

function buildSourceRef(entry, source) {
  return JSON.stringify({
    ...entry.sourceRef,
    source: source.sourceId,
    sourceUrl: source.sourceUrl,
    license: source.license,
    inputSha256: source.inputSha256,
  });
}

module.exports = {
  buildEnglishGlossMap,
  buildSourceRef,
  compactChineseGloss,
  normalizeEnglish,
  parseCsvRows,
  readEcdictEntries,
  readJmdictEntries,
  sha256,
};
