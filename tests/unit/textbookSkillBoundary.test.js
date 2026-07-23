'use strict';

const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const assert = require('node:assert/strict');

const repoRoot = path.resolve(__dirname, '../..');

function read(relativePath) {
  return fs.readFileSync(path.join(repoRoot, relativePath), 'utf8');
}

test('textbook extraction stays owned by import-textbook-track Skill', () => {
  const pageSource = [
    read('app/features/textbooks/TextbookCoursesPage.tsx'),
    read('app/features/textbooks/components/TextbookWorkflowHeader.tsx'),
    read('app/features/textbooks/components/TextbookTrackRail.tsx'),
    read('app/features/textbooks/components/TextbookIntakeTools.tsx'),
  ].join('\n');
  const routesSource = read('routes/textbooks.js');
  const fixtureSource = read('tests/e2e/fixtures/textbookFixture.js');
  const skillSource = read('skills/import-textbook-track/SKILL.md');

  assert.match(skillSource, /import-textbook-track/u);
  assert.match(skillSource, /dry-run/iu);
  assert.match(fixtureSource, /skillName:\s*'import-textbook-track'/u);
  assert.match(fixtureSource, /official:\s*\{/u);
  assert.match(fixtureSource, /zhCue/u);
  assert.match(fixtureSource, /rubySegments/u);
  assert.match(fixtureSource, /confidence/u);

  assert.doesNotMatch(pageSource, /type=["']file["']/iu);
  assert.doesNotMatch(pageSource, /ocrMutation|\/api\/ocr|<button[^>]*>[^<]*(?:OCR|自动配对)/iu);
  assert.doesNotMatch(routesSource, /\/api\/textbooks\/.*ocr/iu);
  assert.match(pageSource, /Codex Skill/iu);
  assert.match(pageSource, /人工确认|人工校对|人审/iu);
});

test('draft import remains separate from verify and learning publication', () => {
  const routesSource = read('routes/textbooks.js');
  const importServiceSource = read('services/textbooks/textbookImportService.js');

  assert.match(routesSource, /\/api\/textbooks\/imports/u);
  assert.match(routesSource, /\/api\/textbooks\/revisions\/:id\/verify/u);
  assert.match(routesSource, /\/api\/textbooks\/tracks\/:id\/publish/u);
  assert.doesNotMatch(importServiceSource, /publishTextbookTrack/u);
  assert.doesNotMatch(importServiceSource, /recordReview|learning_review_events/u);
});
