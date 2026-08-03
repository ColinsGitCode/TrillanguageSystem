'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  ActivityService,
  isoTimestamp,
  publicStatus,
} = require('../../services/activity/activityService');

function fakeLogger() {
  return { warn() {} };
}

function fakeDbService(overrides = {}) {
  return {
    db: {
      prepare() {
        return { get: () => null };
      },
    },
    listRecentTextbookOperations: () => [],
    listPendingTextbookReviews: () => [],
    listKgSourceSyncJobs: () => [],
    ...overrides,
  };
}

test.describe('ActivityService', () => {
  test.it('normalizes public statuses and SQLite UTC timestamps', () => {
    assert.equal(publicStatus('success'), 'succeeded');
    assert.equal(publicStatus('superseded'), 'cancelled');
    assert.equal(isoTimestamp('2026-07-30 12:34:56'), '2026-07-30T12:34:56.000Z');
  });

  test.it('combines persisted activity sources and keeps active learning recoverable', () => {
    const dbService = fakeDbService({
      db: {
        prepare() {
          return {
            get: () => ({
              id: 9,
              queue_id: 4,
              learning_day: '2026-07-30',
              total: 5,
              completed: 2,
              last_activity_at_utc: '2026-07-30T12:03:00.000Z',
            }),
          };
        },
      },
      listRecentTextbookOperations: () => [{
        id: 7,
        track_id: 2,
        track_title: '朝の情景',
        kind: 'tts',
        status: 'failed',
        public_summary: '部分语音生成失败',
        updated_at_utc: '2026-07-30T12:02:00.000Z',
      }],
      listKgSourceSyncJobs: () => [{
        id: 5,
        sourceKind: 'study_item',
        status: 'running',
        updatedAtUtc: '2026-07-30T12:01:00.000Z',
      }],
    });
    const service = new ActivityService({
      dbService,
      kgEnabled: true,
      knowledgeGraphService: {
        listResolutionCases: () => [],
        countResolutionCases: () => 0,
      },
      generationJobService: {
        listJobs: () => [{
          id: 3,
          jobType: 'trilingual',
          status: 'queued',
          createdAt: '2026-07-30T12:00:00.000Z',
        }],
      },
      now: () => new Date('2026-07-30T12:05:00.000Z'),
      logger: fakeLogger(),
    });

    const feed = service.getFeed();
    assert.deepEqual(feed.sources.map((source) => source.status), [
      'available',
      'available',
      'available',
      'available',
    ]);
    assert.equal(feed.items.length, 4);
    assert.equal(feed.items[0].kind, 'learning-session');
    assert.equal(feed.items[0].summary, '本次已完成 2/5，可继续上次进度');
    assert.equal(feed.items[1].kind, 'textbook-operation');
    assert.equal(feed.items[1].actionLabel, '查看并重试');
    assert.equal(feed.summary.active, 3);
    assert.equal(feed.summary.needsAttention, 1);
  });

  test.it('degrades one source without hiding the remaining activity', () => {
    const service = new ActivityService({
      dbService: fakeDbService({
        listRecentTextbookOperations: () => {
          throw new Error('storage unavailable');
        },
      }),
      generationJobService: {
        listJobs: () => [{
          id: 3,
          jobType: 'scenario_phrase',
          status: 'running',
          startedAt: '2026-07-30T12:00:00.000Z',
        }],
      },
      now: () => new Date('2026-07-30T12:05:00.000Z'),
      logger: fakeLogger(),
    });

    const feed = service.getFeed();
    assert.equal(feed.items.length, 1);
    assert.equal(feed.items[0].kind, 'generation-job');
    assert.deepEqual(
      feed.sources.find((source) => source.id === 'textbooks'),
      { id: 'textbooks', status: 'degraded' }
    );
  });

  test.it('surfaces textbook review and knowledge resolution as user attention', () => {
    const service = new ActivityService({
      dbService: fakeDbService({
        listPendingTextbookReviews: () => [{
          track_id: 12,
          revision_id: 4,
          track_title: '朝の情景',
          track_status: 'draft',
          expression_count: 20,
          review_total: 20,
          pending: 7,
          needs_attention: 2,
          updated_at_utc: '2026-07-30T12:04:00.000Z',
        }],
      }),
      generationJobService: { listJobs: () => [] },
      knowledgeGraphService: {
        listResolutionCases: () => [{
          id: 31,
          normalizedInput: 'はし',
          updatedAtUtc: '2026-07-30T12:03:00.000Z',
        }],
        countResolutionCases: () => 3,
      },
      kgEnabled: true,
      now: () => new Date('2026-07-30T12:05:00.000Z'),
      logger: fakeLogger(),
    });

    const feed = service.getFeed();
    assert.equal(feed.items.length, 2);
    assert.equal(feed.items[0].kind, 'textbook-review');
    assert.equal(feed.items[0].status, 'needs_attention');
    assert.equal(feed.items[0].summary, '2 条需重点检查，另有 7 条待确认');
    assert.equal(feed.items[0].href, '/textbooks?track=12&stage=review');
    assert.equal(feed.items[1].kind, 'knowledge-resolution');
    assert.equal(feed.items[1].title, '3 个知识点待确认');
    assert.equal(feed.items[1].href, '/knowledge?mode=resolution&case=31');
    assert.equal(feed.summary.needsAttention, 2);
  });

  test.it('hides internal knowledge sync work when the product domain is disabled', () => {
    const service = new ActivityService({
      dbService: fakeDbService({
        listKgSourceSyncJobs: () => [{
          id: 5,
          sourceKind: 'study_item',
          status: 'queued',
          updatedAtUtc: '2026-07-30T12:01:00.000Z',
        }],
      }),
      generationJobService: { listJobs: () => [] },
      kgEnabled: false,
      now: () => new Date('2026-07-30T12:05:00.000Z'),
      logger: fakeLogger(),
    });

    const feed = service.getFeed();
    assert.deepEqual(feed.items, []);
    assert.deepEqual(
      feed.sources.find((source) => source.id === 'knowledge'),
      { id: 'knowledge', status: 'available' }
    );
  });

  test.it('drops old successful entries but retains failures that need attention', () => {
    const service = new ActivityService({
      dbService: fakeDbService(),
      generationJobService: {
        listJobs: () => [
          {
            id: 2,
            jobType: 'trilingual',
            status: 'success',
            finishedAt: '2026-07-27T12:00:00.000Z',
          },
          {
            id: 1,
            jobType: 'trilingual',
            status: 'failed',
            finishedAt: '2026-07-27T12:00:00.000Z',
          },
        ],
      },
      now: () => new Date('2026-07-30T12:05:00.000Z'),
      logger: fakeLogger(),
    });

    const feed = service.getFeed();
    assert.deepEqual(feed.items.map((item) => item.id), ['1']);
  });
});
