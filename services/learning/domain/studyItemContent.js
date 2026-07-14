'use strict';

function headingSection(markdown, headingPattern, nextHeadingPattern) {
  const lines = String(markdown || '').split(/\r?\n/u);
  const start = lines.findIndex((line) => headingPattern.test(line));
  if (start < 0) return null;
  let end = lines.length;
  for (let index = start + 1; index < lines.length; index += 1) {
    if (nextHeadingPattern.test(lines[index])) {
      end = index;
      break;
    }
  }
  return lines.slice(start, end).join('\n').trim();
}

function extractStudyUnitMarkdown(markdown, unitKind, locator = {}) {
  if (unitKind === 'trilingual_en') {
    return headingSection(markdown, /^##\s+1\.\s*英文\s*:/u, /^##\s+/u) || String(markdown || '');
  }
  if (unitKind === 'trilingual_ja') {
    return headingSection(markdown, /^##\s+2\.\s*/u, /^##\s+/u) || String(markdown || '');
  }
  if (unitKind === 'scenario_bilingual') {
    const sourceHeading = String(locator.sourceHeading || '').padStart(2, '0');
    const escaped = sourceHeading.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&');
    return headingSection(markdown, new RegExp(`^###\\s+${escaped}\\.\\s*$`, 'u'), /^(?:###|##)\s+/u)
      || String(markdown || '');
  }
  return String(markdown || '');
}

function labeledValue(markdown, label) {
  const escaped = label.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&');
  const match = String(markdown || '').match(new RegExp(`^-\\s+\\*\\*${escaped}\\*\\*:\\s*(.+)$`, 'mu'));
  return match?.[1]?.replace(/\s*<audio\b[\s\S]*$/u, '').trim() || null;
}

function scenarioAudioMatches(audio, locator = {}) {
  const ordinal = Number(locator.ordinal || Number(locator.sourceHeading));
  if (!Number.isInteger(ordinal) || ordinal < 1) return true;
  return new RegExp(`_(?:en|ja)_${ordinal}$`, 'u').test(String(audio.filename_suffix || ''));
}

module.exports = {
  extractStudyUnitMarkdown,
  labeledValue,
  scenarioAudioMatches,
};
