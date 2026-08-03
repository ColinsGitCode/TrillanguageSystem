'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const { JSDOM } = require('jsdom');
const { stripLegacyRuby } = require('../../scripts/maintenance/replayPronunciationAnnotations');

test('shadow replay plain projection removes legacy reading nodes but preserves base text', () => {
  const dom = new JSDOM('<div><ruby>勤務<rt>きんむ</rt></ruby>表</div>');
  const root = stripLegacyRuby(dom.window.document.querySelector('div'));
  assert.equal(root.textContent, '勤務表');
  assert.equal(root.querySelector('ruby'), null);
  dom.window.close();
});
