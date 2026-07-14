'use strict';

const { Temporal } = require('@js-temporal/polyfill');

const DEFAULT_TIME_ZONE = 'Asia/Shanghai';

function toInstant(value) {
  try {
    if (value instanceof Date) return Temporal.Instant.from(value.toISOString());
    return Temporal.Instant.from(String(value));
  } catch (error) {
    throw new TypeError(`Invalid UTC instant: ${value}`, { cause: error });
  }
}

function validateTimeZone(timeZone) {
  try {
    Temporal.Instant.from('2000-01-01T00:00:00Z').toZonedDateTimeISO(timeZone);
    return timeZone;
  } catch (error) {
    throw new RangeError(`Invalid IANA time zone: ${timeZone}`, { cause: error });
  }
}

function learningDay(instant, timeZone = DEFAULT_TIME_ZONE) {
  const zone = validateTimeZone(timeZone);
  return toInstant(instant).toZonedDateTimeISO(zone).toPlainDate().toString();
}

function dayBounds(day, timeZone = DEFAULT_TIME_ZONE) {
  const zone = validateTimeZone(timeZone);
  let plainDate;
  try {
    plainDate = Temporal.PlainDate.from(String(day));
  } catch (error) {
    throw new TypeError(`Invalid learning day: ${day}`, { cause: error });
  }
  const start = plainDate.toZonedDateTime(zone).toInstant();
  const end = plainDate.add({ days: 1 }).toZonedDateTime(zone).toInstant();
  const durationHours = Number(end.epochMilliseconds - start.epochMilliseconds) / 3_600_000;
  return {
    learningDay: plainDate.toString(),
    timeZone: zone,
    startUtc: start.toString(),
    endUtc: end.toString(),
    durationHours,
  };
}

module.exports = {
  DEFAULT_TIME_ZONE,
  dayBounds,
  learningDay,
  toInstant,
  validateTimeZone,
};
