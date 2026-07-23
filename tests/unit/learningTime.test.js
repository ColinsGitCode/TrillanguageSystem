'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const {
  DEFAULT_TIME_ZONE,
  PRODUCT_DEFAULT_TIME_ZONE,
  dayBounds,
  learningDay,
} = require('../../services/learning/time/learningTime');

test.describe('Learning Assistance IANA Time Service', () => {
  test.it('uses Asia/Tokyo as the product default without bare UTC dates', () => {
    assert.equal(PRODUCT_DEFAULT_TIME_ZONE, 'Asia/Tokyo');
    assert.equal(DEFAULT_TIME_ZONE, 'Asia/Tokyo');
    assert.equal(learningDay('2026-07-13T16:30:00Z'), '2026-07-14');
    assert.deepEqual(dayBounds('2026-07-14'), {
      learningDay: '2026-07-14',
      timeZone: 'Asia/Tokyo',
      startUtc: '2026-07-13T15:00:00Z',
      endUtc: '2026-07-14T15:00:00Z',
      durationHours: 24,
    });
  });

  test.it('returns a 23-hour spring-forward day', () => {
    assert.deepEqual(dayBounds('2026-03-08', 'America/New_York'), {
      learningDay: '2026-03-08',
      timeZone: 'America/New_York',
      startUtc: '2026-03-08T05:00:00Z',
      endUtc: '2026-03-09T04:00:00Z',
      durationHours: 23,
    });
  });

  test.it('returns a 25-hour fall-back day and maps both repeated hours to it', () => {
    assert.deepEqual(dayBounds('2026-11-01', 'America/New_York'), {
      learningDay: '2026-11-01',
      timeZone: 'America/New_York',
      startUtc: '2026-11-01T04:00:00Z',
      endUtc: '2026-11-02T05:00:00Z',
      durationHours: 25,
    });
    assert.equal(learningDay('2026-11-01T05:30:00Z', 'America/New_York'), '2026-11-01');
    assert.equal(learningDay('2026-11-01T06:30:00Z', 'America/New_York'), '2026-11-01');
  });

  test.it('rejects invalid instants, learning days, and zones', () => {
    assert.throws(() => learningDay('not-an-instant'), /Invalid UTC instant/u);
    assert.throws(() => learningDay('2026-07-14T00:00:00Z', 'Mars/Olympus'), /Invalid IANA/u);
    assert.throws(() => dayBounds('2026-02-30'), /Invalid learning day/u);
  });
});
