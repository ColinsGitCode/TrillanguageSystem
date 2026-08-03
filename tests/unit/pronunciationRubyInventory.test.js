'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const { parseRuby, adjacentRubyGroups } = require('../../scripts/maintenance/auditPronunciationRubyInventory');

test('parses complete ruby tags without crossing unrelated markup', () => {
  const tags = parseRuby('<p><ruby>勤<rt>きん</rt></ruby><ruby>務<rt>む</rt></ruby></p><ruby>表</ruby>');
  assert.deepEqual(tags.map(({ base, reading }) => ({ base, reading })), [
    { base: '勤', reading: 'きん' },
    { base: '務', reading: 'む' },
  ]);
});

test('groups only directly adjacent ruby tags', () => {
  assert.equal(adjacentRubyGroups('<ruby>勤<rt>きん</rt></ruby><ruby>務<rt>む</rt></ruby>').length, 1);
  assert.equal(adjacentRubyGroups('<ruby>勤<rt>きん</rt></ruby> 表').length, 0);
});
