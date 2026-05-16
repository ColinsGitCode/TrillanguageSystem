'use strict';

const fs = require('fs');
const path = require('path');
const { normalizeText, hashFingerprint } = require('../textUtils');

function run(cards = []) {
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

module.exports = { run };
