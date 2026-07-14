'use strict';

const crypto = require('node:crypto');
const {
  Rating,
  State,
  createEmptyCard,
  fsrs,
  generatorParameters,
} = require('ts-fsrs');
const { SchedulerPort } = require('./schedulerPort');

const ADAPTER_ID = 'ts-fsrs';
const ADAPTER_VERSION = '5.4.1';
const ALGORITHM_ID = 'fsrs';
const ALGORITHM_VERSION = '6';

const PARAMETER_INPUT = Object.freeze({
  request_retention: 0.9,
  maximum_interval: 36500,
  enable_fuzz: false,
  enable_short_term: true,
  learning_steps: Object.freeze(['1m', '10m']),
  relearning_steps: Object.freeze(['10m']),
});

const STATE_TO_FSRS = Object.freeze({
  new: State.New,
  learning: State.Learning,
  review: State.Review,
  relearning: State.Relearning,
});

const FSRS_TO_STATE = Object.freeze({
  [State.New]: 'new',
  [State.Learning]: 'learning',
  [State.Review]: 'review',
  [State.Relearning]: 'relearning',
});

const RATING_LABELS = Object.freeze({
  [Rating.Again]: 'again',
  [Rating.Hard]: 'hard',
  [Rating.Good]: 'good',
  [Rating.Easy]: 'easy',
});

function stableJson(value) {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableJson(value[key])}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

function sha256(value) {
  return crypto.createHash('sha256').update(value).digest('hex');
}

function validDate(value, field) {
  const date = value instanceof Date ? new Date(value.getTime()) : new Date(value);
  if (Number.isNaN(date.getTime())) throw new TypeError(`${field} must be a valid date`);
  return date;
}

function toFsrsCard(state, reviewedAt) {
  if (!state) return createEmptyCard(reviewedAt);
  const fsrsState = STATE_TO_FSRS[state.fsrsState];
  if (fsrsState === undefined) throw new TypeError(`Unsupported FSRS state: ${state.fsrsState}`);
  return {
    due: validDate(state.dueAtUtc, 'state.dueAtUtc'),
    stability: Number(state.stability || 0),
    difficulty: Number(state.difficulty || 0),
    elapsed_days: Number(state.elapsedDays || 0),
    scheduled_days: Number(state.scheduledDays || 0),
    reps: Number(state.reps || 0),
    lapses: Number(state.lapses || 0),
    learning_steps: Number(state.step || 0),
    state: fsrsState,
    last_review: state.lastReviewedAtUtc
      ? validDate(state.lastReviewedAtUtc, 'state.lastReviewedAtUtc')
      : undefined,
  };
}

function fromFsrsCard(card) {
  const fsrsState = FSRS_TO_STATE[card.state];
  if (!fsrsState) throw new TypeError(`Unsupported ts-fsrs state: ${card.state}`);
  return {
    fsrsState,
    dueAtUtc: card.due.toISOString(),
    lastReviewedAtUtc: card.last_review ? card.last_review.toISOString() : null,
    stability: card.stability,
    difficulty: card.difficulty,
    elapsedDays: card.elapsed_days,
    scheduledDays: card.scheduled_days,
    reps: card.reps,
    lapses: card.lapses,
    step: card.learning_steps,
  };
}

class TsFsrsScheduler extends SchedulerPort {
  constructor() {
    super();
    this.parameters = generatorParameters({ ...PARAMETER_INPUT });
    this.parametersJson = stableJson(this.parameters);
    this.parametersHash = sha256(this.parametersJson);
    this.scheduler = fsrs(this.parameters);
  }

  describe() {
    return {
      algorithmId: ALGORITHM_ID,
      algorithmVersion: ALGORITHM_VERSION,
      adapterId: ADAPTER_ID,
      adapterVersion: ADAPTER_VERSION,
      parameters: JSON.parse(this.parametersJson),
      parametersHash: this.parametersHash,
    };
  }

  schedule({ state = null, rating, reviewedAtUtc }) {
    if (![Rating.Again, Rating.Hard, Rating.Good, Rating.Easy].includes(rating)) {
      throw new RangeError('rating must be an integer from 1 to 4');
    }
    const reviewedAt = validDate(reviewedAtUtc, 'reviewedAtUtc');
    const result = this.scheduler.next(toFsrsCard(state, reviewedAt), reviewedAt, rating);
    const afterState = fromFsrsCard(result.card);
    return {
      rating,
      ratingLabel: RATING_LABELS[rating],
      reviewedAtUtc: reviewedAt.toISOString(),
      beforeState: state,
      afterState,
      algorithm: this.describe(),
      publicExplanation: {
        rating: RATING_LABELS[rating],
        nextDueAtUtc: afterState.dueAtUtc,
        scheduledDays: afterState.scheduledDays,
        shortTerm: afterState.scheduledDays === 0,
      },
    };
  }
}

module.exports = {
  ADAPTER_ID,
  ADAPTER_VERSION,
  ALGORITHM_ID,
  ALGORITHM_VERSION,
  PARAMETER_INPUT,
  TsFsrsScheduler,
  fromFsrsCard,
  stableJson,
  toFsrsCard,
};
